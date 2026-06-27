import { claimPresence, votePresence } from '../lib/api'
import type { GameData } from '../lib/useGame'
import type { Game, Profile } from '../lib/types'

export default function EventFeed({
  game, me, data, names,
}: { game: Game; me: Profile; data: GameData; names: Record<string, string> }) {
  const { events, presence, labels } = data
  const iAmTarget = me.id === game.target_user_id

  const presenceFor = (eventId: string) => presence.filter((p) => p.event_id === eventId)
  const myStatus = (eventId: string) =>
    presenceFor(eventId).find((p) => p.user_id === me.id)?.status
  const iAmCohort = (eventId: string) =>
    presenceFor(eventId).some((p) => p.user_id === me.id && p.status === 'confirmed')

  const claim = async (id: string) => {
    try { await claimPresence(id); data.refresh() } catch (e) { alert((e as Error).message) }
  }
  const voteClaim = async (pid: string, v: boolean) => {
    try { await votePresence(pid, v); data.refresh() } catch (e) { alert((e as Error).message) }
  }

  if (events.length === 0) return null

  const tag = (s: string) =>
    s === 'approved' ? <span className="tag green">approved</span>
    : s === 'rejected' ? <span className="tag red">rejected</span>
    : <span className="tag amber">voting</span>

  return (
    <div className="panel">
      <h2>Activity feed</h2>
      <div className="list">
        {events.map((e) => {
          const claims = presenceFor(e.id).filter((p) => p.status === 'claimed')
          const confirmed = presenceFor(e.id).filter((p) => p.status === 'confirmed')
          const canClaim = e.status === 'approved' && !iAmTarget && !myStatus(e.id)
          return (
            <div className="item" key={e.id}>
              <div className="row spread">
                <strong>{labels[e.id] ?? 'Activity'}</strong>
                {tag(e.status)}
              </div>
              <div className="small muted">raised by {names[e.raised_by] ?? '—'}</div>
              {e.remarks && <div className="small" style={{ marginTop: 4 }}>{e.remarks}</div>}
              {e.photo_url && <img className="photo" src={e.photo_url} alt="" />}

              {confirmed.length > 0 && (
                <div className="small muted" style={{ marginTop: 6 }}>
                  Present: {confirmed.map((p) => names[p.user_id] ?? '?').join(', ')}
                </div>
              )}

              {/* presence self-claims awaiting the cohort's ≥50% vote */}
              {claims.map((c) => (
                <div className="row spread" key={c.id}
                     style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid var(--line)' }}>
                  <span className="small">{names[c.user_id] ?? '?'} says they were there too</span>
                  {iAmCohort(e.id) && !iAmTarget && c.user_id !== me.id ? (
                    <span className="row">
                      <button className="yes sm" onClick={() => voteClaim(c.id, true)}>Yes</button>
                      <button className="no sm" onClick={() => voteClaim(c.id, false)}>No</button>
                    </span>
                  ) : <span className="tag amber">pending</span>}
                </div>
              ))}

              {canClaim && (
                <button className="ghost sm" style={{ marginTop: 8 }}
                        onClick={() => claim(e.id)}>I was there too</button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
