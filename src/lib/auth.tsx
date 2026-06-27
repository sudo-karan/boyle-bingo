import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { supabase, usernameToEmail } from './supabase'
import { getProfile } from './api'
import type { Profile } from './types'

interface AuthState {
  loading: boolean
  userId: string | null
  profile: Profile | null
  signIn: (username: string, password: string) => Promise<void>
  signOut: () => Promise<void>
}

const Ctx = createContext<AuthState>(null as unknown as AuthState)
export const useAuth = () => useContext(Ctx)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true)
  const [userId, setUserId] = useState<string | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)

  useEffect(() => {
    const load = async (uid: string | null) => {
      setUserId(uid)
      setProfile(uid ? await getProfile(uid).catch(() => null) : null)
      setLoading(false)
    }
    supabase.auth.getSession().then(({ data }) => load(data.session?.user.id ?? null))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      load(session?.user.id ?? null)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  const signIn = async (username: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email: usernameToEmail(username), password,
    })
    if (error) throw new Error('Wrong username or password')
  }
  const signOut = async () => { await supabase.auth.signOut() }

  return (
    <Ctx.Provider value={{ loading, userId, profile, signIn, signOut }}>
      {children}
    </Ctx.Provider>
  )
}
