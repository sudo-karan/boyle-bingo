import { useState } from 'react'
import { raiseEvent } from '../lib/api'
import { compressAndUpload } from '../lib/image'
import type { GameData } from '../lib/useGame'
import type { Game, Profile } from '../lib/types'

export default function RaiseForm({
  game, me, data, profiles,
}: { game: Game; me: Profile; data: GameData; profiles: Profile[] }) {
  const [open, setOpen] = useState(false)
  const [optionId, setOptionId] = useState('')
  const [remarks, setRemarks] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [present, setPresent] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  // selectable witnesses: non-admin players (incl. target), excluding the raiser
  const others = profiles.filter((p) => !p.is_admin && p.id !== me.id)
  const nonTargetPresent = [...present].filter((id) => id !== game.target_user_id).length
  const canSubmit = optionId && nonTargetPresent >= 1 // +1 for the raiser = ≥2

  const toggle = (id: string) =>
    setPresent((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  const submit = async () => {
    setBusy(true)
    try {
      const photoUrl = file ? await compressAndUpload(file, game.id) : null
      await raiseEvent({
        gameId: game.id, optionId, remarks, photoUrl, present: [...present],
      })
      setOpen(false); setOptionId(''); setRemarks(''); setFile(null); setPresent(new Set())
      data.refresh()
    } catch (e) { alert((e as Error).message) }
    finally { setBusy(false) }
  }

  if (!open) {
    return <button className="primary" style={{ width: '100%', margin: '12px 0' }}
                   onClick={() => setOpen(true)}>＋ Raise an activity</button>
  }

  return (
    <div className="panel">
      <div className="row spread"><h2>Raise an activity</h2>
        <button className="ghost sm" onClick={() => setOpen(false)}>Cancel</button></div>

      <label className="field"><span>What happened?</span>
        <select value={optionId} onChange={(e) => setOptionId(e.target.value)}>
          <option value="">Pick a prediction…</option>
          {data.pool.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      </label>

      <label className="field"><span>Remarks</span>
        <textarea rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
      </label>

      <label className="field"><span>Photo (optional — breaks ties, serves as evidence)</span>
        <input type="file" accept="image/*" capture="environment"
               onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </label>

      <div className="field">
        <span>Who was present? (you're included)</span>
        <div className="list" style={{ maxHeight: 220, overflow: 'auto' }}>
          {others.map((p) => (
            <button key={p.id} className={present.has(p.id) ? 'primary' : 'ghost'}
                    style={{ textAlign: 'left' }} onClick={() => toggle(p.id)}>
              {p.display_name}
              {p.id === game.target_user_id && <span className="tag" style={{ marginLeft: 6 }}>target</span>}
            </button>
          ))}
        </div>
        {nonTargetPresent < 1 && (
          <p className="banner err">Need at least one other witness besides you and the target.</p>
        )}
      </div>

      <button className="primary" style={{ width: '100%' }} disabled={!canSubmit || busy}
              onClick={submit}>{busy ? 'Raising…' : 'Raise'}</button>
    </div>
  )
}
