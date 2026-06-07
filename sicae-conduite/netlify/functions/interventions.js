const { supabase, verifyToken } = require('./lib/auth');

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Content-Type': 'application/json',
};

function response(statusCode, body) {
  return { statusCode, headers: HEADERS, body: JSON.stringify(body) };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: HEADERS, body: '' };

  const user = await verifyToken(event.headers.authorization);
  if (!user) return response(401, { error: 'Non authentifié' });

  const method    = event.httpMethod;
  const pathParts = (event.path || '').split('/').filter(Boolean);
  const lastPart  = pathParts[pathParts.length - 1];
  const id        = lastPart !== 'interventions' ? lastPart : null;
  const qs        = event.queryStringParameters || {};

  try {
    // GET /api/interventions
    if (method === 'GET' && !id) {
      let query = supabase.from('interventions').select('*').order('created_at', { ascending: false });

      if (qs.today === '1') {
        const dateStr = new Date().toISOString().slice(0, 10);
        query = query.eq('date', dateStr);
      }
      // Exclure les archivées sauf si explicitement demandé
      if (qs.include_archived !== '1') {
        query = query.neq('statut', 'Archivée');
      }

      const { data, error } = await query;
      if (error) return response(500, { error: error.message });
      return response(200, data);
    }

    // POST /api/interventions — créer
    if (method === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const { id: newId, date, heure_debut, heure_fin, type, sous_type, site, ouvrage, statut, observations, intervenants } = body;
      if (!date || !heure_debut || !type) {
        return response(400, { error: 'Champs obligatoires manquants : date, heure_debut, type' });
      }
      const record = {
        id:          newId || `INT-${Date.now()}`,
        date,
        heure_debut,
        heure_fin:    heure_fin || null,
        type,
        sous_type:   sous_type || null,
        site:        site || null,
        ouvrage:     ouvrage || null,
        statut:      statut || 'En cours',
        observations: observations || null,
        intervenants: Array.isArray(intervenants) ? intervenants : [],
        agent_email:  user.email,
      };
      let insertResult = await supabase.from('interventions').insert([record]).select().single();
      if (insertResult.error) {
        const msg = insertResult.error.message || '';
        if (msg.includes('intervenants') || msg.includes('sous_type')) {
          const { intervenants: _i, sous_type: _s, ...baseRecord } = record;
          insertResult = await supabase.from('interventions').insert([baseRecord]).select().single();
        }
      }
      const { data, error } = insertResult;
      if (error) return response(500, { error: error.message });
      supabase.from('journal_modifications').insert([{
        intervention_id: data.id, action: 'Création', details: data, fait_par_email: user.email,
      }]).then(() => {});
      return response(201, data);
    }

    // PUT /api/interventions/:id — modifier
    if (method === 'PUT' && id) {
      const body    = JSON.parse(event.body || '{}');
      const updates = {};
      const fields  = ['statut', 'heure_fin', 'observations', 'type', 'sous_type', 'site', 'ouvrage', 'date', 'heure_debut', 'agent_email', 'intervenants'];
      fields.forEach(f => { if (body[f] !== undefined) updates[f] = body[f]; });

      const { data, error } = await supabase
        .from('interventions').update(updates).eq('id', id).select().single();
      if (error) return response(500, { error: error.message });
      if (!data) return response(404, { error: 'Intervention introuvable' });
      supabase.from('journal_modifications').insert([{
        intervention_id: id, action: 'Modification', details: updates, fait_par_email: user.email,
      }]).then();
      return response(200, data);
    }

    // DELETE /api/interventions/:id — suppression physique (admin uniquement, sinon archiver)
    if (method === 'DELETE' && id) {
      const { error } = await supabase.from('interventions').delete().eq('id', id);
      if (error) return response(500, { error: error.message });
      supabase.from('journal_modifications').insert([{
        intervention_id: id, action: 'Suppression', details: null, fait_par_email: user.email,
      }]).then();
      return response(200, { success: true });
    }

    return response(405, { error: 'Méthode non autorisée' });
  } catch (err) {
    return response(500, { error: err.message });
  }
};
