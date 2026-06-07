const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json',
};

function response(statusCode, body, extraHeaders) {
  return {
    statusCode,
    headers: { ...HEADERS, ...extraHeaders },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: HEADERS, body: '' };
  }

  const method = event.httpMethod;
  const path = event.path || '';

  try {
    // GET /api/backup/export → JSON complet
    if (method === 'GET' && path.endsWith('/export')) {
      const [{ data: interventions, error: e1 }, { data: listes, error: e2 }] = await Promise.all([
        supabase.from('interventions').select('*').order('created_at', { ascending: true }),
        supabase.from('listes_parametres').select('*').order('nom_liste').order('ordre'),
      ]);
      if (e1) return response(500, { error: e1.message });
      if (e2) return response(500, { error: e2.message });

      const exportData = {
        version: '1.0',
        exported_at: new Date().toISOString(),
        interventions: interventions || [],
        listes: listes || [],
      };

      return response(200, exportData, {
        'Content-Disposition': `attachment; filename="SICAE-sauvegarde.json"`,
      });
    }

    // POST /api/backup/import-listes → remplace toutes les listes
    if (method === 'POST' && path.endsWith('/import-listes')) {
      const body = JSON.parse(event.body || '{}');
      const listes = body.listes || [];
      if (!Array.isArray(listes)) {
        return response(400, { error: 'Le champ "listes" doit être un tableau' });
      }

      // Supprimer toutes les listes existantes puis réinsérer
      const { error: delError } = await supabase.from('listes_parametres').delete().neq('id', 0);
      if (delError) return response(500, { error: delError.message });

      if (listes.length > 0) {
        const records = listes.map(({ nom_liste, valeur, ordre }) => ({
          nom_liste,
          valeur,
          ordre: ordre || 0,
        }));
        const { error: insError } = await supabase.from('listes_parametres').insert(records);
        if (insError) return response(500, { error: insError.message });
      }

      return response(200, { success: true, imported: listes.length });
    }

    // POST /api/backup/import-interventions → ajoute des interventions
    if (method === 'POST' && path.endsWith('/import-interventions')) {
      const body = JSON.parse(event.body || '{}');
      const interventions = body.interventions || [];
      if (!Array.isArray(interventions)) {
        return response(400, { error: 'Le champ "interventions" doit être un tableau' });
      }
      if (interventions.length === 0) {
        return response(200, { success: true, imported: 0 });
      }

      const records = interventions.map((i) => ({
        id: i.id || `INT-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        date: i.date,
        heure_debut: i.heure_debut,
        heure_fin: i.heure_fin || null,
        type: i.type,
        ouvrage: i.ouvrage,
        commune: i.commune,
        statut: i.statut || 'En cours',
        observations: i.observations || null,
      }));

      // Upsert pour éviter les doublons sur l'id
      const { error } = await supabase.from('interventions').upsert(records, { onConflict: 'id' });
      if (error) return response(500, { error: error.message });

      return response(200, { success: true, imported: records.length });
    }

    return response(405, { error: 'Méthode non autorisée' });
  } catch (err) {
    return response(500, { error: err.message });
  }
};
