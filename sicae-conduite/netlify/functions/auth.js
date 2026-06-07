const { createClient } = require('@supabase/supabase-js');
const { verifyToken, usernameToEmail } = require('./lib/auth');

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

function response(statusCode, body) {
  return { statusCode, headers: HEADERS, body: JSON.stringify(body) };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: HEADERS, body: '' };

  const path   = event.path || '';
  const method = event.httpMethod;

  try {
    // POST /api/auth/login
    if (method === 'POST' && path.endsWith('/login')) {
      const { username, password } = JSON.parse(event.body || '{}');
      if (!username || !password) return response(400, { error: 'Nom et mot de passe requis' });

      const email = usernameToEmail(username);

      const res = await fetch(`${process.env.SUPABASE_URL}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': process.env.SUPABASE_SERVICE_KEY,
        },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();
      if (!res.ok) return response(401, { error: 'Identifiants incorrects' });

      const { data: appUser } = await supabase
        .from('app_users')
        .select('display_name, is_admin')
        .eq('email', data.user.email)
        .single();

      return response(200, {
        access_token:  data.access_token,
        refresh_token: data.refresh_token,
        email:         data.user.email,
        display_name:  appUser?.display_name || username,
        is_admin:      appUser?.is_admin || false,
      });
    }

    // POST /api/auth/change-password
    if (method === 'POST' && path.endsWith('/change-password')) {
      const user = await verifyToken(event.headers.authorization);
      if (!user) return response(401, { error: 'Non authentifié' });

      const { new_password } = JSON.parse(event.body || '{}');
      if (!new_password || new_password.length < 6) {
        return response(400, { error: 'Le mot de passe doit comporter au moins 6 caractères' });
      }

      const { error } = await supabase.auth.admin.updateUserById(user.id, { password: new_password });
      if (error) return response(500, { error: error.message });
      return response(200, { success: true });
    }

    // GET /api/auth/users — liste des agents pour le dropdown de transfert
    if (method === 'GET' && path.endsWith('/users')) {
      const user = await verifyToken(event.headers.authorization);
      if (!user) return response(401, { error: 'Non authentifié' });

      const { data, error } = await supabase
        .from('app_users')
        .select('email, display_name')
        .neq('email', user.email)
        .order('display_name');
      if (error) return response(500, { error: error.message });
      return response(200, data);
    }

    // GET /api/auth/config — config publique Supabase
    if (method === 'GET' && path.endsWith('/config')) {
      return response(200, {
        supabase_url:      process.env.SUPABASE_URL || '',
        supabase_anon_key: process.env.SUPABASE_ANON_KEY || '',
      });
    }

    return response(404, { error: 'Route introuvable' });
  } catch (err) {
    return response(500, { error: err.message });
  }
};
