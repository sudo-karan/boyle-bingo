// Supabase Edge Function: admin-create-user
// Creates a player/admin account. Verifies the CALLER is an admin (via their
// JWT) and only then uses the service_role key to create the auth user +
// profile. The service_role key never leaves the server.
//
// Deploy:  supabase functions deploy admin-create-user --no-verify-jwt
// (we verify the JWT ourselves so we can return clean errors)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const EMAIL_DOMAIN = Deno.env.get('USERNAME_EMAIL_DOMAIN') ?? 'boylebingo.local'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

  try {
    const url = Deno.env.get('SUPABASE_URL')!
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    // 1. Identify the caller from their bearer token.
    const authHeader = req.headers.get('Authorization') ?? ''
    const caller = createClient(url, anon, { global: { headers: { Authorization: authHeader } } })
    const { data: who } = await caller.auth.getUser()
    if (!who?.user) return json({ error: 'not authenticated' }, 401)

    // 2. Confirm the caller is an admin.
    const admin = createClient(url, service)
    const { data: prof } = await admin.from('profiles')
      .select('is_admin').eq('id', who.user.id).single()
    if (!prof?.is_admin) return json({ error: 'admin only' }, 403)

    // 3. Validate input.
    const { username, display_name, password, is_admin } = await req.json()
    if (!username || !password || !display_name) return json({ error: 'username, display_name and password are required' }, 400)
    const uname = String(username).trim().toLowerCase()
    if (!/^[a-z0-9_.-]{2,32}$/.test(uname)) return json({ error: 'invalid username' }, 400)
    if (String(password).length < 6) return json({ error: 'password too short (min 6)' }, 400)

    // 4. Create the auth user (email = synthetic username@domain).
    const email = `${uname}@${EMAIL_DOMAIN}`
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email, password, email_confirm: true,
      user_metadata: { username: uname, display_name },
    })
    if (createErr || !created?.user) return json({ error: createErr?.message ?? 'could not create user' }, 400)

    // 5. Create the profile row.
    const { error: profErr } = await admin.from('profiles').insert({
      id: created.user.id, username: uname, display_name,
      is_admin: !!is_admin,
    })
    if (profErr) {
      // roll back the auth user if the profile insert fails (e.g. dup username)
      await admin.auth.admin.deleteUser(created.user.id)
      return json({ error: profErr.message }, 400)
    }

    return json({ id: created.user.id, username: uname, display_name, is_admin: !!is_admin })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
