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

  // Extrait l'id et l'action depuis /api/conduite/:id/accept|refuse
  const match  = path.match(/\/conduite\/(\d+)\/(accept|refuse)$/);
  const itemId = match?.[1];
  const action = match?.[2];

  try {
    // GET /api/conduite — conducteur actuel + journal
    if (method === 'GET') {
      const { data: journal, error } = await supabase
        .from('journal_conduite')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) return response(500, { error: error.message });

      // Le conducteur actuel = to_name du dernier enregistrement Accepté
      const dernierAccepte = journal.find(r => r.statut === 'Accepté');
      const conducteurActuel = dernierAccepte
        ? { name: dernierAccepte.to_name, email: dernierAccepte.to_email, depuis: dernierAccepte.accepte_at }
        : null;

      // Transferts en attente destinés à cet utilisateur
      const enAttentePourMoi = journal.filter(
        r => r.statut === 'En attente' && r.to_email === user.email
      );

      return response(200, { conducteurActuel, journal, enAttentePourMoi });
    }

    // POST /api/conduite — initier une passation
    if (method === 'POST' && !itemId) {
      const { to_email, to_name, observations } = JSON.parse(event.body || '{}');
      if (!to_email || !to_name) return response(400, { error: 'Destinataire requis' });
      if (to_email === user.email) return response(400, { error: 'Impossible de se transférer à soi-même' });

      // Vérifier qu'aucune passation En attente n'existe déjà
      const { data: existing } = await supabase
        .from('journal_conduite')
        .select('id')
        .eq('statut', 'En attente')
        .maybeSingle();
      if (existing) return response(409, { error: 'Une passation est déjà en attente d\'acceptation' });

      // Récupérer le display_name de l'émetteur
      const { data: appUser } = await supabase
        .from('app_users').select('display_name').eq('email', user.email).single();
      const from_name = appUser?.display_name || user.email;

      const { data, error } = await supabase
        .from('journal_conduite')
        .insert([{
          from_email: user.email,
          from_name,
          to_email,
          to_name,
          observations: observations || null,
          statut: 'En attente',
        }])
        .select()
        .single();
      if (error) return response(500, { error: error.message });
      return response(201, data);
    }

    // PUT /api/conduite/:id/accept — le destinataire accepte
    if (method === 'PUT' && itemId && action === 'accept') {
      const { data: row, error: fetchErr } = await supabase
        .from('journal_conduite').select('*').eq('id', itemId).single();
      if (fetchErr || !row) return response(404, { error: 'Passation introuvable' });
      if (row.to_email !== user.email) return response(403, { error: 'Non autorisé' });
      if (row.statut !== 'En attente') return response(400, { error: 'Passation déjà traitée' });

      const { error } = await supabase
        .from('journal_conduite')
        .update({ statut: 'Accepté', accepte_at: new Date().toISOString() })
        .eq('id', itemId);
      if (error) return response(500, { error: error.message });
      return response(200, { success: true });
    }

    // PUT /api/conduite/:id/refuse — le destinataire refuse
    if (method === 'PUT' && itemId && action === 'refuse') {
      const { data: row, error: fetchErr } = await supabase
        .from('journal_conduite').select('*').eq('id', itemId).single();
      if (fetchErr || !row) return response(404, { error: 'Passation introuvable' });
      if (row.to_email !== user.email) return response(403, { error: 'Non autorisé' });
      if (row.statut !== 'En attente') return response(400, { error: 'Passation déjà traitée' });

      const { error } = await supabase
        .from('journal_conduite')
        .update({ statut: 'Refusé', accepte_at: new Date().toISOString() })
        .eq('id', itemId);
      if (error) return response(500, { error: error.message });
      return response(200, { success: true });
    }

    return response(405, { error: 'Méthode non autorisée' });
  } catch (err) {
    return response(500, { error: err.message });
  }
};
