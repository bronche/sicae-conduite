const { supabase, verifyToken } = require('./lib/auth');

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
  'Content-Type': 'application/json',
};

function response(statusCode, body) {
  return { statusCode, headers: HEADERS, body: JSON.stringify(body) };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: HEADERS, body: '' };

  const user = await verifyToken(event.headers.authorization);
  if (!user) return response(401, { error: 'Non authentifié' });

  const method = event.httpMethod;
  const path   = event.path || '';

  try {
    // GET /api/transferts?pending=1 → transferts en attente pour cet utilisateur
    // GET /api/transferts          → tous (envoyés + reçus)
    if (method === 'GET') {
      const pending = event.queryStringParameters?.pending === '1';
      let query = supabase
        .from('transferts_conduite')
        .select('*, intervention:interventions(type, ouvrage, commune, statut, heure_debut)');

      if (pending) {
        query = query.eq('to_email', user.email).eq('statut', 'En attente');
      } else {
        query = query.or(`from_email.eq.${user.email},to_email.eq.${user.email}`);
      }
      const { data, error } = await query.order('created_at', { ascending: false });
      if (error) return response(500, { error: error.message });
      return response(200, data);
    }

    // POST /api/transferts → initier un transfert
    if (method === 'POST' && !path.match(/\/(accept|refuse)$/)) {
      const { intervention_id, to_email, observation } = JSON.parse(event.body || '{}');
      if (!intervention_id || !to_email) return response(400, { error: 'intervention_id et to_email requis' });
      if (to_email === user.email) return response(400, { error: 'Impossible de se transférer à soi-même' });

      // Vérifier qu'aucun transfert En attente n'existe déjà
      const { data: existing } = await supabase
        .from('transferts_conduite')
        .select('id')
        .eq('intervention_id', intervention_id)
        .eq('statut', 'En attente')
        .maybeSingle();
      if (existing) return response(409, { error: 'Un transfert est déjà en attente pour cette intervention' });

      const { data, error } = await supabase
        .from('transferts_conduite')
        .insert([{ intervention_id, from_email: user.email, to_email, observation: observation || null }])
        .select()
        .single();
      if (error) return response(500, { error: error.message });

      // Passer l'intervention en statut "En transfert"
      await supabase.from('interventions').update({ statut: 'En transfert' }).eq('id', intervention_id);

      return response(201, data);
    }

    // PUT /api/transferts/:id/accept
    if (method === 'PUT' && path.endsWith('/accept')) {
      const id = path.split('/').filter(Boolean).slice(-2)[0];
      const { data: t, error: fetchErr } = await supabase
        .from('transferts_conduite').select('*').eq('id', id).single();
      if (fetchErr || !t) return response(404, { error: 'Transfert introuvable' });
      if (t.to_email !== user.email) return response(403, { error: 'Non autorisé' });
      if (t.statut !== 'En attente') return response(400, { error: 'Transfert déjà traité' });

      await supabase.from('transferts_conduite')
        .update({ statut: 'Accepté', responded_at: new Date().toISOString() }).eq('id', id);
      await supabase.from('interventions')
        .update({ statut: 'En cours', agent_email: user.email }).eq('id', t.intervention_id);

      return response(200, { success: true });
    }

    // PUT /api/transferts/:id/refuse
    if (method === 'PUT' && path.endsWith('/refuse')) {
      const id = path.split('/').filter(Boolean).slice(-2)[0];
      const { data: t, error: fetchErr } = await supabase
        .from('transferts_conduite').select('*').eq('id', id).single();
      if (fetchErr || !t) return response(404, { error: 'Transfert introuvable' });
      if (t.to_email !== user.email) return response(403, { error: 'Non autorisé' });
      if (t.statut !== 'En attente') return response(400, { error: 'Transfert déjà traité' });

      await supabase.from('transferts_conduite')
        .update({ statut: 'Refusé', responded_at: new Date().toISOString() }).eq('id', id);
      // Remettre l'intervention en cours (annulation du transfert)
      await supabase.from('interventions')
        .update({ statut: 'En cours' }).eq('id', t.intervention_id);

      return response(200, { success: true });
    }

    return response(405, { error: 'Méthode non autorisée' });
  } catch (err) {
    return response(500, { error: err.message });
  }
};
