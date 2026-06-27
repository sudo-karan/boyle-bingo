-- Derived leaderboard. SECURITY DEFINER so it can read every player's cells,
-- but it returns ONLY aggregates (counts/flags/timestamps) — never cell
-- contents — so it is safe to expose to everyone, including the target.

create or replace function public.get_leaderboard(p_game uuid)
returns table (
  user_id       uuid,
  display_name  text,
  crossed       int,
  filled        int,
  has_line      boolean,
  blackout      boolean,
  blackout_at   timestamptz,
  first_line_at timestamptz,
  last_cross_at timestamptz
)
language plpgsql stable security definer set search_path = public as $$
declare n int; c record; r int;
        v_crossed int; v_filled int; v_line boolean; v_first_line timestamptz;
        v_line_complete boolean; v_line_at timestamptz;
begin
  select grid_size into n from public.games where id = p_game;

  for c in
    select cd.id, cd.user_id, pr.display_name
      from public.cards cd join public.profiles pr on pr.id = cd.user_id
     where cd.game_id = p_game
  loop
    select count(*) filter (where crossed_at is not null),
           count(*) filter (where pool_option_id is not null),
           max(crossed_at)
      into v_crossed, v_filled, last_cross_at
      from public.card_cells where card_id = c.id;

    v_line := false; v_first_line := null;

    -- rows, cols, and the two diagonals: a line is complete iff all n of its
    -- cells are crossed; its completion time is the latest cross in the line.
    for r in 0..n-1 loop
      -- row r
      select count(*) = n, max(crossed_at) into v_line_complete, v_line_at
        from public.card_cells where card_id = c.id and "row" = r and crossed_at is not null;
      if v_line_complete then
        v_line := true;
        v_first_line := least(coalesce(v_first_line, v_line_at), v_line_at);
      end if;
      -- col r
      select count(*) = n, max(crossed_at) into v_line_complete, v_line_at
        from public.card_cells where card_id = c.id and col = r and crossed_at is not null;
      if v_line_complete then
        v_line := true;
        v_first_line := least(coalesce(v_first_line, v_line_at), v_line_at);
      end if;
    end loop;

    -- main diagonal (row = col)
    select count(*) = n, max(crossed_at) into v_line_complete, v_line_at
      from public.card_cells where card_id = c.id and "row" = col and crossed_at is not null;
    if v_line_complete then
      v_line := true; v_first_line := least(coalesce(v_first_line, v_line_at), v_line_at);
    end if;
    -- anti-diagonal (row + col = n - 1)
    select count(*) = n, max(crossed_at) into v_line_complete, v_line_at
      from public.card_cells where card_id = c.id and ("row" + col) = n - 1 and crossed_at is not null;
    if v_line_complete then
      v_line := true; v_first_line := least(coalesce(v_first_line, v_line_at), v_line_at);
    end if;

    user_id := c.user_id; display_name := c.display_name;
    crossed := v_crossed; filled := v_filled; has_line := v_line;
    blackout := (v_filled > 0 and v_crossed = v_filled);
    blackout_at := case when (v_filled > 0 and v_crossed = v_filled) then last_cross_at end;
    first_line_at := v_first_line;
    return next;
  end loop;
end $$;
