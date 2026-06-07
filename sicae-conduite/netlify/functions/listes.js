const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Content-Type': 'application/json',
};

function response(statusCode, body) {
  return { statusCode, headers: HEADERS, body: JSON.stringify(body) };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: HEADERS, body: '' };
  }

  const method = event.httpMethod;
  const path = event.path || '';
  // Detect sub-routes: /api/listes/creer  or  /api/listes/liste
  const isCreer = path.endsWith('/creer');
  const isListeDelete = path.endsWith('/liste');

  try {
    // GET /api/listes → toutes les listes groupées
    if (method === 'GET') {
      const { data, error } = await supabase
        .from('listes_parametres')
        .select('nom_liste, valeur, ordre')
        .order('nom_liste')
        .order('ordre')
        .order('valeur');
      if (error) return response(500, { error: error.message });

      const grouped = {};
      for (const row of data) {
        if (!grouped[row.nom_liste]) grouped[row.nom_liste] = [];
        grouped[row.nom_liste].push(row.valeur);
      }
      return response(200, grouped);
    }

    // POST /api/listes/creer → créer nouvelle liste { nom_liste, premiere_valeur }
    if (method === 'POST' && isCreer) {
      const body = JSON.parse(event.body || '{}');
      const { nom_liste, premiere_valeur } = body;
      if (!nom_liste || !premiere_valeur) {
        return response(400, { error: 'nom_liste et premiere_valeur sont obligatoires' });
      }
      const { error } = await supabase
        .from('listes_parametres')
        .insert([{ nom_liste, valeur: premiere_valeur, ordre: 1 }]);
      if (error) return response(500, { error: error.message });
      return response(201, { success: true });
    }

    // DELETE /api/listes/liste → supprimer toute une liste { nom_liste }
    if (method === 'DELETE' && isListeDelete) {
      const body = JSON.parse(event.body || '{}');
      const { nom_liste } = body;
      if (!nom_liste) return response(400, { error: 'nom_liste est obligatoire' });
      const { error } = await supabase
        .from('listes_parametres')
        .delete()
        .eq('nom_liste', nom_liste);
      if (error) return response(500, { error: error.message });
      return response(200, { success: true });
    }

    // POST /api/listes → ajouter valeur { nom_liste, valeur }
    if (method === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const { nom_liste, valeur } = body;
      if (!nom_liste || !valeur) {
        return response(400, { error: 'nom_liste et valeur sont obligatoires' });
      }
      // Récupérer l'ordre max existant
      const { data: existing } = await supabase
        .from('listes_parametres')
        .select('ordre')
        .eq('nom_liste', nom_liste)
        .order('ordre', { ascending: false })
        .limit(1);
      const nextOrdre = existing && existing.length > 0 ? (existing[0].ordre + 1) : 1;
      const { error } = await supabase
        .from('listes_parametres')
        .insert([{ nom_liste, valeur, ordre: nextOrdre }]);
      if (error) return response(500, { error: error.message });
      return response(201, { success: true });
    }

    // DELETE /api/listes → supprimer valeur { nom_liste, valeur }
    if (method === 'DELETE') {
      const body = JSON.parse(event.body || '{}');
      const { nom_liste, valeur } = body;
      if (!nom_liste || !valeur) {
        return response(400, { error: 'nom_liste et valeur sont obligatoires' });
      }
      const { error } = await supabase
        .from('listes_parametres')
        .delete()
        .eq('nom_liste', nom_liste)
        .eq('valeur', valeur);
      if (error) return response(500, { error: error.message });
      return response(200, { success: true });
    }

    return response(405, { error: 'Méthode non autorisée' });
  } catch (err) {
    return response(500, { error: err.message });
  }
};
