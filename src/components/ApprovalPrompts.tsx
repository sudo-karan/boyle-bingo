import { useState } from 'react'
import { voteEvent } from '../lib/api'
import type { GameEvent, EventPresence } from '../lib/types'

// Approval prompts for events the user is present at and that are still voting.
// Used by both players and the target (the target's vote is recorded but, the
// banner notes, not counted in the tally).
export default function ApprovalPrompts({
  events, presence, labels, myVotes, meId, isTarget, names, onChange,
}: {
  events: GameEvent[]
  presence: EventPresence[]
  labels: Record<string, string>
  myVotes: Record<string, boolean>
  meId: string
  isTarget: boolean
  names: Record<string, string>
  onChange: () => void
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const presentMine = new Set(
    presence.filter((p) => p.user_id === meId && p.status === 'confirmed').map((p) => p.event_id),
  )
  const pending = events.filter((e) => e.status === 'voting' && presentMine.has(e.id))
  if (pending.length === 0) return null

  const vote = async (id: string, v: boolean) => {
    setBusy(id)
    try { await voteEvent(id, v); onChange() }
    catch (e) { alert((e as Error).message) }
    finally { setBusy(null) }
  }

  return (
    <div className="panel">
      <h2>Did this happen?</h2>
      {isTarget && (
        <div className="banner warn">Your vote is recorded but doesn't count — you can't veto.</div>
      )}
      <div className="list">
        {pending.map((e) => {
          const voted = e.id in myVotes
          return (
            <div className="item" key={e.id}>
              <div className="row spread">
                <strong>{labels[e.id] ?? 'Activity'}</strong>
                <span className="tag">by {names[e.raised_by] ?? '—'}</span>
              </div>
              {e.remarks && <div className="small" style={{ marginTop: 4 }}>{e.remarks}</div>}
              {e.photo_url && <img className="photo" src={e.photo_url} alt="" />}
              <div className="row" style={{ marginTop: 8 }}>
                <button className={`yes grow${voted && myVotes[e.id] ? ' primary' : ''}`}
                        disabled={busy === e.id} onClick={() => vote(e.id, true)}>
                  Yes{voted && myVotes[e.id] ? ' ✓' : ''}
                </button>
                <button className={`no grow${voted && !myVotes[e.id] ? ' danger' : ''}`}
                        disabled={busy === e.id} onClick={() => vote(e.id, false)}>
                  No{voted && !myVotes[e.id] ? ' ✓' : ''}
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
