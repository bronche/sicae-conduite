const { supabase, verifyAdmin } = require('./lib/auth');

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json',
};

function response(statusCode, body) {
  return { statusCode, headers: HEADERS, body: JSON.stringify(body) };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: HEADERS, body: '' };

  const user = await verifyAdmin(event.headers.authorization);
  if (!user) return response(403, { error: 'Accès réservé aux administrateurs' });

  if (event.httpMethod === 'GET') {
    const { data, error } = await supabase
      .from('journal_modifications')
      .select('*')
      .order('fait_a', { ascending: false })
      .limit(1000);
    if (error) return response(500, { error: error.message });
    return response(200, data);
  }

  return response(405, { error: 'Méthode non autorisée' });
};
