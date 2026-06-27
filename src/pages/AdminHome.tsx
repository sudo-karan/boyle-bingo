import { useEffect, useState } from 'react'
import {
  createGame, startFill, listGames, createAccount,
  adminStrikeEvent, adminStrikePresence,
} from '../lib/api'
import { useGame } from '../lib/useGame'
import type { Game, Profile } from '../lib/types'
import Leaderboard from '../components/Leaderboard'

type Tab = 'setup' | 'accounts' | 'moderation'

export default function AdminHome({
  profiles, game, onGameChange,
}: {
  me: Profile; profiles: Profile[]; game: Game | null
  onGameChange: (g: Game | null) => void
}) {
  const [tab, setTab] = useState<Tab>('setup')
  return (
    <>
      <div className="tabs">
        {(['setup', 'accounts', 'moderation'] as Tab[]).map((t) => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>
      {tab === 'setup' && <Setup profiles={profiles} onCreated={onGameChange} />}
      {tab === 'accounts' && <Accounts profiles={profiles} />}
      {tab === 'moderation' && (game
        ? <Moderation game={game} profiles={profiles} />
        : <div className="panel muted center">No active game.</div>)}
    </>
  )
}

// ---- Setup ---------------------------------------------------------------
function Setup({
  profiles, onCreated,
}: { profiles: Profile[]; onCreated: (g: Game) => void }) {
  const players = profiles.filter((p) => !p.is_admin)
  const [games, setGames] = useState<Game[]>([])
  const [target, setTarget] = useState('')
  const [grid, setGrid] = useState(5)
  const [freeze, setFreeze] = useState('')
  const [ends, setEnds] = useState('')
  const [voteWindow, setVoteWindow] = useState(300)
  const [freeSpace, setFreeSpace] = useState(false)
  const names = Object.fromEntries(profiles.map((p) => [p.id, p.display_name]))

  const reload = () => listGames().then(setGames)
  useEffect(() => { reload() }, [])

  const create = async () => {
    if (!target || !freeze || !ends) { alert('Target, freeze and end times are required'); return }
    try {
      const g = await createGame({
        target, grid, freezeAt: new Date(freeze).toISOString(),
        endsAt: new Date(ends).toISOString(), voteWindow, freeSpace,
      })
      reload(); onCreated(g)
      alert('Game created in setup. Hit “Start fill” to reveal it to players.')
    } catch (e) { alert((e as Error).message) }
  }
  const start = async (id: string) => {
    try { await startFill(id); reload() } catch (e) { alert((e as Error).message) }
  }

  return (
    <>
      <div className="panel">
        <h2>New game</h2>
        <label className="field"><span>Target</span>
          <select value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">Pick a player…</option>
            {players.map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}
          </select>
        </label>
        <div className="row">
          <label className="field grow"><span>Grid</span>
            <select value={grid} onChange={(e) => setGrid(+e.target.value)}>
              {[3, 4, 5, 6, 7].map((n) => <option key={n} value={n}>{n}×{n}</option>)}
            </select>
          </label>
          <label className="field grow"><span>Vote window (s)</span>
            <input type="number" value={voteWindow} onChange={(e) => setVoteWindow(+e.target.value)} />
          </label>
        </div>
        <label className="field"><span>Freeze at (cards lock, live window opens)</span>
          <input type="datetime-local" value={freeze} onChange={(e) => setFreeze(e.target.value)} />
        </label>
        <label className="field"><span>Ends at</span>
          <input type="datetime-local" value={ends} onChange={(e) => setEnds(e.target.value)} />
        </label>
        <label className="row" style={{ gap: 8 }}>
          <input type="checkbox" style={{ width: 'auto' }} checked={freeSpace}
                 onChange={(e) => setFreeSpace(e.target.checked)} />
          <span className="small">Free centre space (odd grids only)</span>
        </label>
        <button className="primary" style={{ width: '100%', marginTop: 10 }} onClick={create}>
          Create game
        </button>
      </div>

      <div className="panel">
        <h2>Games</h2>
        <div className="list">
          {games.map((g) => (
            <div className="item row spread" key={g.id}>
              <div className="small">
                <b>{names[g.target_user_id] ?? '—'}</b> · {g.grid_size}×{g.grid_size}
                <span className="tag" style={{ marginLeft: 6 }}>{g.status}</span>
              </div>
              {g.status === 'setup' && <button className="sm primary" onClick={() => start(g.id)}>Start fill</button>}
            </div>
          ))}
          {games.length === 0 && <span className="muted small">No games yet.</span>}
        </div>
      </div>
    </>
  )
}

// ---- Accounts ------------------------------------------------------------
function Accounts({ profiles }: { profiles: Profile[] }) {
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [isAdmin, setIsAdmin] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const create = async () => {
    setBusy(true); setMsg('')
    try {
      await createAccount({ username, display_name: displayName, password, is_admin: isAdmin })
      setMsg(`Created ${username}.`); setUsername(''); setDisplayName(''); setPassword(''); setIsAdmin(false)
    } catch (e) { setMsg((e as Error).message) }
    finally { setBusy(false) }
  }

  return (
    <>
      <div className="panel">
        <h2>New account</h2>
        <label className="field"><span>Username</span>
          <input autoCapitalize="none" value={username} onChange={(e) => setUsername(e.target.value)} />
        </label>
        <label className="field"><span>Display name</span>
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </label>
        <label className="field"><span>Password</span>
          <input type="text" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <label className="row" style={{ gap: 8 }}>
          <input type="checkbox" style={{ width: 'auto' }} checked={isAdmin}
                 onChange={(e) => setIsAdmin(e.target.checked)} />
          <span className="small">Admin account</span>
        </label>
        {msg && <div className="banner warn">{msg}</div>}
        <button className="primary" style={{ width: '100%', marginTop: 10 }}
                disabled={busy} onClick={create}>Create account</button>
      </div>

      <div className="panel">
        <h2>Roster ({profiles.length})</h2>
        <div className="list">
          {profiles.map((p) => (
            <div className="item row spread" key={p.id}>
              <span>{p.display_name} <span className="muted small">@{p.username}</span></span>
              {p.is_admin && <span className="tag blue">admin</span>}
            </div>
          ))}
        </div>
      </div>
    </>
  )
}

// ---- Moderation ----------------------------------------------------------
function Moderation({ game, profiles }: { game: Game; profiles: Profile[] }) {
  const data = useGame(game, game.created_by)
  const names = Object.fromEntries(profiles.map((p) => [p.id, p.display_name]))

  const strikeEvent = async (id: string) => {
    if (!confirm('Strike this event? Cross-outs that relied on it are reverted.')) return
    try { await adminStrikeEvent(id); data.refresh() } catch (e) { alert((e as Error).message) }
  }
  const strikePresence = async (id: string) => {
    if (!confirm('Strike this presence record?')) return
    try { await adminStrikePresence(id); data.refresh() } catch (e) { alert((e as Error).message) }
  }
  const selfClaims = data.presence.filter((p) => p.added_via === 'self_claim')

  return (
    <>
      <Leaderboard rows={data.leaderboard} />

      <div className="panel">
        <h2>Events</h2>
        <div className="list">
          {data.events.map((e) => (
            <div className="item row spread" key={e.id}>
              <div className="small">
                {data.labels[e.id] ?? 'Activity'} <span className="tag">{e.status}</span>
                <div className="muted">by {names[e.raised_by] ?? '—'}</div>
              </div>
              {e.status !== 'rejected' &&
                <button className="danger sm" onClick={() => strikeEvent(e.id)}>Strike</button>}
            </div>
          ))}
          {data.events.length === 0 && <span className="muted small">No events.</span>}
        </div>
      </div>

      <div className="panel">
        <h2>Self-added presence</h2>
        <div className="list">
          {selfClaims.map((p) => (
            <div className="item row spread" key={p.id}>
              <span className="small">{names[p.user_id] ?? '?'} <span className="tag">{p.status}</span></span>
              {p.status !== 'rejected' &&
                <button className="danger sm" onClick={() => strikePresence(p.id)}>Strike</button>}
            </div>
          ))}
          {selfClaims.length === 0 && <span className="muted small">None.</span>}
        </div>
      </div>

      <div className="panel">
        <h2>Audit log</h2>
        <div className="list">
          {data.audit.map((a) => (
            <div className="item small" key={a.id}>
              <span className="muted">{new Date(a.created_at).toLocaleString()} · </span>
              {names[a.actor_id ?? ''] ?? 'admin'} — {a.action}
            </div>
          ))}
          {data.audit.length === 0 && <span className="muted small">Empty.</span>}
        </div>
      </div>
    </>
  )
}
