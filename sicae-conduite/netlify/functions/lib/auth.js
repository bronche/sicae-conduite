const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function verifyToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.replace('Bearer ', '').trim();
  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return null;
    return user;
  } catch {
    return null;
  }
}

async function verifyAdmin(authHeader) {
  const user = await verifyToken(authHeader);
  if (!user) return null;
  const { data } = await supabase
    .from('app_users')
    .select('is_admin')
    .eq('email', user.email)
    .single();
  if (!data?.is_admin) return null;
  return user;
}

function usernameToEmail(username) {
  const safe = username
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9._-]/g, '.')
    .replace(/\.{2,}/g, '.')
    .replace(/^\.+|\.+$/g, '');
  return `${safe || 'user'}@sicae.internal`;
}

module.exports = { supabase, verifyToken, verifyAdmin, usernameToEmail };
