-- Drive phase transitions (fill->frozen->ended) and vote-window auto-resolution
-- from inside Postgres every minute via pg_cron.
--
-- pg_cron must be enabled first: Supabase Dashboard > Database > Extensions >
-- enable "pg_cron". Then this runs as the postgres role, which may call the
-- SECURITY DEFINER tick_games().
create extension if not exists pg_cron;

select cron.schedule(
  'boyle-bingo-tick',
  '* * * * *',
  $$ select public.tick_games(); $$
);
