-- Photos bucket + realtime publication.

-- 'photos' bucket: public-read keeps the client simple (URLs are unguessable
-- UUID paths). Uploads are restricted to authenticated non-admin players.
insert into storage.buckets (id, name, public)
values ('photos', 'photos', true)
on conflict (id) do nothing;

create policy "photos read"
  on storage.objects for select
  using (bucket_id = 'photos');

create policy "photos upload"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'photos');

-- ---------------------------------------------------------------------------
-- Realtime: clients subscribe (filtered by game_id) to these tables. RLS still
-- applies to realtime, so the target physically cannot receive pool/card rows.
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table public.games;
alter publication supabase_realtime add table public.pool_options;
alter publication supabase_realtime add table public.merge_proposals;
alter publication supabase_realtime add table public.merge_votes;
alter publication supabase_realtime add table public.events;
alter publication supabase_realtime add table public.event_votes;
alter publication supabase_realtime add table public.event_presence;
alter publication supabase_realtime add table public.card_cells;
alter publication supabase_realtime add table public.audit_log;
