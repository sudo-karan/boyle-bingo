import { useMemo, useState } from 'react'
import { addPoolOption, placeCell, proposeMerge, voteMerge } from '../lib/api'
import type { GameData } from '../lib/useGame'
import type { Game, Profile } from '../lib/types'
import Countdown from '../components/Countdown'

export default function FillBoard({
  game, data, names,
}: { game: Game; me: Profile; data: GameData; names: Record<string, string> }) {
  const { pool, cells } = data
  const [label, setLabel] = useState('')
  const [activeCell, setActiveCell] = useState<string | null>(null)
  const optById = useMemo(() => Object.fromEntries(pool.map((o) => [o.id, o.label])), [pool])
  const usedOptionIds = new Set(cells.map((c) => c.pool_option_id).filter(Boolean) as string[])

  const add = async () => {
    if (!label.trim()) return
    try { await addPoolOption(game.id, label); setLabel(''); data.refresh() }
    catch (e) { alert((e as Error).message) }
  }
  const assign = async (optionId: string | null) => {
    if (!activeCell) return
    try { await placeCell(activeCell, optionId); setActiveCell(null); data.refresh() }
    catch (e) { alert((e as Error).message) }
  }

  return (
    <>
      <div className="banner warn">
        Cards lock at freeze — <Countdown to={game.freeze_at} />. Only things after
        freeze count.
      </div>

      {/* Card editor */}
      <div className="panel">
        <h2>Your card ({game.grid_size}×{game.grid_size})</h2>
        <div className="grid" style={{ gridTemplateColumns: `repeat(${game.grid_size}, 1fr)` }}>
          {cells.map((c) => (
            <div key={c.id}
                 className={`cell ${c.pool_option_id ? 'filled' : 'empty'} ${activeCell === c.id ? 'eligible' : ''}`}
                 onClick={() => setActiveCell(activeCell === c.id ? null : c.id)}>
              {c.pool_option_id ? optById[c.pool_option_id] ?? '…' : '+'}
            </div>
          ))}
        </div>
        {activeCell && (
          <div className="panel" style={{ marginTop: 8 }}>
            <div className="row spread">
              <strong className="small">Place an option</strong>
              <button className="ghost sm" onClick={() => assign(null)}>Clear cell</button>
            </div>
            <div className="list" style={{ marginTop: 8, maxHeight: 220, overflow: 'auto' }}>
              {pool.filter((o) => !usedOptionIds.has(o.id)).map((o) => (
                <button key={o.id} className="ghost" style={{ textAlign: 'left' }}
                        onClick={() => assign(o.id)}>{o.label}</button>
              ))}
              {pool.filter((o) => !usedOptionIds.has(o.id)).length === 0 &&
                <span className="muted small">No unused options — add some below.</span>}
            </div>
          </div>
        )}
      </div>

      {/* Pool + add */}
      <div className="panel">
        <h2>Shared pool ({pool.length})</h2>
        <div className="row">
          <input className="grow" placeholder="Predict something the target will say/do…"
                 value={label} onChange={(e) => setLabel(e.target.value)}
                 onKeyDown={(e) => e.key === 'Enter' && add()} />
          <button className="primary" onClick={add}>Add</button>
        </div>
        <div className="list" style={{ marginTop: 10 }}>
          {pool.map((o) => (
            <div className="item row spread" key={o.id}>
              <span>{o.label}</span>
              <span className="tag">{names[o.created_by] ?? ''}</span>
            </div>
          ))}
        </div>
      </div>

      <MergePanel game={game} data={data} optById={optById} names={names} />
    </>
  )
}

function MergePanel({
  game, data, optById, names,
}: { game: Game; data: GameData; optById: Record<string, string>; names: Record<string, string> }) {
  const { pool, proposals } = data
  const [a, setA] = useState(''); const [b, setB] = useState(''); const [canon, setCanon] = useState('')

  const propose = async () => {
    if (!a || !b || a === b || !canon.trim()) { alert('Pick two different options and a label'); return }
    try { await proposeMerge(game.id, a, b, canon); setA(''); setB(''); setCanon(''); data.refresh() }
    catch (e) { alert((e as Error).message) }
  }
  const vote = async (id: string, v: boolean) => {
    try { await voteMerge(id, v); data.refresh() } catch (e) { alert((e as Error).message) }
  }

  return (
    <div className="panel">
      <h2>Merge duplicates</h2>
      <div className="col">
        <div className="row">
          <select className="grow" value={a} onChange={(e) => setA(e.target.value)}>
            <option value="">Option A…</option>
            {pool.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
          <select className="grow" value={b} onChange={(e) => setB(e.target.value)}>
            <option value="">Option B…</option>
            {pool.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </div>
        <input placeholder="Canonical label" value={canon} onChange={(e) => setCanon(e.target.value)} />
        <button onClick={propose}>Propose merge</button>
      </div>

      {proposals.length > 0 && (
        <div className="list" style={{ marginTop: 12 }}>
          {proposals.map((p) => (
            <div className="item" key={p.id}>
              <div className="small">
                Merge <b>{optById[p.option_a_id] ?? '?'}</b> + <b>{optById[p.option_b_id] ?? '?'}</b>
                {' '}→ <b>{p.canonical_label}</b>
                <span className="tag" style={{ marginLeft: 6 }}>{names[p.proposed_by] ?? ''}</span>
              </div>
              <div className="row" style={{ marginTop: 8 }}>
                <button className="yes grow" onClick={() => vote(p.id, true)}>Yes</button>
                <button className="no grow" onClick={() => vote(p.id, false)}>No</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
