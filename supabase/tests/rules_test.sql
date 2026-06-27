-- Boyle Bingo — end-to-end rules engine test.
--
-- Runs the whole lifecycle (setup -> fill -> frozen) through the real RPCs and
-- asserts the outcomes, including the group-specific rules:
--   * raises require >=2 present non-target witnesses
--   * approval tally excludes the target
--   * cross-out = predicted AND present
--   * presence self-claims need a >=50% cohort vote
--   * admin strikes revert dependent cross-outs
--   * RLS hides the pool from the target
--
-- HOW TO RUN: paste into the Supabase SQL editor (runs as a privileged role) and
-- execute. Everything happens inside one transaction that ROLLS BACK at the end,
-- so it leaves no data behind. A failed assertion aborts with 'FAIL: ...'.
-- If it runs to the final "ALL TESTS PASSED" notice, the engine behaves.
--
-- Users are impersonated by setting request.jwt.claims.sub (what auth.uid()
-- reads). We talk directly to auth.users here because there is no Auth API in
-- SQL — this is test-only.

begin;

-- ----- create auth users + profiles --------------------------------------
insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-000000000001','authenticated','authenticated','admin@boylebingo.local','', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-000000000002','authenticated','authenticated','target@boylebingo.local','', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-000000000003','authenticated','authenticated','p1@boylebingo.local','', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-000000000004','authenticated','authenticated','p2@boylebingo.local','', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-000000000005','authenticated','authenticated','p3@boylebingo.local','', now(), now(), now());

insert into public.profiles (id, username, display_name, is_admin) values
  ('00000000-0000-0000-0000-000000000001','admin','Admin',  true),
  ('00000000-0000-0000-0000-000000000002','target','Target',false),
  ('00000000-0000-0000-0000-000000000003','p1','Player One',false),
  ('00000000-0000-0000-0000-000000000004','p2','Player Two',false),
  ('00000000-0000-0000-0000-000000000005','p3','Player Three',false);

-- helper to impersonate a user for the calls that follow
create or replace function pg_temp.act_as(p uuid) returns void
language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p)::text, true);
$$;

-- ===========================================================================
-- SETUP -> FILL
-- ===========================================================================
select pg_temp.act_as('00000000-0000-0000-0000-000000000001'); -- admin
select public.create_game(
  '00000000-0000-0000-0000-000000000002'::uuid, 3,
  now() + interval '1 hour', now() + interval '2 hours', 300, false);

-- grab the game id
do $$
declare gid uuid;
begin
  select id into gid from public.games order by created_at desc limit 1;
  perform set_config('test.gid', gid::text, true);
end $$;

select pg_temp.act_as('00000000-0000-0000-0000-000000000001');
select public.start_fill(current_setting('test.gid')::uuid);

do $$ begin
  assert (select status from public.games where id = current_setting('test.gid')::uuid) = 'fill',
    'FAIL: game should be in fill';
  raise notice 'OK: game in fill';
end $$;

-- ===========================================================================
-- FILL: cards, pool, placement, merge
-- ===========================================================================
-- p1, p2, p3 get cards
select pg_temp.act_as('00000000-0000-0000-0000-000000000003'); select public.ensure_card(current_setting('test.gid')::uuid);
select pg_temp.act_as('00000000-0000-0000-0000-000000000004'); select public.ensure_card(current_setting('test.gid')::uuid);
select pg_temp.act_as('00000000-0000-0000-0000-000000000005'); select public.ensure_card(current_setting('test.gid')::uuid);

-- p1 adds two near-duplicate options (A, B) plus a third
select pg_temp.act_as('00000000-0000-0000-0000-000000000003');
select public.add_pool_option(current_setting('test.gid')::uuid, 'Says "literally"');
select public.add_pool_option(current_setting('test.gid')::uuid, 'Says literally');
select public.add_pool_option(current_setting('test.gid')::uuid, 'Spills a drink');

do $$
declare a uuid; b uuid;
begin
  select id into a from public.pool_options where label = 'Says "literally"';
  select id into b from public.pool_options where label = 'Says literally';
  perform set_config('test.optA', a::text, true);
  perform set_config('test.optB', b::text, true);
end $$;

-- p1 places A and B on its card; p2 places A and B; p3 places A only
do $$
declare cid uuid; c1 uuid; c2 uuid;
begin
  -- p1
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-000000000003')::text, true);
  select id into cid from public.cards where user_id = '00000000-0000-0000-0000-000000000003';
  select id into c1 from public.card_cells where card_id = cid order by "row", col limit 1;
  select id into c2 from public.card_cells where card_id = cid order by "row", col offset 1 limit 1;
  perform public.place_cell(c1, current_setting('test.optA')::uuid);
  perform public.place_cell(c2, current_setting('test.optB')::uuid);
  -- p2
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-000000000004')::text, true);
  select id into cid from public.cards where user_id = '00000000-0000-0000-0000-000000000004';
  select id into c1 from public.card_cells where card_id = cid order by "row", col limit 1;
  select id into c2 from public.card_cells where card_id = cid order by "row", col offset 1 limit 1;
  perform public.place_cell(c1, current_setting('test.optA')::uuid);
  perform public.place_cell(c2, current_setting('test.optB')::uuid);
  -- p3 (only A)
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-000000000005')::text, true);
  select id into cid from public.cards where user_id = '00000000-0000-0000-0000-000000000005';
  select id into c1 from public.card_cells where card_id = cid order by "row", col limit 1;
  perform public.place_cell(c1, current_setting('test.optA')::uuid);
end $$;

-- RLS: the target must NOT be able to read the pool; a player must.
do $$
declare target_sees int; player_sees int;
begin
  set local role authenticated;

  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-000000000002')::text, true);
  select count(*) into target_sees from public.pool_options where game_id = current_setting('test.gid')::uuid;

  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-000000000003')::text, true);
  select count(*) into player_sees from public.pool_options where game_id = current_setting('test.gid')::uuid;

  reset role;
  assert target_sees = 0, 'FAIL: target can see the pool (RLS leak!)';
  assert player_sees = 3, format('FAIL: player should see 3 options, saw %s', player_sees);
  raise notice 'OK: RLS hides pool from target (target=%, player=%)', target_sees, player_sees;
end $$;

-- merge A + B: p1 proposes (auto-yes), p2 + p3 vote yes -> all 3 eligible voted
select pg_temp.act_as('00000000-0000-0000-0000-000000000003');
select public.propose_merge(current_setting('test.gid')::uuid,
  current_setting('test.optA')::uuid, current_setting('test.optB')::uuid, 'Says literally (canonical)');

do $$ declare pid uuid;
begin
  select id into pid from public.merge_proposals where game_id = current_setting('test.gid')::uuid order by created_at desc limit 1;
  perform set_config('test.prop', pid::text, true);
end $$;

select pg_temp.act_as('00000000-0000-0000-0000-000000000004'); select public.vote_merge(current_setting('test.prop')::uuid, true);
select pg_temp.act_as('00000000-0000-0000-0000-000000000005'); select public.vote_merge(current_setting('test.prop')::uuid, true);

do $$
declare st text; b_active bool; a_label text; p1_both int;
begin
  select status into st from public.merge_proposals where id = current_setting('test.prop')::uuid;
  select is_active into b_active from public.pool_options where id = current_setting('test.optB')::uuid;
  select label into a_label from public.pool_options where id = current_setting('test.optA')::uuid;
  -- p1 must not hold both A and B any more
  select count(*) into p1_both from public.card_cells cc
    join public.cards c on c.id = cc.card_id
   where c.user_id = '00000000-0000-0000-0000-000000000003'
     and cc.pool_option_id = current_setting('test.optB')::uuid;
  assert st = 'merged', format('FAIL: proposal should be merged, was %s', st);
  assert b_active = false, 'FAIL: absorbed option B should be inactive';
  assert a_label = 'Says literally (canonical)', 'FAIL: canonical label not applied';
  assert p1_both = 0, 'FAIL: option B should be gone from p1 card after merge';
  raise notice 'OK: merge passed, canonical applied, cards reconciled';
end $$;

-- ===========================================================================
-- FREEZE
-- ===========================================================================
update public.games set status = 'frozen', freeze_at = now() - interval '1 minute'
 where id = current_setting('test.gid')::uuid;

-- ===========================================================================
-- RAISE -> APPROVE -> CROSS-OUT
-- ===========================================================================
-- witness rule: raise with only the raiser + target present must fail
do $$
declare ok bool := false;
begin
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-000000000003')::text, true);
  begin
    perform public.raise_event(current_setting('test.gid')::uuid, current_setting('test.optA')::uuid,
      'just me', null, array['00000000-0000-0000-0000-000000000002']::uuid[]);
  exception when others then ok := true;
  end;
  assert ok, 'FAIL: a lone raiser (only target present) should be rejected';
  raise notice 'OK: raise rejected without a second witness';
end $$;

-- valid raise: p1 raises, present = p2 + target. Stays voting until p2 votes.
select pg_temp.act_as('00000000-0000-0000-0000-000000000003');
select public.raise_event(current_setting('test.gid')::uuid, current_setting('test.optA')::uuid,
  'said it at dinner', null,
  array['00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000002']::uuid[]);

do $$ declare eid uuid; st text;
begin
  select id, status into eid, st from public.events where game_id = current_setting('test.gid')::uuid order by created_at desc limit 1;
  perform set_config('test.eid', eid::text, true);
  assert st = 'voting', format('FAIL: event should still be voting, was %s', st);
  raise notice 'OK: event pending until the other witness votes';
end $$;

-- the target votes NO — must be recorded but must NOT block approval
select pg_temp.act_as('00000000-0000-0000-0000-000000000002');
select public.vote_event(current_setting('test.eid')::uuid, false);
-- p2 votes YES -> all present non-target voted -> approve
select pg_temp.act_as('00000000-0000-0000-0000-000000000004');
select public.vote_event(current_setting('test.eid')::uuid, true);

do $$ declare st text;
begin
  select status into st from public.events where id = current_setting('test.eid')::uuid;
  assert st = 'approved', format('FAIL: event should be approved (target no excluded), was %s', st);
  raise notice 'OK: event approved; target''s no was excluded from the tally';
end $$;

-- cross-out: p1 (predicted + present) succeeds; p3 (predicted, NOT present) fails
do $$
declare cellid uuid; ok bool := false;
begin
  -- p1 crosses A
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-000000000003')::text, true);
  select cc.id into cellid from public.card_cells cc join public.cards c on c.id = cc.card_id
   where c.user_id = '00000000-0000-0000-0000-000000000003' and cc.pool_option_id = current_setting('test.optA')::uuid;
  perform public.cross_out(cellid);
  assert (select crossed_at is not null from public.card_cells where id = cellid),
    'FAIL: p1 should have crossed out A';

  -- p3 cannot (not present)
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-000000000005')::text, true);
  select cc.id into cellid from public.card_cells cc join public.cards c on c.id = cc.card_id
   where c.user_id = '00000000-0000-0000-0000-000000000005' and cc.pool_option_id = current_setting('test.optA')::uuid;
  begin perform public.cross_out(cellid); exception when others then ok := true; end;
  assert ok, 'FAIL: p3 was not present and must not be able to cross out';
  raise notice 'OK: cross-out gate = predicted AND present';
end $$;

-- ===========================================================================
-- PRESENCE SELF-CLAIM -> >=50% COHORT VOTE
-- ===========================================================================
-- p3 claims presence; cohort = {p1, p2}; p1 votes yes -> 1*2 >= 2 -> confirmed
select pg_temp.act_as('00000000-0000-0000-0000-000000000005');
select public.claim_presence(current_setting('test.eid')::uuid);

do $$ declare pid uuid;
begin
  select id into pid from public.event_presence
   where event_id = current_setting('test.eid')::uuid and user_id = '00000000-0000-0000-0000-000000000005';
  perform set_config('test.pres', pid::text, true);
  assert (select status from public.event_presence where id = pid) = 'claimed',
    'FAIL: claim should start as claimed';
end $$;

select pg_temp.act_as('00000000-0000-0000-0000-000000000003');
select public.vote_presence(current_setting('test.pres')::uuid, true);

do $$ begin
  assert (select status from public.event_presence where id = current_setting('test.pres')::uuid) = 'confirmed',
    'FAIL: presence claim should be confirmed at >=50%';
  raise notice 'OK: presence claim confirmed by cohort vote';
end $$;

-- now p3 can cross out
do $$ declare cellid uuid;
begin
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-000000000005')::text, true);
  select cc.id into cellid from public.card_cells cc join public.cards c on c.id = cc.card_id
   where c.user_id = '00000000-0000-0000-0000-000000000005' and cc.pool_option_id = current_setting('test.optA')::uuid;
  perform public.cross_out(cellid);
  assert (select crossed_at is not null from public.card_cells where id = cellid),
    'FAIL: p3 should cross out after presence confirmed';
  raise notice 'OK: confirmed-present p3 can now cross out';
end $$;

-- ===========================================================================
-- LEADERBOARD + ADMIN STRIKE
-- ===========================================================================
do $$ declare p1_crossed int;
begin
  select crossed into p1_crossed from public.get_leaderboard(current_setting('test.gid')::uuid)
   where user_id = '00000000-0000-0000-0000-000000000003';
  assert p1_crossed >= 1, 'FAIL: leaderboard should show p1 progress';
  raise notice 'OK: leaderboard reflects crossed cells (p1=%)', p1_crossed;
end $$;

-- admin strikes the event -> event rejected AND dependent cross-outs reverted
select pg_temp.act_as('00000000-0000-0000-0000-000000000001');
select public.admin_strike_event(current_setting('test.eid')::uuid);

do $$ declare still_crossed int; st text;
begin
  select status into st from public.events where id = current_setting('test.eid')::uuid;
  select count(*) into still_crossed from public.card_cells
   where crossed_event_id = current_setting('test.eid')::uuid;
  assert st = 'rejected', 'FAIL: struck event should be rejected';
  assert still_crossed = 0, 'FAIL: cross-outs from a struck event must be reverted';
  raise notice 'OK: admin strike reverted event and its cross-outs';
end $$;

do $$ begin raise notice '================ ALL TESTS PASSED ================'; end $$;

rollback;
