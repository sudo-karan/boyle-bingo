import { useGame } from '../lib/useGame'
import type { Game, Profile } from '../lib/types'
import Leaderboard from '../components/Leaderboard'
import ApprovalPrompts from '../components/ApprovalPrompts'

// The target sees only: the warning, approval prompts for events they're present
// at, the incremental reveal of approved activities, and the leaderboard. RLS
// guarantees their client never receives the pool or anyone's card.
export default function TargetHome({
  game, me, names,
}: { game: Game; me: Profile; names: Record<string, string> }) {
  const data = useGame(game, me.id)
  const approved = data.events.filter((e) => e.status === 'approved')

  return (
    <>
      <div className="big-target">
        <h1>You are the target.</h1>
        <p className="muted">Beware.</p>
      </div>

      {(game.status === 'frozen') && (
        <ApprovalPrompts
          events={data.events} presence={data.presence} labels={data.labels}
          myVotes={data.myVotes} meId={me.id} isTarget names={names}
          onChange={data.refresh}
        />
      )}

      <div className="panel">
        <h2>Confirmed about you ({approved.length})</h2>
        {approved.length === 0 && <p className="muted small">Nothing confirmed yet. Stay unpredictable.</p>}
        <div className="list">
          {approved.map((e) => (
            <div className="item" key={e.id}>
              <strong>{data.labels[e.id] ?? 'Activity'}</strong>
              {e.remarks && <div className="small muted" style={{ marginTop: 4 }}>{e.remarks}</div>}
              {e.photo_url && <img className="photo" src={e.photo_url} alt="" />}
            </div>
          ))}
        </div>
      </div>

      <Leaderboard rows={data.leaderboard} />
    </>
  )
}
