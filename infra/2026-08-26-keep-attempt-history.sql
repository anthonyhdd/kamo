-- ═══ THE PLAY HISTORY SURVIVES THE PURGE ════════════════════════════════════════════════════
--
-- Applied to qpztlobbnjyjbxqyuzgg on 2026-08-26, immediately after
-- infra/2026-08-26-cleanup-storage-api.sql and because of what that file found.
--
-- WHY. `attempts` and `seek_traces` both carried `FOREIGN KEY (hide_id) REFERENCES hides(id)
-- ON DELETE CASCADE`. Harmless for eighteen days, because the nightly purge had never once
-- succeeded — but the moment it did, every hide older than thirty days would take its play
-- history with it. That history is the evidence behind every retention figure in CLAUDE.md,
-- and those are computed over exactly the thirty-day window being purged. The first real
-- expiries land 2026-09-06, so this had days on it, not weeks.
--
-- Nobody chose that behaviour. It came in with the tables and had never been exercised.
--
-- ── THE CONSTRAINT WAS BUYING NOTHING AT INSERT TIME ────────────────────────────────────────
--
-- Which is what makes this cheap rather than a trade. Both write paths — and they are the only
-- two, `attempts` and `seek_traces` are written nowhere else — already check the hide
-- themselves, and more strictly than a foreign key can:
--
--   submit_attempt()   select * into h from hides where id = p_id and not blocked
--                        and expires_at > now();
--                      if not FOUND then raise exception 'no such hide'; end if;
--
--   save_seek_trace()  if not exists (select 1 from hides where id = p_id and not blocked
--                        and expires_at > now()) then return; end if;
--
-- The FK would have accepted a blocked or expired hide; these two do not. So dropping it
-- removes a delete-time behaviour nobody asked for and gives up no insert-time guarantee.
--
-- ⚠️ THE INDEXES DO NOT GO WITH IT. `attempts_hide_id_idx` and `seek_traces_hide_id_idx` are
-- ordinary indexes, not constraint machinery, and every join still needs them — the second one
-- was created the same day precisely because the cascade had no index behind it. Dropping the
-- constraints also makes the purge strictly faster: deleting a hide is now a single-table
-- delete instead of a cascade into two more.
--
-- ── ⚠️ WHAT IT COSTS, so this is a decision and not a surprise ──────────────────────────────
--
-- Both tables now grow without limit. Measured over the last 7 days:
--
--     attempts      2 331 rows/day × 149 B  ≈  127 MB/year
--     seek_traces   2 505 rows/day × 659 B  ≈  600 MB/year
--
-- If space ever bites, `seek_traces` is the one to put a window on — it is replay data, already
-- capped at 200 traces per hide, and four fifths of the growth. `attempts` is 149 bytes a row
-- and is what every number in this project is made of. Do not trim that one to save 127 MB.
--
-- ── AND WHAT ORPHANED ROWS DO TO THE READS ──────────────────────────────────────────────────
--
-- `hide_id` stays on every row; the hide it names is simply gone. Everything keyed FROM a hide
-- (the feed, get_hide, chBestS, my_replies) filters by a hide that exists, so orphans are never
-- selected and nothing changes. The one read that widens is deliberate and welcome:
-- submit_attempt's `v_scope = 'all'` branch ranks a seeker against `attempts where v >= 2`
-- across the whole table when their hide has fewer than 5 plays of its own. That pool now keeps
-- growing instead of being cut back every night, which is the better ranking, not a bug.
--
-- ⚠️ Any GLOBAL count over `attempts` or `seek_traces` now includes rows whose hide is gone.
-- That is the point — but a query that joins to `hides` to filter (say, on `source is not
-- null`) will silently drop them. Count from the table, not through the join.

alter table public.attempts    drop constraint if exists attempts_hide_id_fkey;
alter table public.seek_traces drop constraint if exists seek_traces_hide_id_fkey;

-- The counters in ops_cleanup measured what the purge DESTROYED. Nothing is destroyed any more,
-- so the identical number now means the opposite thing, and the old names would read as a loss
-- report every night for something that is working correctly.
alter table public.ops_cleanup rename column attempts_cascaded to attempts_kept;
alter table public.ops_cleanup rename column traces_cascaded   to traces_kept;

comment on column public.ops_cleanup.attempts_kept is
  'attempts rows belonging to the hides deleted in this run. They SURVIVE — the FK was dropped 2026-08-26. Orphaned by hide_id, deliberately.';
comment on column public.ops_cleanup.traces_kept is
  'seek_traces rows belonging to the hides deleted in this run. They survive too.';

-- Same body as in 2026-08-26-cleanup-storage-api.sql but for the two column names and the
-- comment that now says the opposite thing. Repeated in full because a `create or replace`
-- that only shows its diff is a function nobody can read in one place.
create or replace function public.cleanup_settle_batch(
  p_secret text, p_run bigint, p_ids text[], p_removed integer, p_failed text[])
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare v_deleted integer := 0; v_remaining integer; v_att integer := 0; v_tr integer := 0;
begin
  perform private.cleanup_auth(p_secret);

  /* Written down BEFORE the rows go, because the row is the only thing that knows which hide
     a path belonged to — after the delete that association is unrecoverable. */
  if p_failed is not null and array_length(p_failed, 1) > 0 then
    insert into public.ops_cleanup_orphans (path, hide_id, last_error)
    select p,
           (select h.id from public.hides h
             where private.hide_objects(h.img_path) @> array[p] limit 1),
           'storage delete refused'
      from unnest(p_failed) as p
    on conflict (path) do update
      set tries = ops_cleanup_orphans.tries + 1, last_seen = now();
  end if;

  if p_ids is not null and array_length(p_ids, 1) > 0 then
    /* Counted before the delete, because afterwards nothing joins these rows to the hide any
       more — the id is still on them, but the hide it names is gone. Since the FKs were dropped
       this is the number PRESERVED, not the number lost, and a night where it is large is the
       proof the history is being kept rather than a report of damage. */
    select count(*) into v_att from public.attempts    where hide_id = any(p_ids);
    select count(*) into v_tr  from public.seek_traces where hide_id = any(p_ids);

    delete from public.hides where id = any(p_ids);
    get diagnostics v_deleted = row_count;
  end if;

  select count(*) into v_remaining from private.cleanup_candidates;

  update public.ops_cleanup set
    batches         = batches + 1,
    claimed         = claimed + coalesce(array_length(p_ids, 1), 0),
    objects_removed = objects_removed + coalesce(p_removed, 0),
    rows_deleted    = rows_deleted + v_deleted,
    attempts_kept   = attempts_kept + v_att,
    traces_kept     = traces_kept + v_tr,
    orphaned        = orphaned + coalesce(array_length(p_failed, 1), 0)
  where id = p_run;

  return jsonb_build_object('deleted', v_deleted, 'remaining', v_remaining);
end $$;

notify pgrst, 'reload schema';

-- ── PROVEN ON REAL DELETIONS, NOT ON THE SCHEMA ─────────────────────────────────────────────
-- Three harness hides carrying 12 attempts between them were backdated and purged (run 6):
--
--     run 6   ok   3 hides deleted   attempts_kept = 12
--     hide rows left ....... 0
--     attempts still there . 12      ← the same 12 the run reported keeping
--     FKs to hides left .... 0
--
-- Before this file, that run destroyed twelve rows and reported it as `attempts_cascaded`.
--
--     select count(*) from public.attempts a
--      where not exists (select 1 from public.hides h where h.id = a.hide_id);
--     -- orphaned-but-kept rows; expect this to grow every night from 2026-09-06
