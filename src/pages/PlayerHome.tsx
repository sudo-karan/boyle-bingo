import { useEffect } from 'react'
import { useGame } from '../lib/useGame'
import { ensureCard } from '../lib/api'
import type { Game, Profile } from '../lib/types'
import Leaderboard from '../components/Leaderboard'
import FillBoard from './FillBoard'
import LiveBoard from './LiveBoard'

export default function PlayerHome({
  game, me, profiles, names,
}: {
  game: Game; me: Profile; profiles: Profile[]; names: Record<string, string>
}) {
  const data = useGame(game, me.id)

  // Make sure this player has a card as soon as fill opens.
  useEffect(() => {
    if (game.status === 'fill') ensureCard(game.id).then(data.refresh).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.id, game.status])

  return (
    <>
      <div className="row spread small" style={{ margin: '6px 2px' }}>
        <span className="muted">Target: {names[game.target_user_id] ?? '—'}</span>
        <PhaseTag status={game.status} />
      </div>

      {game.status === 'fill' && <FillBoard game={game} me={me} data={data} names={names} />}
      {(game.status === 'frozen' || game.status === 'ended') && (
        <LiveBoard game={game} me={me} data={data} profiles={profiles} names={names} />
      )}

      <Leaderboard rows={data.leaderboard} meId={me.id} />
    </>
  )
}

function PhaseTag({ status }: { status: Game['status'] }) {
  const map: Record<string, string> = { fill: 'blue', frozen: 'amber', ended: 'red' }
  const label: Record<string, string> = { fill: 'FILL', frozen: 'LIVE', ended: 'ENDED' }
  return <span className={`tag ${map[status] ?? ''}`}>{label[status] ?? status}</span>
}
