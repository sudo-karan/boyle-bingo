import type { LeaderboardRow } from './types'

export interface RankedRow extends LeaderboardRow {
  rank: number
  tier: 'blackout' | 'line' | 'progress'
}

const t = (s: string | null) => (s ? new Date(s).getTime() : Infinity)

// Tiers: blackout > at-least-one-line > everyone-else (by cells crossed).
// Ties broken by the earliest relevant timestamp.
export function rankLeaderboard(rows: LeaderboardRow[]): RankedRow[] {
  const sorted = [...rows].sort((a, b) => {
    const tier = (r: LeaderboardRow) => (r.blackout ? 0 : r.has_line ? 1 : 2)
    if (tier(a) !== tier(b)) return tier(a) - tier(b)
    if (a.blackout && b.blackout) return t(a.blackout_at) - t(b.blackout_at)
    if (a.has_line && b.has_line) return t(a.first_line_at) - t(b.first_line_at)
    if (a.crossed !== b.crossed) return b.crossed - a.crossed
    return t(a.last_cross_at) - t(b.last_cross_at)
  })
  return sorted.map((r, i) => ({
    ...r,
    rank: i + 1,
    tier: r.blackout ? 'blackout' : r.has_line ? 'line' : 'progress',
  }))
}
