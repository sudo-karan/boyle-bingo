import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string

export const EMAIL_DOMAIN =
  (import.meta.env.VITE_USERNAME_EMAIL_DOMAIN as string) || 'boylebingo.local'

if (!url || !anon) {
  // Surface misconfiguration loudly rather than failing with cryptic errors.
  console.error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — see .env.example')
}

export const supabase = createClient(url, anon, {
  auth: { persistSession: true, autoRefreshToken: true },
})

// Username -> synthetic email so users only ever type a username.
export const usernameToEmail = (username: string) =>
  `${username.trim().toLowerCase()}@${EMAIL_DOMAIN}`
