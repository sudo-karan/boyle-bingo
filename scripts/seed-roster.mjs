// Batch-create accounts from a JSON roster (handy for loading the initial group
// in one go instead of typing each into the admin screen). Uses the
// service_role key — run locally, never ship it.
//
//   SUPABASE_URL=https://xxx.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=eyJ... \
//   node scripts/seed-roster.mjs roster.json
//
// roster.json:
//   [
//     { "username": "karan",  "display_name": "Karan", "password": "pw1", "is_admin": true },
//     { "username": "alice",  "display_name": "Alice", "password": "pw2" },
//     { "username": "bob",    "display_name": "Bob",   "password": "pw3" }
//   ]

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const domain = process.env.USERNAME_EMAIL_DOMAIN || 'boylebingo.local'
const file = process.argv[2]

if (!url || !key) { console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY'); process.exit(1) }
if (!file) { console.error('Usage: node scripts/seed-roster.mjs <roster.json>'); process.exit(1) }

const roster = JSON.parse(readFileSync(file, 'utf8'))
const admin = createClient(url, key)

for (const u of roster) {
  const username = String(u.username).trim().toLowerCase()
  const email = `${username}@${domain}`
  const { data, error } = await admin.auth.admin.createUser({
    email, password: u.password, email_confirm: true,
    user_metadata: { username, display_name: u.display_name },
  })
  if (error) { console.error(`✗ ${username}: ${error.message}`); continue }

  const { error: pErr } = await admin.from('profiles').insert({
    id: data.user.id, username, display_name: u.display_name, is_admin: !!u.is_admin,
  })
  if (pErr) {
    await admin.auth.admin.deleteUser(data.user.id)
    console.error(`✗ ${username}: ${pErr.message}`)
  } else {
    console.log(`✓ ${username}${u.is_admin ? ' (admin)' : ''}`)
  }
}
console.log('Done.')
