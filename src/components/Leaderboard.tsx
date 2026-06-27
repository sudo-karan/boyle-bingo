import { rankLeaderboard } from '../lib/leaderboard'
import type { LeaderboardRow } from '../lib/types'

export default function Leaderboard({
  rows, meId,
}: { rows: LeaderboardRow[]; meId?: string }) {
  const ranked = rankLeaderboard(rows)
  return (
    <div className="panel">
      <h2>Leaderboard</h2>
      {ranked.length === 0 && <p className="muted small">No players yet.</p>}
      <div>
        {ranked.map((r) => (
          <div className="lb-row" key={r.user_id}
               style={r.user_id === meId ? { color: 'var(--green)' } : undefined}>
            <div className="rank">{r.rank}</div>
            <div>
              {r.display_name}
              {r.blackout && <span className="tag green" style={{ marginLeft: 6 }}>BLACKOUT</span>}
              {!r.blackout && r.has_line && <span className="tag amber" style={{ marginLeft: 6 }}>LINE</span>}
            </div>
            <div className="muted">{r.crossed}/{r.filled}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
