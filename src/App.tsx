import { useEffect, useState } from 'react'
import { useAuth } from './lib/auth'
import { getActiveGame, listProfiles, tick } from './lib/api'
import type { Game, Profile } from './lib/types'
import Login from './components/Login'
import AdminHome from './pages/AdminHome'
import PlayerHome from './pages/PlayerHome'
import TargetHome from './pages/TargetHome'

function useOnline() {
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false)
    window.addEventListener('online', on); window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])
  return online
}

export default function App() {
  const { loading, profile, signOut } = useAuth()
  const online = useOnline()
  const [game, setGame] = useState<Game | null>(null)
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!profile) { setReady(true); return }
    tick() // nudge phase transitions in case pg_cron isn't enabled
    Promise.all([getActiveGame(), listProfiles()]).then(([g, ps]) => {
      setGame(g); setProfiles(ps); setReady(true)
    })
  }, [profile])

  if (loading || !ready) return <div className="app center muted" style={{ padding: 40 }}>Loading…</div>
  if (!profile) return <Login />

  const names = Object.fromEntries(profiles.map((p) => [p.id, p.display_name]))
  const isTarget = game?.target_user_id === profile.id

  return (
    <>
      {!online && <div className="offline">Offline — live actions need a connection</div>}
      <div className="app">
        <div className="topbar">
          <h1>Boyle Bingo</h1>
          <div className="row small">
            <span className="muted">{profile.display_name}</span>
            <button className="ghost sm" onClick={signOut}>Sign out</button>
          </div>
        </div>

        {profile.is_admin ? (
          <AdminHome me={profile} profiles={profiles} game={game} onGameChange={setGame} />
        ) : !game ? (
          <div className="panel center muted">No active game yet. Sit tight.</div>
        ) : isTarget ? (
          <TargetHome game={game} me={profile} names={names} />
        ) : (
          <PlayerHome game={game} me={profile} profiles={profiles} names={names} />
        )}
      </div>
    </>
  )
}
