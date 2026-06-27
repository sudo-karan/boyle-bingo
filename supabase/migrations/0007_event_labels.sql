-- The target cannot read pool_options (RLS), but needs the activity label for
-- events about them (to vote and for the incremental reveal). This returns
-- labels ONLY for events the caller is already allowed to see:
--   * non-target players / admin: every event in the game
--   * the target: only events they are confirmed-present at
create or replace function public.event_labels(p_game uuid)
returns table (event_id uuid, label text)
language sql stable security definer set search_path = public as $$
  select e.id, po.label
    from public.events e
    join public.pool_options po on po.id = e.pool_option_id
   where e.game_id = p_game
     and (
       public.is_admin()
       or public.is_player(p_game)
       or (auth.uid() = public.game_target(p_game)
           and exists (select 1 from public.event_presence ep
                       where ep.event_id = e.id and ep.user_id = auth.uid()
                         and ep.status = 'confirmed'))
     );
$$;

grant execute on function public.event_labels(uuid) to authenticated;
