-- Boyle Bingo — Row-Level Security
-- The anon key ships in the PWA, so these policies ARE the security boundary.
-- All writes go through the SECURITY DEFINER functions in 0003 (which bypass
-- RLS); here we only grant the SELECT visibility each role is allowed.
-- The target must be physically unable to read the pool or other players' cards.

alter table public.profiles            enable row level security;
alter table public.games               enable row level security;
alter table public.pool_options        enable row level security;
alter table public.cards               enable row level security;
alter table public.card_cells          enable row level security;
alter table public.merge_proposals     enable row level security;
alter table public.merge_votes         enable row level security;
alter table public.events              enable row level security;
alter table public.event_presence      enable row level security;
alter table public.event_votes         enable row level security;
alter table public.presence_claim_votes enable row level security;
alter table public.audit_log           enable row level security;

-- Helpers ------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

create or replace function public.game_target(p_game uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select target_user_id from public.games where id = p_game;
$$;

-- Is the current user a non-target, non-admin player of this game?
create or replace function public.is_player(p_game uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null
     and not public.is_admin()
     and auth.uid() <> public.game_target(p_game);
$$;

-- profiles: any authenticated user may read the roster (names, target). Writes
-- happen only via the admin-create-user edge function (service_role).
create policy profiles_select on public.profiles
  for select using (auth.uid() is not null);

-- games: everyone in the group can see games (the target is public knowledge).
create policy games_select on public.games
  for select using (auth.uid() is not null);

-- pool_options: visible to non-target players and the admin. NEVER the target.
create policy pool_select on public.pool_options
  for select using (public.is_admin() or public.is_player(game_id));

-- cards / cells: owner sees own; admin sees all. (Leaderboard uses an
-- aggregate-only RPC, so no one reads anyone else's cells.)
create policy cards_select on public.cards
  for select using (public.is_admin() or user_id = auth.uid());
create policy cells_select on public.card_cells
  for select using (
    public.is_admin()
    or exists (select 1 from public.cards c
               where c.id = card_id and c.user_id = auth.uid())
  );

-- merge proposals/votes: non-target players + admin (they reveal pool labels).
create policy merge_proposals_select on public.merge_proposals
  for select using (public.is_admin() or public.is_player(game_id));
create policy merge_votes_select on public.merge_votes
  for select using (
    public.is_admin()
    or exists (select 1 from public.merge_proposals p
               where p.id = proposal_id and public.is_player(p.game_id))
  );

-- events: non-target players + admin see all. The target sees ONLY events they
-- were marked present at (which is how they can vote and get the reveal).
create policy events_select on public.events
  for select using (
    public.is_admin()
    or public.is_player(game_id)
    or (auth.uid() = public.game_target(game_id)
        and exists (select 1 from public.event_presence ep
                    where ep.event_id = id
                      and ep.user_id = auth.uid()
                      and ep.status = 'confirmed'))
  );

-- event_presence: non-target players + admin see all; the target sees its own.
create policy presence_select on public.event_presence
  for select using (
    public.is_admin()
    or exists (select 1 from public.events e
               where e.id = event_id and public.is_player(e.game_id))
    or user_id = auth.uid()
  );

-- event_votes: non-target players + admin see the tally; target sees own only.
create policy event_votes_select on public.event_votes
  for select using (
    public.is_admin()
    or exists (select 1 from public.events e
               where e.id = event_id and public.is_player(e.game_id))
    or user_id = auth.uid()
  );

create policy presence_votes_select on public.presence_claim_votes
  for select using (
    public.is_admin()
    or exists (select 1 from public.event_presence ep
               join public.events e on e.id = ep.event_id
               where ep.id = presence_id and public.is_player(e.game_id))
    or user_id = auth.uid()
  );

-- audit_log: visible to non-target players + admin (public accountability).
create policy audit_select on public.audit_log
  for select using (public.is_admin() or public.is_player(game_id));
