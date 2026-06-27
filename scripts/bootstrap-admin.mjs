// One-off: create the FIRST admin account (chicken-and-egg — the in-app account
// screen needs an admin to already exist). Run locally, never ship the key.
//
//   SUPABASE_URL=https://xxx.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=eyJ... \
//   node scripts/bootstrap-admin.mjs <username> <display name> <password>
//
// Uses the service_role key, which must stay on your machine.

import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const domain = process.env.USERNAME_EMAIL_DOMAIN || 'boylebingo.local'
const [username, displayName, password] = process.argv.slice(2)

if (!url || !key) { console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY'); process.exit(1) }
if (!username || !displayName || !password) {
  console.error('Usage: node scripts/bootstrap-admin.mjs <username> <display name> <password>')
  process.exit(1)
}

const admin = createClient(url, key)
const email = `${username.toLowerCase()}@${domain}`

const { data, error } = await admin.auth.admin.createUser({
  email, password, email_confirm: true,
  user_metadata: { username: username.toLowerCase(), display_name: displayName },
})
if (error) { console.error('createUser failed:', error.message); process.exit(1) }

const { error: pErr } = await admin.from('profiles').insert({
  id: data.user.id, username: username.toLowerCase(), display_name: displayName, is_admin: true,
})
if (pErr) {
  await admin.auth.admin.deleteUser(data.user.id)
  console.error('profile insert failed:', pErr.message); process.exit(1)
}
console.log(`Admin '${username}' created. Sign in with that username + password.`)
