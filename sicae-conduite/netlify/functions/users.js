const { supabase, verifyAdmin, usernameToEmail } = require('./lib/auth');

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

  const admin = await verifyAdmin(event.headers.authorization);
  if (!admin) return response(403, { error: 'Accès refusé — réservé aux administrateurs' });

  const method = event.httpMethod;

  // Extrait /users[/:email[/:action]] depuis le path
  const m = (event.path || '').match(/\/users\/?([^/]+)?(?:\/([^/]+))?$/);
  const rawId = m?.[1];
  const targetEmail = rawId && rawId !== 'users' ? decodeURIComponent(rawId) : null;
  const action = m?.[2] || null;

  try {
    // GET /api/users — liste tous les utilisateurs
    if (method === 'GET' && !targetEmail) {
      const { data, error } = await supabase
        .from('app_users')
        .select('email, display_name, is_admin')
        .order('display_name');
      if (error) return response(500, { error: error.message });
      return response(200, data);
    }

    // POST /api/users — créer un utilisateur
    if (method === 'POST' && !targetEmail) {
      const { username, password, is_admin = false } = JSON.parse(event.body || '{}');
      if (!username || !password) return response(400, { error: 'Nom et mot de passe requis' });
      if (username.trim().length < 2) return response(400, { error: 'Le nom doit comporter au moins 2 caractères' });
      if (password.length < 6) return response(400, { error: 'Mot de passe : 6 caractères minimum' });

      const email = usernameToEmail(username.trim());

      const { data: existing } = await supabase
        .from('app_users').select('email').eq('email', email).single();
      if (existing) return response(409, { error: 'Un utilisateur avec ce nom existe déjà' });

      const { data: authData, error: authError } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (authError) return response(500, { error: authError.message });

      const { error: dbError } = await supabase
        .from('app_users')
        .insert([{ email, display_name: username.trim(), is_admin }]);
      if (dbError) {
        await supabase.auth.admin.deleteUser(authData.user.id);
        return response(500, { error: dbError.message });
      }

      return response(201, { email, display_name: username.trim(), is_admin });
    }

    // DELETE /api/users/:email — supprimer un utilisateur
    if (method === 'DELETE' && targetEmail && !action) {
      if (targetEmail === admin.email) {
        return response(400, { error: 'Vous ne pouvez pas supprimer votre propre compte' });
      }

      const { data: authList } = await supabase.auth.admin.listUsers();
      const authUser = authList?.users?.find(u => u.email === targetEmail);

      await supabase.from('app_users').delete().eq('email', targetEmail);
      if (authUser) await supabase.auth.admin.deleteUser(authUser.id);

      return response(200, { success: true });
    }

    // PUT /api/users/:email/password — réinitialiser le mot de passe
    if (method === 'PUT' && targetEmail && action === 'password') {
      const { password } = JSON.parse(event.body || '{}');
      if (!password || password.length < 6) return response(400, { error: '6 caractères minimum' });

      const { data: authList } = await supabase.auth.admin.listUsers();
      const authUser = authList?.users?.find(u => u.email === targetEmail);
      if (!authUser) return response(404, { error: 'Utilisateur introuvable' });

      const { error } = await supabase.auth.admin.updateUserById(authUser.id, { password });
      if (error) return response(500, { error: error.message });
      return response(200, { success: true });
    }

    // PUT /api/users/:email/admin — modifier le statut administrateur
    if (method === 'PUT' && targetEmail && action === 'admin') {
      if (targetEmail === admin.email) {
        return response(400, { error: 'Vous ne pouvez pas modifier votre propre statut admin' });
      }
      const { is_admin } = JSON.parse(event.body || '{}');
      const { error } = await supabase
        .from('app_users').update({ is_admin }).eq('email', targetEmail);
      if (error) return response(500, { error: error.message });
      return response(200, { success: true });
    }

    return response(404, { error: 'Route introuvable' });
  } catch (err) {
    return response(500, { error: err.message });
  }
};
