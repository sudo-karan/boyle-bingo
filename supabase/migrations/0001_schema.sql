-- Boyle Bingo — schema
-- UUID PKs, timestamptz everywhere. RLS is enabled in 0002, rules engine in 0003.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- profiles: one row per auth user. Created by the admin-create-user edge fn.
-- ---------------------------------------------------------------------------
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  username     text not null unique,
  display_name text not null,
  is_admin     boolean not null default false,
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- games
-- ---------------------------------------------------------------------------
create table public.games (
  id                    uuid primary key default gen_random_uuid(),
  target_user_id        uuid not null references public.profiles (id),
  grid_size             int  not null check (grid_size between 3 and 9),
  free_space            boolean not null default false,
  freeze_at             timestamptz not null,
  ends_at               timestamptz not null,
  vote_window_seconds   int  not null default 300 check (vote_window_seconds > 0),
  -- Presence claims resolve by a ≥50% vote of the present non-target cohort.
  presence_confirm_mode text not null default 'cohort_vote'
                          check (presence_confirm_mode in ('cohort_vote', 'raiser_only')),
  status                text not null default 'setup'
                          check (status in ('setup', 'fill', 'frozen', 'ended')),
  created_by            uuid not null references public.profiles (id),
  created_at            timestamptz not null default now(),
  check (ends_at > freeze_at)
);
create index on public.games (status);

-- ---------------------------------------------------------------------------
-- pool_options: shared, public-to-non-target-players pool
-- ---------------------------------------------------------------------------
create table public.pool_options (
  id             uuid primary key default gen_random_uuid(),
  game_id        uuid not null references public.games (id) on delete cascade,
  label          text not null,
  created_by     uuid not null references public.profiles (id),
  merged_into_id uuid references public.pool_options (id),
  is_active      boolean not null default true,
  created_at     timestamptz not null default now()
);
create index on public.pool_options (game_id);

-- ---------------------------------------------------------------------------
-- cards + cells (one card per non-target player)
-- ---------------------------------------------------------------------------
create table public.cards (
  id      uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games (id) on delete cascade,
  user_id uuid not null references public.profiles (id),
  unique (game_id, user_id)
);

create table public.card_cells (
  id              uuid primary key default gen_random_uuid(),
  card_id         uuid not null references public.cards (id) on delete cascade,
  "row"           int not null,
  col             int not null,
  pool_option_id  uuid references public.pool_options (id),
  crossed_at      timestamptz,
  crossed_event_id uuid,          -- fk added after events table below
  unique (card_id, "row", col)
);
create index on public.card_cells (card_id);
-- An option may appear at most once per card.
create unique index card_cells_unique_option
  on public.card_cells (card_id, pool_option_id)
  where pool_option_id is not null;

-- ---------------------------------------------------------------------------
-- merge proposals + votes (fill phase only)
-- ---------------------------------------------------------------------------
create table public.merge_proposals (
  id             uuid primary key default gen_random_uuid(),
  game_id        uuid not null references public.games (id) on delete cascade,
  option_a_id    uuid not null references public.pool_options (id),
  option_b_id    uuid not null references public.pool_options (id),
  canonical_label text not null,
  proposed_by    uuid not null references public.profiles (id),
  created_at     timestamptz not null default now(),
  status         text not null default 'voting'
                   check (status in ('voting', 'merged', 'rejected')),
  resolved_at    timestamptz,
  check (option_a_id <> option_b_id)
);
create index on public.merge_proposals (game_id);

create table public.merge_votes (
  id          uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.merge_proposals (id) on delete cascade,
  user_id     uuid not null references public.profiles (id),
  vote        boolean not null,
  created_at  timestamptz not null default now(),
  unique (proposal_id, user_id)
);

-- ---------------------------------------------------------------------------
-- events (one per real-world activity) + presence + votes
-- ---------------------------------------------------------------------------
create table public.events (
  id             uuid primary key default gen_random_uuid(),
  game_id        uuid not null references public.games (id) on delete cascade,
  pool_option_id uuid not null references public.pool_options (id),
  raised_by      uuid not null references public.profiles (id),
  remarks        text not null default '',
  photo_url      text,
  created_at     timestamptz not null default now(),
  status         text not null default 'voting'
                   check (status in ('voting', 'approved', 'rejected')),
  resolved_at    timestamptz
);
create index on public.events (game_id);
create index on public.events (game_id, status);

alter table public.card_cells
  add constraint card_cells_crossed_event_fk
  foreign key (crossed_event_id) references public.events (id) on delete set null;

create table public.event_presence (
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid not null references public.events (id) on delete cascade,
  user_id      uuid not null references public.profiles (id),
  status       text not null default 'confirmed'
                 check (status in ('confirmed', 'claimed', 'rejected')),
  added_via    text not null check (added_via in ('raiser', 'self_claim')),
  confirmed_by uuid references public.profiles (id),
  created_at   timestamptz not null default now(),
  unique (event_id, user_id)
);
create index on public.event_presence (event_id);

create table public.event_votes (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references public.events (id) on delete cascade,
  user_id    uuid not null references public.profiles (id),
  vote       boolean not null,
  created_at timestamptz not null default now(),
  unique (event_id, user_id)
);

-- Votes on a presence self-claim (≥50% of present non-target cohort).
create table public.presence_claim_votes (
  id          uuid primary key default gen_random_uuid(),
  presence_id uuid not null references public.event_presence (id) on delete cascade,
  user_id     uuid not null references public.profiles (id),
  vote        boolean not null,
  created_at  timestamptz not null default now(),
  unique (presence_id, user_id)
);

-- ---------------------------------------------------------------------------
-- audit log (public-to-players record of self-adds, strikes, etc.)
-- ---------------------------------------------------------------------------
create table public.audit_log (
  id         uuid primary key default gen_random_uuid(),
  game_id    uuid not null references public.games (id) on delete cascade,
  actor_id   uuid references public.profiles (id),
  action     text not null,
  detail     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index on public.audit_log (game_id, created_at);
