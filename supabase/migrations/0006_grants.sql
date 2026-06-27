-- Lock down function exposure. Internal helpers/resolvers are revoked from the
-- API roles; only the player/admin-facing RPCs are callable.

revoke execute on all functions in schema public from anon, authenticated;

-- helpers used by RLS are callable (cheap, read-only)
grant execute on function public.is_admin() to authenticated;
grant execute on function public.game_target(uuid) to authenticated;
grant execute on function public.is_player(uuid) to authenticated;
grant execute on function public.eligible_voter_count(uuid) to authenticated;
grant execute on function public.get_leaderboard(uuid) to authenticated;

-- player + admin RPCs
grant execute on function public.create_game(uuid, int, timestamptz, timestamptz, int, boolean) to authenticated;
grant execute on function public.start_fill(uuid) to authenticated;
grant execute on function public.ensure_card(uuid) to authenticated;
grant execute on function public.add_pool_option(uuid, text) to authenticated;
grant execute on function public.place_cell(uuid, uuid) to authenticated;
grant execute on function public.propose_merge(uuid, uuid, uuid, text) to authenticated;
grant execute on function public.vote_merge(uuid, boolean) to authenticated;
grant execute on function public.raise_event(uuid, uuid, text, text, uuid[]) to authenticated;
grant execute on function public.vote_event(uuid, boolean) to authenticated;
grant execute on function public.cross_out(uuid) to authenticated;
grant execute on function public.claim_presence(uuid) to authenticated;
grant execute on function public.vote_presence(uuid, boolean) to authenticated;
grant execute on function public.admin_strike_event(uuid) to authenticated;
grant execute on function public.admin_strike_crossout(uuid) to authenticated;
grant execute on function public.admin_strike_presence(uuid) to authenticated;

-- tick_games is invoked by the keep-alive/cron workflow via an authenticated
-- admin request; grant to authenticated but it no-ops for non-admin-relevant
-- state since it only advances time-based transitions.
grant execute on function public.tick_games() to authenticated;
