import { useMemo } from 'react'
import { crossOut } from '../lib/api'
import type { GameData } from '../lib/useGame'
import type { Game, Profile } from '../lib/types'
import Countdown from '../components/Countdown'
import ApprovalPrompts from '../components/ApprovalPrompts'
import RaiseForm from '../components/RaiseForm'
import EventFeed from '../components/EventFeed'

export default function LiveBoard({
  game, me, data, profiles, names,
}: {
  game: Game; me: Profile; data: GameData; profiles: Profile[]; names: Record<string, string>
}) {
  const { cells, events, presence, labels } = data
  const live = game.status === 'frozen'

  // Options I'm eligible to cross out: an approved event for that option where
  // I'm a confirmed-present user.
  const eligibleOptions = useMemo(() => {
    const myEvents = new Set(
      presence.filter((p) => p.user_id === me.id && p.status === 'confirmed').map((p) => p.event_id),
    )
    const ok = new Set<string>()
    for (const e of events) {
      if (e.status === 'approved' && myEvents.has(e.id)) ok.add(e.pool_option_id)
    }
    return ok
  }, [events, presence, me.id])

  const cross = async (cellId: string) => {
    try { await crossOut(cellId); data.refresh() } catch (e) { alert((e as Error).message) }
  }

  return (
    <>
      {live ? (
        <div className="banner warn">Live window — ends in <Countdown to={game.ends_at} />.</div>
      ) : (
        <div className="banner err">Game over. Final standings below.</div>
      )}

      {live && (
        <ApprovalPrompts
          events={events} presence={presence} labels={labels} myVotes={data.myVotes}
          meId={me.id} isTarget={false} names={names} onChange={data.refresh}
        />
      )}

      <div className="panel">
        <h2>Your card</h2>
        <div className="grid" style={{ gridTemplateColumns: `repeat(${game.grid_size}, 1fr)` }}>
          {cells.map((c) => {
            const crossed = !!c.crossed_at
            const eligible = !crossed && c.pool_option_id != null && eligibleOptions.has(c.pool_option_id)
            return (
              <div key={c.id}
                   className={`cell ${c.pool_option_id ? 'filled' : 'empty'} ${crossed ? 'crossed' : ''} ${eligible ? 'eligible' : ''}`}
                   onClick={() => eligible && cross(c.id)}
                   title={eligible ? 'Tap to cross out' : ''}>
                {c.pool_option_id ? data.pool.find((o) => o.id === c.pool_option_id)?.label ?? '…' : ''}
              </div>
            )
          })}
        </div>
        <p className="muted small">Glowing cells are confirmed & you were there — tap to cross out.</p>
      </div>

      {live && <RaiseForm game={game} me={me} data={data} profiles={profiles} />}

      <EventFeed game={game} me={me} data={data} names={names} />
    </>
  )
}
