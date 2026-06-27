export type GameStatus = 'setup' | 'fill' | 'frozen' | 'ended'
export type EventStatus = 'voting' | 'approved' | 'rejected'
export type PresenceStatus = 'confirmed' | 'claimed' | 'rejected'

export interface Profile {
  id: string
  username: string
  display_name: string
  is_admin: boolean
}

export interface Game {
  id: string
  target_user_id: string
  grid_size: number
  free_space: boolean
  freeze_at: string
  ends_at: string
  vote_window_seconds: number
  presence_confirm_mode: string
  status: GameStatus
  created_by: string
  created_at: string
}

export interface PoolOption {
  id: string
  game_id: string
  label: string
  created_by: string
  merged_into_id: string | null
  is_active: boolean
}

export interface CardCell {
  id: string
  card_id: string
  row: number
  col: number
  pool_option_id: string | null
  crossed_at: string | null
  crossed_event_id: string | null
}

export interface MergeProposal {
  id: string
  game_id: string
  option_a_id: string
  option_b_id: string
  canonical_label: string
  proposed_by: string
  status: 'voting' | 'merged' | 'rejected'
}

export interface GameEvent {
  id: string
  game_id: string
  pool_option_id: string
  raised_by: string
  remarks: string
  photo_url: string | null
  created_at: string
  status: EventStatus
  resolved_at: string | null
}

export interface EventPresence {
  id: string
  event_id: string
  user_id: string
  status: PresenceStatus
  added_via: 'raiser' | 'self_claim'
}

export interface LeaderboardRow {
  user_id: string
  display_name: string
  crossed: number
  filled: number
  has_line: boolean
  blackout: boolean
  blackout_at: string | null
  first_line_at: string | null
  last_cross_at: string | null
}

export interface AuditEntry {
  id: string
  game_id: string
  actor_id: string | null
  action: string
  detail: Record<string, unknown>
  created_at: string
}
