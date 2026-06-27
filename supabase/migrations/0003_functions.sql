-- Boyle Bingo — rules engine
-- Every game mutation lives here as a SECURITY DEFINER function with its own
-- authorization + phase checks. Clients are untrusted; this is where the rules
-- are actually enforced. Run with `set search_path = public` to be safe.

-- ===========================================================================
-- Admin: game + status management
-- ===========================================================================
create or replace function public.create_game(
  p_target uuid, p_grid_size int, p_freeze_at timestamptz, p_ends_at timestamptz,
  p_vote_window int default 300, p_free_space boolean default false
) returns public.games
language plpgsql security definer set search_path = public as $$
declare g public.games;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  if exists (select 1 from public.profiles where id = p_target and is_admin) then
    raise exception 'target must be a player, not an admin';
  end if;
  insert into public.games (target_user_id, grid_size, free_space, freeze_at,
                            ends_at, vote_window_seconds, created_by)
  values (p_target, p_grid_size, p_free_space, p_freeze_at, p_ends_at,
          coalesce(p_vote_window, 300), auth.uid())
  returning * into g;
  return g;
end $$;

-- Manual setup -> fill transition (reveals the game to players).
create or replace function public.start_fill(p_game uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  update public.games set status = 'fill'
   where id = p_game and status = 'setup';
  if not found then raise exception 'game not in setup'; end if;
end $$;

-- ===========================================================================
-- Fill phase: cards, pool options, placement
-- ===========================================================================

-- Idempotently create the caller's card + empty cells for a game in fill.
create or replace function public.ensure_card(p_game uuid)
returns public.cards
language plpgsql security definer set search_path = public as $$
declare c public.cards; n int; r int; k int;
begin
  if not public.is_player(p_game) then raise exception 'players only'; end if;
  select * into c from public.cards where game_id = p_game and user_id = auth.uid();
  if found then return c; end if;

  select grid_size into n from public.games where id = p_game;
  insert into public.cards (game_id, user_id) values (p_game, auth.uid())
  returning * into c;
  for r in 0..n-1 loop
    for k in 0..n-1 loop
      insert into public.card_cells (card_id, "row", col) values (c.id, r, k);
    end loop;
  end loop;
  -- free space (odd grids only) starts crossed and never empty-blocks a line.
  if (select free_space from public.games where id = p_game) and (n % 2 = 1) then
    update public.card_cells set crossed_at = now()
     where card_id = c.id and "row" = n/2 and col = n/2;
  end if;
  return c;
end $$;

create or replace function public.add_pool_option(p_game uuid, p_label text)
returns public.pool_options
language plpgsql security definer set search_path = public as $$
declare o public.pool_options;
begin
  if not public.is_player(p_game) then raise exception 'players only'; end if;
  if (select status from public.games where id = p_game) <> 'fill' then
    raise exception 'pool is closed';
  end if;
  if length(trim(p_label)) = 0 then raise exception 'label required'; end if;
  insert into public.pool_options (game_id, label, created_by)
  values (p_game, trim(p_label), auth.uid())
  returning * into o;
  return o;
end $$;

-- Place / clear an option in one of the caller's own cells (fill phase).
create or replace function public.place_cell(p_cell uuid, p_option uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_game uuid;
begin
  select c.game_id into v_game
    from public.card_cells cc join public.cards c on c.id = cc.card_id
   where cc.id = p_cell and c.user_id = auth.uid();
  if v_game is null then raise exception 'not your cell'; end if;
  if (select status from public.games where id = v_game) <> 'fill' then
    raise exception 'cards are locked';
  end if;
  if p_option is not null and not exists (
       select 1 from public.pool_options
        where id = p_option and game_id = v_game and is_active) then
    raise exception 'invalid option';
  end if;
  update public.card_cells set pool_option_id = p_option where id = p_cell;
end $$;

-- ===========================================================================
-- Merge proposals (fill phase only): pass = more yes than no, min 2 yes
-- ===========================================================================
create or replace function public.propose_merge(
  p_game uuid, p_a uuid, p_b uuid, p_canonical text
) returns public.merge_proposals
language plpgsql security definer set search_path = public as $$
declare mp public.merge_proposals;
begin
  if not public.is_player(p_game) then raise exception 'players only'; end if;
  if (select status from public.games where id = p_game) <> 'fill' then
    raise exception 'merges only during fill';
  end if;
  if p_a = p_b then raise exception 'pick two different options'; end if;
  insert into public.merge_proposals (game_id, option_a_id, option_b_id,
                                      canonical_label, proposed_by)
  values (p_game, p_a, p_b, trim(p_canonical), auth.uid())
  returning * into mp;
  -- proposer implicitly votes yes
  insert into public.merge_votes (proposal_id, user_id, vote)
  values (mp.id, auth.uid(), true);
  perform public.resolve_merge(mp.id);
  select * into mp from public.merge_proposals where id = mp.id;
  return mp;
end $$;

create or replace function public.vote_merge(p_proposal uuid, p_vote boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_game uuid;
begin
  select game_id into v_game from public.merge_proposals where id = p_proposal;
  if not public.is_player(v_game) then raise exception 'players only'; end if;
  if (select status from public.games where id = v_game) <> 'fill' then
    raise exception 'merges only during fill';
  end if;
  insert into public.merge_votes (proposal_id, user_id, vote)
  values (p_proposal, auth.uid(), p_vote)
  on conflict (proposal_id, user_id) do update set vote = excluded.vote;
  perform public.resolve_merge(p_proposal);
end $$;

-- Number of eligible (non-target, non-admin) voters in a game.
create or replace function public.eligible_voter_count(p_game uuid)
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from public.profiles p
   where not p.is_admin and p.id <> public.game_target(p_game);
$$;

create or replace function public.resolve_merge(p_proposal uuid)
returns void language plpgsql security definer set search_path = public as $$
declare mp public.merge_proposals; v_yes int; v_no int; v_total int; v_elig int;
        v_card record; v_keep uuid; v_drop uuid;
begin
  select * into mp from public.merge_proposals where id = p_proposal for update;
  if mp.status <> 'voting' then return; end if;

  select count(*) filter (where vote), count(*) filter (where not vote), count(*)
    into v_yes, v_no, v_total from public.merge_votes where proposal_id = p_proposal;
  v_elig := public.eligible_voter_count(mp.game_id);

  -- Resolve when everyone eligible has voted (the window-based path is handled
  -- by the cron tick). Pass = more yes than no AND at least 2 yes.
  if v_total < v_elig then return; end if;

  if v_yes > v_no and v_yes >= 2 then
    -- canonical = option A (relabelled); B absorbed into A.
    update public.pool_options set label = mp.canonical_label, is_active = true
     where id = mp.option_a_id;
    update public.pool_options set is_active = false, merged_into_id = mp.option_a_id
     where id = mp.option_b_id;

    -- Reconcile cards: holders of both lose one at random; holders of only B
    -- get repointed to A. (Pre-freeze, so a freed cell is just left empty.)
    for v_card in select id from public.cards where game_id = mp.game_id loop
      if exists (select 1 from public.card_cells
                  where card_id = v_card.id and pool_option_id = mp.option_a_id)
         and exists (select 1 from public.card_cells
                  where card_id = v_card.id and pool_option_id = mp.option_b_id)
      then
        if random() < 0.5 then v_drop := mp.option_a_id; v_keep := mp.option_b_id;
                          else v_drop := mp.option_b_id; v_keep := mp.option_a_id; end if;
        update public.card_cells set pool_option_id = null
          where card_id = v_card.id and pool_option_id = v_drop;
        update public.card_cells set pool_option_id = mp.option_a_id
          where card_id = v_card.id and pool_option_id = v_keep
            and v_keep = mp.option_b_id;
      else
        update public.card_cells set pool_option_id = mp.option_a_id
          where card_id = v_card.id and pool_option_id = mp.option_b_id;
      end if;
    end loop;

    update public.merge_proposals
       set status = 'merged', resolved_at = now() where id = p_proposal;
  else
    update public.merge_proposals
       set status = 'rejected', resolved_at = now() where id = p_proposal;
  end if;
end $$;

-- ===========================================================================
-- Raise -> approve -> cross-out
-- ===========================================================================

-- Raise an activity. Rule (per group decision): at least 2 present non-target
-- users are required (the raiser + ≥1 other witness). The target may be marked
-- present but is excluded from the tally and from that minimum.
create or replace function public.raise_event(
  p_game uuid, p_option uuid, p_remarks text, p_photo_url text, p_present uuid[]
) returns public.events
language plpgsql security definer set search_path = public as $$
declare e public.events; v_target uuid; v_present uuid[]; v_uid uuid;
        v_nontarget int;
begin
  if not public.is_player(p_game) then raise exception 'players only'; end if;
  if (select status from public.games where id = p_game) <> 'frozen' then
    raise exception 'raises are only allowed during the live (frozen) window';
  end if;
  if not exists (select 1 from public.pool_options
                  where id = p_option and game_id = p_game) then
    raise exception 'invalid option';
  end if;

  v_target := public.game_target(p_game);
  -- normalise present set: include the raiser, drop dupes/admins/non-members.
  select array_agg(distinct u) into v_present from (
    select unnest(array_append(coalesce(p_present, '{}'), auth.uid())) as u
  ) s
  where exists (select 1 from public.profiles pr where pr.id = s.u and not pr.is_admin);

  select count(*) into v_nontarget
    from unnest(v_present) u where u <> v_target;
  if v_nontarget < 2 then
    raise exception 'need at least 2 present witnesses (besides the target)';
  end if;

  insert into public.events (game_id, pool_option_id, raised_by, remarks, photo_url)
  values (p_game, p_option, auth.uid(), coalesce(p_remarks, ''),
          nullif(p_photo_url, ''))
  returning * into e;

  foreach v_uid in array v_present loop
    insert into public.event_presence (event_id, user_id, status, added_via, confirmed_by)
    values (e.id, v_uid, 'confirmed', 'raiser', auth.uid());
  end loop;
  -- raiser is implicitly a yes
  insert into public.event_votes (event_id, user_id, vote)
  values (e.id, auth.uid(), true);

  perform public.resolve_event(e.id);
  select * into e from public.events where id = e.id;
  return e;
end $$;

-- A present user (incl. target — recorded, not counted) votes on a raise.
create or replace function public.vote_event(p_event uuid, p_vote boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.event_presence
                  where event_id = p_event and user_id = auth.uid()
                    and status = 'confirmed') then
    raise exception 'only present users may vote';
  end if;
  if (select status from public.events where id = p_event) <> 'voting' then
    raise exception 'voting closed';
  end if;
  insert into public.event_votes (event_id, user_id, vote)
  values (p_event, auth.uid(), p_vote)
  on conflict (event_id, user_id) do update set vote = excluded.vote;
  perform public.resolve_event(p_event);
end $$;

-- Tally + resolve. Excludes the target. Approve if yes>no; tie approves iff a
-- photo is attached. Resolves when all present non-target voted OR window past.
create or replace function public.resolve_event(p_event uuid)
returns void language plpgsql security definer set search_path = public as $$
declare e public.events; v_target uuid; v_window int;
        v_present int; v_yes int; v_no int; v_voted int; v_due boolean;
        v_approve boolean;
begin
  select * into e from public.events where id = p_event for update;
  if e.status <> 'voting' then return; end if;
  v_target := public.game_target(e.game_id);
  select vote_window_seconds into v_window from public.games where id = e.game_id;

  select count(*) into v_present from public.event_presence ep
   where ep.event_id = p_event and ep.status = 'confirmed' and ep.user_id <> v_target;

  select count(*) filter (where ev.vote),
         count(*) filter (where not ev.vote),
         count(*)
    into v_yes, v_no, v_voted
    from public.event_votes ev
    join public.event_presence ep
      on ep.event_id = ev.event_id and ep.user_id = ev.user_id
   where ev.event_id = p_event and ep.status = 'confirmed' and ev.user_id <> v_target;

  v_due := now() >= e.created_at + make_interval(secs => v_window);
  if v_voted < v_present and not v_due then return; end if;

  if v_yes > v_no then v_approve := true;
  elsif v_yes = v_no then v_approve := e.photo_url is not null;
  else v_approve := false;
  end if;

  update public.events
     set status = case when v_approve then 'approved' else 'rejected' end,
         resolved_at = now()
   where id = p_event;
end $$;

-- Cross out one of the caller's own cells. Gate = predicted (option on the
-- cell) AND confirmed-present on an approved event for that option. No 2nd vote.
create or replace function public.cross_out(p_cell uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_game uuid; v_option uuid; v_event uuid;
begin
  select c.game_id, cc.pool_option_id into v_game, v_option
    from public.card_cells cc join public.cards c on c.id = cc.card_id
   where cc.id = p_cell and c.user_id = auth.uid();
  if v_game is null then raise exception 'not your cell'; end if;
  if v_option is null then raise exception 'empty cell'; end if;
  if (select status from public.games where id = v_game) not in ('frozen','ended') then
    raise exception 'not yet live';
  end if;

  select e.id into v_event from public.events e
    join public.event_presence ep on ep.event_id = e.id
   where e.game_id = v_game and e.pool_option_id = v_option
     and e.status = 'approved'
     and ep.user_id = auth.uid() and ep.status = 'confirmed'
   order by e.resolved_at limit 1;
  if v_event is null then raise exception 'not eligible to cross out'; end if;

  update public.card_cells
     set crossed_at = coalesce(crossed_at, now()), crossed_event_id = v_event
   where id = p_cell and crossed_at is null;
end $$;

-- ===========================================================================
-- Presence self-claims ("I was there too") -> ≥50% cohort vote
-- ===========================================================================
create or replace function public.claim_presence(p_event uuid)
returns public.event_presence
language plpgsql security definer set search_path = public as $$
declare ep public.event_presence; v_game uuid; v_label text;
begin
  select e.game_id, po.label into v_game, v_label
    from public.events e join public.pool_options po on po.id = e.pool_option_id
   where e.id = p_event and e.status = 'approved';
  if v_game is null then raise exception 'event not found or not approved'; end if;
  if not public.is_player(v_game) then raise exception 'players only'; end if;
  if exists (select 1 from public.event_presence
              where event_id = p_event and user_id = auth.uid()) then
    raise exception 'already on this event';
  end if;

  insert into public.event_presence (event_id, user_id, status, added_via)
  values (p_event, auth.uid(), 'claimed', 'self_claim')
  returning * into ep;

  insert into public.audit_log (game_id, actor_id, action, detail)
  values (v_game, auth.uid(), 'presence_claim',
          jsonb_build_object('event_id', p_event, 'activity', v_label));

  perform public.resolve_presence(ep.id);
  select * into ep from public.event_presence where id = ep.id;
  return ep;
end $$;

create or replace function public.vote_presence(p_presence uuid, p_vote boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_event uuid; v_game uuid; v_target uuid;
begin
  select ep.event_id, e.game_id into v_event, v_game
    from public.event_presence ep join public.events e on e.id = ep.event_id
   where ep.id = p_presence and ep.status = 'claimed';
  if v_event is null then raise exception 'claim not open'; end if;
  v_target := public.game_target(v_game);
  if auth.uid() = v_target then raise exception 'target cannot confirm presence'; end if;
  -- voter must already be a confirmed present non-target user of the event
  if not exists (select 1 from public.event_presence
                  where event_id = v_event and user_id = auth.uid()
                    and status = 'confirmed') then
    raise exception 'only the present cohort may vote';
  end if;
  insert into public.presence_claim_votes (presence_id, user_id, vote)
  values (p_presence, auth.uid(), p_vote)
  on conflict (presence_id, user_id) do update set vote = excluded.vote;
  perform public.resolve_presence(p_presence);
end $$;

-- Cohort = confirmed present non-target users (excluding the claimant). Pass
-- when yes votes ≥ half the cohort (≥50%). Resolves when cohort exhausted.
create or replace function public.resolve_presence(p_presence uuid)
returns void language plpgsql security definer set search_path = public as $$
declare ep public.event_presence; v_event uuid; v_game uuid; v_target uuid;
        v_cohort int; v_yes int; v_voted int; v_label text;
begin
  select * into ep from public.event_presence where id = p_presence for update;
  if ep.status <> 'claimed' then return; end if;
  v_event := ep.event_id;
  select game_id into v_game from public.events where id = v_event;
  v_target := public.game_target(v_game);

  select count(*) into v_cohort from public.event_presence
   where event_id = v_event and status = 'confirmed'
     and user_id <> v_target and user_id <> ep.user_id;

  select count(*) filter (where vote), count(*)
    into v_yes, v_voted from public.presence_claim_votes where presence_id = p_presence;

  -- ≥50% of the eligible cohort must approve.
  if v_yes * 2 >= v_cohort and v_cohort > 0 then
    update public.event_presence set status = 'confirmed' where id = p_presence;
    select po.label into v_label from public.events e
      join public.pool_options po on po.id = e.pool_option_id where e.id = v_event;
    insert into public.audit_log (game_id, actor_id, action, detail)
    values (v_game, ep.user_id, 'presence_confirmed',
            jsonb_build_object('event_id', v_event, 'activity', v_label));
  elsif v_voted >= v_cohort then
    -- everyone voted and it didn't reach 50% -> reject
    update public.event_presence set status = 'rejected' where id = p_presence;
  end if;
end $$;

-- ===========================================================================
-- Admin moderation: strikes (all reversible, all logged)
-- ===========================================================================
create or replace function public.admin_strike_event(p_event uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_game uuid;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  select game_id into v_game from public.events where id = p_event;
  update public.events set status = 'rejected', resolved_at = now() where id = p_event;
  -- undo any cross-outs that relied on this event
  update public.card_cells set crossed_at = null, crossed_event_id = null
   where crossed_event_id = p_event;
  insert into public.audit_log (game_id, actor_id, action, detail)
  values (v_game, auth.uid(), 'strike_event', jsonb_build_object('event_id', p_event));
end $$;

create or replace function public.admin_strike_crossout(p_cell uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_game uuid;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  select c.game_id into v_game from public.card_cells cc
    join public.cards c on c.id = cc.card_id where cc.id = p_cell;
  update public.card_cells set crossed_at = null, crossed_event_id = null where id = p_cell;
  insert into public.audit_log (game_id, actor_id, action, detail)
  values (v_game, auth.uid(), 'strike_crossout', jsonb_build_object('cell_id', p_cell));
end $$;

create or replace function public.admin_strike_presence(p_presence uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_game uuid; v_event uuid; v_user uuid;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  select ep.event_id, ep.user_id, e.game_id into v_event, v_user, v_game
    from public.event_presence ep join public.events e on e.id = ep.event_id
   where ep.id = p_presence;
  update public.event_presence set status = 'rejected' where id = p_presence;
  -- revoke cross-outs that depended on this presence
  update public.card_cells cc set crossed_at = null, crossed_event_id = null
    from public.cards c
   where cc.card_id = c.id and c.user_id = v_user and cc.crossed_event_id = v_event;
  insert into public.audit_log (game_id, actor_id, action, detail)
  values (v_game, auth.uid(), 'strike_presence', jsonb_build_object('presence_id', p_presence));
end $$;

-- ===========================================================================
-- Cron tick: phase transitions + window-based auto-resolution
-- ===========================================================================
create or replace function public.tick_games()
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  -- fill -> frozen
  update public.games set status = 'frozen'
   where status = 'fill' and now() >= freeze_at;
  -- frozen -> ended
  update public.games set status = 'ended'
   where status = 'frozen' and now() >= ends_at;

  -- merges are fill-only: any proposal still open once the game leaves fill is
  -- rejected (cards are locked, so a merge can no longer free/reconcile cells).
  update public.merge_proposals mp set status = 'rejected', resolved_at = now()
   from public.games g
   where g.id = mp.game_id and mp.status = 'voting' and g.status <> 'fill';

  -- auto-resolve events whose vote window has elapsed
  for r in select id from public.events where status = 'voting' loop
    perform public.resolve_event(r.id);
  end loop;
end $$;
