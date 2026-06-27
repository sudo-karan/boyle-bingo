import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import * as api from './api'
import type {
  AuditEntry, CardCell, Game, GameEvent, EventPresence,
  LeaderboardRow, MergeProposal, PoolOption,
} from './types'

export interface GameData {
  game: Game
  pool: PoolOption[]
  cells: CardCell[]
  proposals: MergeProposal[]
  events: GameEvent[]
  presence: EventPresence[]
  leaderboard: LeaderboardRow[]
  audit: AuditEntry[]
  labels: Record<string, string>
  myVotes: Record<string, boolean>
  refresh: () => void
}

// Loads everything the current user is allowed to see for a game and keeps it
// live via Supabase Realtime. RLS decides what each role actually receives, so
// the target's client simply gets empty pool/cells.
export function useGame(game: Game, userId: string): GameData {
  const [pool, setPool] = useState<PoolOption[]>([])
  const [cells, setCells] = useState<CardCell[]>([])
  const [proposals, setProposals] = useState<MergeProposal[]>([])
  const [events, setEvents] = useState<GameEvent[]>([])
  const [presence, setPresence] = useState<EventPresence[]>([])
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([])
  const [audit, setAudit] = useState<AuditEntry[]>([])
  const [labels, setLabels] = useState<Record<string, string>>({})
  const [myVotes, setMyVotes] = useState<Record<string, boolean>>({})
  const [g, setG] = useState(game)
  const busy = useRef(false)

  const refresh = useCallback(async () => {
    if (busy.current) return
    busy.current = true
    try {
      const ev = await api.listEvents(g.id)
      const ids = ev.map((e) => e.id)
      const [p, c, mp, lb, au, pr, lab, mv] = await Promise.all([
        api.listPool(g.id),
        api.getMyCells(g.id, userId),
        api.listMergeProposals(g.id),
        api.getLeaderboard(g.id),
        api.listAudit(g.id),
        api.listPresence(ids),
        api.getEventLabels(g.id),
        api.listMyEventVotes(userId, ids),
      ])
      setEvents(ev); setPool(p); setCells(c); setProposals(mp)
      setLeaderboard(lb); setAudit(au); setPresence(pr)
      setLabels(lab); setMyVotes(mv)
    } finally {
      busy.current = false
    }
  }, [g.id, userId])

  useEffect(() => { refresh() }, [refresh])

  useEffect(() => {
    // refetch the game row itself for status transitions
    const reloadGame = async () => {
      const { data } = await supabase.from('games').select('*').eq('id', g.id).single()
      if (data) setG(data as Game)
    }
    const ch = supabase
      .channel(`game-${g.id}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'games', filter: `id=eq.${g.id}` },
        reloadGame)
    for (const table of ['pool_options', 'merge_proposals', 'merge_votes',
      'events', 'event_votes', 'event_presence', 'card_cells', 'audit_log']) {
      ch.on('postgres_changes', { event: '*', schema: 'public', table }, () => refresh())
    }
    ch.subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [g.id, refresh])

  // Other players' cross-outs are hidden from this client by RLS, so realtime
  // won't deliver them. Poll the aggregate-only leaderboard to stay live.
  useEffect(() => {
    if (g.status !== 'frozen' && g.status !== 'ended') return
    const id = setInterval(() => {
      api.getLeaderboard(g.id).then(setLeaderboard).catch(() => {})
    }, 15000)
    return () => clearInterval(id)
  }, [g.id, g.status])

  return { game: g, pool, cells, proposals, events, presence, leaderboard, audit, labels, myVotes, refresh }
}
