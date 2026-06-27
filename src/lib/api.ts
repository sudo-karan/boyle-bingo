import { supabase } from './supabase'
import type {
  AuditEntry, CardCell, Game, GameEvent, EventPresence,
  LeaderboardRow, MergeProposal, PoolOption, Profile,
} from './types'

const rpc = async <T,>(fn: string, args: Record<string, unknown>): Promise<T> => {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new Error(error.message)
  return data as T
}

// ---- reads --------------------------------------------------------------
export const getProfile = async (id: string): Promise<Profile> =>
  (await supabase.from('profiles').select('*').eq('id', id).single()).data as Profile

export const listProfiles = async (): Promise<Profile[]> =>
  (await supabase.from('profiles').select('*').order('display_name')).data ?? []

export const getActiveGame = async (): Promise<Game | null> => {
  const { data } = await supabase.from('games').select('*')
    .neq('status', 'setup').order('created_at', { ascending: false }).limit(1)
  return (data?.[0] as Game) ?? null
}

export const listGames = async (): Promise<Game[]> =>
  (await supabase.from('games').select('*').order('created_at', { ascending: false })).data ?? []

export const listPool = async (gameId: string): Promise<PoolOption[]> =>
  (await supabase.from('pool_options').select('*')
    .eq('game_id', gameId).eq('is_active', true).order('created_at')).data ?? []

export const getMyCells = async (gameId: string, userId: string): Promise<CardCell[]> => {
  const { data: card } = await supabase.from('cards').select('id')
    .eq('game_id', gameId).eq('user_id', userId).maybeSingle()
  if (!card) return []
  return (await supabase.from('card_cells').select('*')
    .eq('card_id', card.id).order('row').order('col')).data ?? []
}

export const listMergeProposals = async (gameId: string): Promise<MergeProposal[]> =>
  (await supabase.from('merge_proposals').select('*')
    .eq('game_id', gameId).eq('status', 'voting')).data ?? []

export const listEvents = async (gameId: string): Promise<GameEvent[]> =>
  (await supabase.from('events').select('*')
    .eq('game_id', gameId).order('created_at', { ascending: false })).data ?? []

export const listPresence = async (eventIds: string[]): Promise<EventPresence[]> => {
  if (eventIds.length === 0) return []
  return (await supabase.from('event_presence').select('*').in('event_id', eventIds)).data ?? []
}

export const getLeaderboard = (gameId: string): Promise<LeaderboardRow[]> =>
  rpc('get_leaderboard', { p_game: gameId })

// The caller's own event votes (RLS allows reading your own rows).
export const listMyEventVotes = async (
  userId: string, eventIds: string[],
): Promise<Record<string, boolean>> => {
  if (eventIds.length === 0) return {}
  const { data } = await supabase.from('event_votes').select('event_id, vote')
    .eq('user_id', userId).in('event_id', eventIds)
  return Object.fromEntries((data ?? []).map((r) => [r.event_id as string, r.vote as boolean]))
}

// Activity labels for events the caller may see (works for the target too).
export const getEventLabels = async (gameId: string): Promise<Record<string, string>> => {
  const rows = await rpc<{ event_id: string; label: string }[]>('event_labels', { p_game: gameId })
  return Object.fromEntries(rows.map((r) => [r.event_id, r.label]))
}

export const listAudit = async (gameId: string): Promise<AuditEntry[]> =>
  (await supabase.from('audit_log').select('*')
    .eq('game_id', gameId).order('created_at', { ascending: false })).data ?? []

// ---- writes (all via SECURITY DEFINER rpc) -------------------------------
export const createGame = (a: {
  target: string; grid: number; freezeAt: string; endsAt: string;
  voteWindow: number; freeSpace: boolean
}) => rpc<Game>('create_game', {
  p_target: a.target, p_grid_size: a.grid, p_freeze_at: a.freezeAt,
  p_ends_at: a.endsAt, p_vote_window: a.voteWindow, p_free_space: a.freeSpace,
})

// Best-effort nudge of time-based transitions (backup for pg_cron).
export const tick = () => rpc('tick_games', {}).catch(() => {})
export const startFill = (gameId: string) => rpc('start_fill', { p_game: gameId })
export const ensureCard = (gameId: string) => rpc('ensure_card', { p_game: gameId })
export const addPoolOption = (gameId: string, label: string) =>
  rpc<PoolOption>('add_pool_option', { p_game: gameId, p_label: label })
export const placeCell = (cellId: string, optionId: string | null) =>
  rpc('place_cell', { p_cell: cellId, p_option: optionId })
export const proposeMerge = (gameId: string, a: string, b: string, label: string) =>
  rpc('propose_merge', { p_game: gameId, p_a: a, p_b: b, p_canonical: label })
export const voteMerge = (proposalId: string, vote: boolean) =>
  rpc('vote_merge', { p_proposal: proposalId, p_vote: vote })
export const raiseEvent = (a: {
  gameId: string; optionId: string; remarks: string; photoUrl: string | null; present: string[]
}) => rpc<GameEvent>('raise_event', {
  p_game: a.gameId, p_option: a.optionId, p_remarks: a.remarks,
  p_photo_url: a.photoUrl, p_present: a.present,
})
export const voteEvent = (eventId: string, vote: boolean) =>
  rpc('vote_event', { p_event: eventId, p_vote: vote })
export const crossOut = (cellId: string) => rpc('cross_out', { p_cell: cellId })
export const claimPresence = (eventId: string) => rpc('claim_presence', { p_event: eventId })
export const votePresence = (presenceId: string, vote: boolean) =>
  rpc('vote_presence', { p_presence: presenceId, p_vote: vote })
export const adminStrikeEvent = (eventId: string) => rpc('admin_strike_event', { p_event: eventId })
export const adminStrikeCrossout = (cellId: string) => rpc('admin_strike_crossout', { p_cell: cellId })
export const adminStrikePresence = (pid: string) => rpc('admin_strike_presence', { p_presence: pid })

// Create an account via the edge function (caller must be admin).
export const createAccount = async (a: {
  username: string; display_name: string; password: string; is_admin: boolean
}) => {
  const { data, error } = await supabase.functions.invoke('admin-create-user', { body: a })
  if (error) throw new Error((data as { error?: string })?.error || error.message)
  if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error)
  return data
}
