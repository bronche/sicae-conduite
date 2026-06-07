const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Content-Type': 'application/json',
};

function response(statusCode, body) {
  return { statusCode, headers: HEADERS, body: JSON.stringify(body) };
}

const SENTINEL = '__vide__';

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: HEADERS, body: '' };
  }

  const method = event.httpMethod;
  const path = event.path || '';
  const isCreer      = path.endsWith('/creer');
  const isListeRoute = path.endsWith('/liste');
  const isBulk       = path.endsWith('/bulk');

  try {
    // GET /api/listes → toutes les listes groupées + parents
    if (method === 'GET') {
      let result = await supabase
        .from('listes_parametres')
        .select('nom_liste, valeur, ordre, parent_key')
        .order('nom_liste')
        .order('ordre')
        .order('valeur');

      let hasParentKey = true;
      if (result.error) {
        hasParentKey = false;
        result = await supabase
          .from('listes_parametres')
          .select('nom_liste, valeur, ordre')
          .order('nom_liste')
          .order('ordre')
          .order('valeur');
        if (result.error) return response(500, { error: result.error.message });
      }

      const grouped = {};
      const parents = {};
      for (const row of result.data) {
        if (!grouped[row.nom_liste]) grouped[row.nom_liste] = [];
        // Filtrer les sentinels (sous-listes vides) de l'affichage
        if (row.valeur !== SENTINEL) grouped[row.nom_liste].push(row.valeur);
        if (hasParentKey && row.parent_key && !parents[row.nom_liste]) {
          parents[row.nom_liste] = row.parent_key;
        }
      }
      grouped.__parents__ = parents;
      return response(200, grouped);
    }

    // POST /api/listes/bulk → importer plusieurs valeurs { nom_liste, valeurs: [] }
    if (method === 'POST' && isBulk) {
      const body = JSON.parse(event.body || '{}');
      const { nom_liste, valeurs } = body;
      if (!nom_liste || !Array.isArray(valeurs) || valeurs.length === 0) {
        return response(400, { error: 'nom_liste et valeurs[] sont obligatoires' });
      }
      const { data: existing } = await supabase
        .from('listes_parametres')
        .select('ordre, valeur')
        .eq('nom_liste', nom_liste)
        .order('ordre', { ascending: false })
        .limit(1);
      let nextOrdre = existing && existing.length > 0 ? (existing[0].ordre + 1) : 1;

      const { data: existingVals } = await supabase
        .from('listes_parametres')
        .select('valeur')
        .eq('nom_liste', nom_liste);
      const existingSet = new Set((existingVals || []).map(r => r.valeur.toLowerCase()));

      const rows = valeurs
        .filter(v => v && !existingSet.has(v.toLowerCase()))
        .map((valeur, i) => ({ nom_liste, valeur, ordre: nextOrdre + i }));

      if (rows.length === 0) return response(200, { inserted: 0 });
      const { error } = await supabase.from('listes_parametres').insert(rows);
      if (error) return response(500, { error: error.message });
      return response(201, { inserted: rows.length });
    }

    // POST /api/listes/creer → créer nouvelle liste (premiere_valeur optionnelle)
    if (method === 'POST' && isCreer) {
      const body = JSON.parse(event.body || '{}');
      const { nom_liste, premiere_valeur, parent_key } = body;
      if (!nom_liste) {
        return response(400, { error: 'nom_liste est obligatoire' });
      }
      const valeur = (premiere_valeur || '').trim() || SENTINEL;
      const ordre  = valeur === SENTINEL ? 0 : 1;
      const row = { nom_liste, valeur, ordre };
      if (parent_key) row.parent_key = parent_key;
      const { error } = await supabase.from('listes_parametres').insert([row]);
      if (error) return response(500, { error: error.message });
      return response(201, { success: true });
    }

    // PUT /api/listes → renommer une valeur { nom_liste, old_valeur, new_valeur }
    if (method === 'PUT' && !isListeRoute) {
      const body = JSON.parse(event.body || '{}');
      const { nom_liste, old_valeur, new_valeur } = body;
      if (!nom_liste || !old_valeur || !new_valeur) {
        return response(400, { error: 'nom_liste, old_valeur et new_valeur sont obligatoires' });
      }
      const { error: e1 } = await supabase
        .from('listes_parametres')
        .update({ valeur: new_valeur })
        .eq('nom_liste', nom_liste)
        .eq('valeur', old_valeur);
      if (e1) return response(500, { error: e1.message });

      // Cascader le renommage dans les parent_key des sous-listes
      const old_key = `${nom_liste}::${old_valeur}`;
      const new_key = `${nom_liste}::${new_valeur}`;
      await supabase
        .from('listes_parametres')
        .update({ parent_key: new_key })
        .eq('parent_key', old_key);

      return response(200, { success: true });
    }

    // PUT /api/listes/liste → renommer une liste { old_nom, new_nom }
    if (method === 'PUT' && isListeRoute) {
      const body = JSON.parse(event.body || '{}');
      const { old_nom, new_nom } = body;
      if (!old_nom || !new_nom) {
        return response(400, { error: 'old_nom et new_nom sont obligatoires' });
      }
      const { error: e1 } = await supabase
        .from('listes_parametres')
        .update({ nom_liste: new_nom })
        .eq('nom_liste', old_nom);
      if (e1) return response(500, { error: e1.message });

      // Cascader le renommage dans les parent_key qui référencent cet ancien nom
      const { data: affected } = await supabase
        .from('listes_parametres')
        .select('nom_liste, valeur, parent_key')
        .like('parent_key', `${old_nom}::%`);

      if (affected && affected.length > 0) {
        for (const row of affected) {
          const new_key = row.parent_key.replace(`${old_nom}::`, `${new_nom}::`);
          await supabase
            .from('listes_parametres')
            .update({ parent_key: new_key })
            .eq('nom_liste', row.nom_liste)
            .eq('valeur', row.valeur);
        }
      }
      return response(200, { success: true });
    }

    // DELETE /api/listes/liste → supprimer toute une liste { nom_liste }
    if (method === 'DELETE' && isListeRoute) {
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

      // Nettoyer le sentinel si la liste en avait un
      await supabase
        .from('listes_parametres')
        .delete()
        .eq('nom_liste', nom_liste)
        .eq('valeur', SENTINEL);

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
