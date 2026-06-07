// scripts/create-users.js — création des comptes Supabase Auth
// Usage: node scripts/create-users.js
// Nécessite les variables SUPABASE_URL et SUPABASE_SERVICE_KEY dans l'environnement

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;

const USERS = [
  { email: 'bronchart@gmail.com',   password: 'Test123',  display_name: 'Bronchard (Admin)' },
  { email: 'agent.test@sicae.fr',   password: 'Test456',  display_name: 'Agent Test' },
];

async function createAuthUser(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'apikey': SERVICE_KEY,
    },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const data = await res.json();
  if (!res.ok) {
    if (data.msg && data.msg.includes('already')) return 'exists';
    throw new Error(data.msg || data.error || JSON.stringify(data));
  }
  return data.id;
}

async function upsertAppUser(email, display_name) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/app_users`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'apikey': SERVICE_KEY,
      'Prefer': 'resolution=merge-duplicates',
    },
    body: JSON.stringify({ email, display_name }),
  });
  return res.ok;
}

async function main() {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('⛔  Variables manquantes. Exécutez :');
    console.error('   SUPABASE_URL=https://xxx.supabase.co SUPABASE_SERVICE_KEY=sb_secret_... node scripts/create-users.js');
    process.exit(1);
  }

  for (const u of USERS) {
    try {
      const result = await createAuthUser(u.email, u.password);
      if (result === 'exists') {
        console.log(`⚠️  Déjà existant : ${u.email}`);
      } else {
        console.log(`✅  Compte créé : ${u.email}`);
      }
      await upsertAppUser(u.email, u.display_name);
      console.log(`   ↳ Profil app_users : ${u.display_name}`);
    } catch (e) {
      console.error(`❌  Erreur pour ${u.email} :`, e.message);
    }
  }
}

main();
