-- ═══ THE PURGE THAT HAS NEVER ONCE RUN ══════════════════════════════════════════════════════
--
-- APPLIED to qpztlobbnjyjbxqyuzgg on 2026-08-26 through the MCP, function deployed from
-- infra/edge-cleanup-hides.ts with the Supabase CLI (so the mirror and the deployed isolate are
-- byte-identical for once — diff them anyway before believing either). Proven live; the four
-- runs are recorded at the bottom of this file.
--
-- WHAT IS BROKEN. pg_cron job 1, `kamo-cleanup-expired-hides`, `20 3 * * *`. Twenty runs since
-- 2026-08-07, twenty failures, zero successes, every one identical:
--
--     ERROR:  Direct deletion from storage tables is not allowed. Use the Storage API instead.
--     CONTEXT: PL/pgSQL function storage.protect_delete() line 5 at RAISE
--
-- The function was four statements long and the first was `delete from storage.objects`.
-- Supabase has since put `storage.protect_delete()` in front of that table, so it raises, and
-- being first it took the `delete from hides` underneath with it. Nothing has ever been purged.
--
-- THE TRIGGER IS RIGHT AND THIS DOES NOT GO ROUND IT. Deleting the row in `storage.objects`
-- never deleted the bytes in S3, it detached them — the "orphaned objects" the HINT names. The
-- old function could not have shrunk the bucket even on a night it worked. What frees storage
-- is the Storage API, Postgres cannot call it, so the work moves to
-- infra/edge-cleanup-hides.ts, reached by pg_net, the way notify-creator already is.
--
-- ── THE STATE OF THE THING, read out of the live database 2026-08-26 ────────────────────────
--
--     hides                       19 469        expired 0, blocked 2
--     FIRST EXPIRY             2026-09-04        NINE DAYS. 10 679 more inside 21 days.
--                                                (now 2026-09-06: the volume rehearsal below
--                                                 purged the 425 oldest harness rows)
--     bucket `hides`              48 371 objects / 3 914 MB      = 2.48 objects per hide
--     img_path shared by >1 hide     323
--     attempts                    59 227        FK to hides, ON DELETE CASCADE, hide_id indexed
--     seek_traces                 62 283 / 38 MB   FK, ON DELETE CASCADE, hide_id NOT indexed
--
-- Three of those numbers are the reason this file is not simply the old function with the
-- delete swapped out.
--
-- ── ⚠️ 1. A HIDE IS THREE OBJECTS, AND `img_path` NAMES ONE OF THEM ─────────────────────────
--
-- `chUploadReveal()` posts two more JPEGs beside the camouflaged photo at DERIVED names —
-- `name.replace(/\.jpg$/, "_b.jpg")` is the figure as captured, `_w.jpg` is it mid-wave. They
-- are the seeker's snap and A/B flip. No column records them, by design ("derived names mean
-- no schema change"), so nothing in the database knows they exist. 27 918 of the bucket's
-- 48 371 objects are reveal frames — 2 287 MB, more than half the storage bill.
--
-- A purge that deletes only `img_path` therefore reclaims 40% of a hide and leaves the rest
-- forever. The bucket still grows without limit, just more slowly, which is worse than
-- obviously broken. So the claim below returns ALL THREE names per hide.
--
-- ── ⚠️ 2. AND THIS IS WHY THERE IS NO "DELETE OBJECTS WITH NO ROW" SWEEP ────────────────────
--
-- 30 028 objects have no `hides` row pointing at them, which reads exactly like 2.4 GB of
-- garbage waiting to be swept. It is not. 27 912 of them are the reveal frames OF LIVE HIDES —
-- unreferenced by construction, because their names are derived rather than stored. A sweep on
-- "no row names this object" would delete the payoff frame of every current hide in the
-- product: the round that ends on a marker instead of the body.
--
-- Genuinely unreferenced, once the frames are excluded: **2 110 objects / 167 MB**, oldest
-- 2026-08-05, including `selftest_upload.jpg`. That is the real orphan population and it is
-- small. Nothing here touches it either — it is a separate decision with a separate migration,
-- and the query that finds it is at the bottom of this file.
--
-- ── ⚠️ 3. DELETING A HIDE DELETES ITS ATTEMPTS, AND ALWAYS HAS ─────────────────────────────
--
-- `attempts` and `seek_traces` both carry ON DELETE CASCADE. So from 2026-09-04 this job starts
-- destroying the attempt history of every hide older than thirty days — the evidence behind
-- every retention figure in CLAUDE.md, which is computed over exactly that window. Nobody has
-- ever seen this happen because the purge has never once succeeded.
--
-- ⚠️ SUPERSEDED THE SAME DAY — see infra/2026-08-26-keep-attempt-history.sql. This file made
-- the cost visible rather than taking the schema decision on the way past; the answer came back
-- "keep the history", so both FKs were dropped in their own migration and the two counters were
-- renamed `attempts_kept` / `traces_kept`, because the identical number now means the opposite
-- thing. Nothing below is wrong, but the column names here are the old ones and the purge no
-- longer destroys anything but the hide row and its objects.
--
-- `hide_reactions` has NO foreign key, so its rows simply orphan. 1 720 rows today.
--
-- ── WHY THE RECORD IS A TABLE AND NOT cron.job_run_details ──────────────────────────────────
-- Twenty consecutive failures alerted nobody because the only place they were written is
-- `cron.job_run_details`. This dispatches over pg_net, which is fire-and-forget, so from
-- tonight cron reports SUCCESS whatever happens downstream — ⚠️ `jobid = 1` being green now
-- means "the request was queued", nothing more. The record that means something is
-- `public.ops_cleanup`: opened at dispatch, closed by the Edge Function, so a run that never
-- reports back stays visibly `dispatched` and the NEXT night's dispatch alerts on it.

-- ═══ STEP 0 — RUN THIS ONE STATEMENT ON ITS OWN, BEFORE THE TRANSACTION BELOW ═══════════════
--
-- CONCURRENTLY cannot run inside a transaction block, and this must not be skipped: the
-- seek_traces FK has no index behind it, so every hide deleted makes Postgres seq-scan 38 MB
-- to check the cascade. A 200-hide batch would be 200 scans. With 10 679 hides expiring in the
-- first three weeks that is not a slow job, it is a job that never finishes.
--
--   create index concurrently if not exists seek_traces_hide_id_idx on public.seek_traces (hide_id);
--
-- CONCURRENTLY because seek_traces is written on every seek and this must not take the write
-- lock — the standing rule in this project about indexes on hot paths.

begin;

create schema if not exists private;

-- ── the record, one row per night ───────────────────────────────────────────────────────────
create table if not exists public.ops_cleanup (
  id                bigserial primary key,
  started_at        timestamptz not null default now(),
  finished_at       timestamptz,
  -- dispatched | ok | partial | failed | dispatch_failed | not_armed | disabled | nothing_to_do
  status            text        not null default 'dispatched',
  candidates        integer     not null default 0,
  batches           integer     not null default 0,
  claimed           integer     not null default 0,
  objects_removed   integer     not null default 0,
  objects_missing   integer     not null default 0,  -- already gone: the idempotent case
  objects_shared    integer     not null default 0,  -- kept, a live hide still points at them
  rows_deleted      integer     not null default 0,
  attempts_cascaded integer     not null default 0,  -- ⚠️ see note 3 at the top
  traces_cascaded   integer     not null default 0,
  orphaned          integer     not null default 0,  -- row deleted, object refused
  retried           integer     not null default 0,  -- orphans from earlier nights, cleared
  remaining         integer,
  stopped_for       text,
  error             text,
  alerted           boolean     not null default false,
  alert_error       text
);
create index if not exists ops_cleanup_started_idx on public.ops_cleanup (started_at desc);

-- Paths whose `hides` row was deleted but whose object the Storage API refused. Nothing else
-- in the system knows these files exist any more — the row that named them is gone, and for a
-- reveal frame nothing ever named it — so this table is the only thing standing between a
-- refused delete and bytes billed forever.
create table if not exists public.ops_cleanup_orphans (
  path       text primary key,
  hide_id    text,
  first_seen timestamptz not null default now(),
  last_seen  timestamptz not null default now(),
  tries      integer     not null default 1,
  last_error text
);

-- RLS on and not one policy, same as ops_photo_probe and for the same reason: the anon key
-- ships inside index.html. postgres and service_role bypass RLS, which is exactly who reads it.
alter table public.ops_cleanup         enable row level security;
alter table public.ops_cleanup_orphans enable row level security;
revoke all on public.ops_cleanup, public.ops_cleanup_orphans from anon, authenticated;

-- ── the dials, so tuning is a one-line UPDATE and not a migration ───────────────────────────
-- `enabled=false` is the kill switch and it is the first thing the function reads. 200 hides a
-- batch is ~600 object keys (2.48 per hide) in 6 Storage calls; 40 batches is 8 000 hides a
-- night, against ~970 published a day and a 10 679-row wave in the first three weeks.
create table if not exists public.ops_cleanup_config (
  only_row     boolean primary key default true check (only_row),
  enabled      boolean not null default true,
  batch_size   integer not null default 200,
  api_chunk    integer not null default 100,    -- keys per Storage API call (the API caps at 1000)
  max_batches  integer not null default 40,
  budget_ms    integer not null default 90000,  -- the isolate's wall clock, left short of the limit
  orphan_limit integer not null default 500,
  webhook_url  text    not null default ''      -- empty: falls back to the photo probe's channel
);
alter table public.ops_cleanup_config enable row level security;
revoke all on public.ops_cleanup_config from anon, authenticated;
insert into public.ops_cleanup_config (only_row) values (true) on conflict do nothing;

-- ── the secrets, in `private` where push_config already lives ───────────────────────────────
create table if not exists private.cleanup_config (key text primary key, value text not null);

-- ── who is a candidate, defined exactly once ────────────────────────────────────────────────
-- A view so the claim, the count and the "remaining" figure cannot drift apart — three copies
-- of one predicate is how a purge starts deleting a slightly different set than the one it
-- reports. `expires_at <= now() or blocked` is the OLD function's predicate, unchanged and
-- deliberately so: this migration fixes how the deletion happens, not what is deleted.
create or replace view private.cleanup_candidates as
  select h.id, h.img_path from public.hides h where h.expires_at <= now() or h.blocked;
revoke all on private.cleanup_candidates from anon, authenticated;

-- ── the three object names a hide owns ──────────────────────────────────────────────────────
-- The ONLY place this rule is written on the database side, and it is a copy of one line of
-- index.html: `name.replace(/\.jpg$/, sfx + ".jpg")` in chUploadReveal(). If that ever gains a
-- third suffix, this is what has to learn about it — otherwise the new frame is billed forever
-- and nothing says so. Guarded on the `.jpg` ending so a path shaped differently yields the
-- one name we are sure of instead of two copies of it.
create or replace function private.hide_objects(p_path text)
returns text[] language sql immutable as $$
  select case
    when p_path is null or p_path = '' then '{}'::text[]
    when p_path ~ '[.]jpg$' then array[p_path,
                                       regexp_replace(p_path, '[.]jpg$', '_b.jpg'),
                                       regexp_replace(p_path, '[.]jpg$', '_w.jpg')]
    else array[p_path]
  end $$;
-- Pinned rather than left to the caller's path: it is reached from SECURITY DEFINER functions,
-- and Supabase's own linter flags a mutable search_path there as `function_search_path_mutable`.
alter function private.hide_objects(text) set search_path = pg_catalog;

-- ── the shared secret, checked by the database and not by the isolate ───────────────────────
create or replace function private.cleanup_auth(p_secret text)
returns void language plpgsql security definer set search_path = private, public as $$
declare v text;
begin
  select value into v from private.cleanup_config where key = 'shared_secret';
  if v is null or p_secret is null or p_secret <> v then
    raise exception 'forbidden' using errcode = '42501';
  end if;
end $$;

-- ── one place that says something out loud ──────────────────────────────────────────────────
-- Returns the delivery error, or null if it got out. THE ROW MUST SURVIVE THE MESSENGER: a
-- 404 webhook, a full pg_net queue or a typo in a URL may not cost us the record of what was
-- seen, because the record is what this whole file is for.
create or replace function private.cleanup_alert(p_msg text, p_ctx jsonb)
returns text language plpgsql security definer set search_path = private, public, extensions as $$
declare v_url text;
begin
  -- The fallback is deliberate: the photo probe's webhook IS the ops channel, and the failure
  -- being fixed here is nobody being told. Arming one arms both. `to_regclass` guards it so a
  -- project without the probe degrades to the warning below rather than to an exception.
  select nullif(c.webhook_url, '') into v_url from public.ops_cleanup_config c;
  if v_url is null and to_regclass('public.ops_photo_probe_config') is not null then
    execute 'select nullif(webhook_url, '''') from public.ops_photo_probe_config' into v_url;
  end if;
  v_url := coalesce(v_url, '');
  if v_url = '' then
    -- No channel wired yet: still be loud where Postgres logs are greppable.
    raise warning '%', p_msg;
    return null;
  end if;
  perform net.http_post(
    url     := v_url,
    headers := jsonb_build_object('Content-Type','application/json'),
    body    := jsonb_build_object('content', p_msg, 'probe', 'cleanup') || coalesce(p_ctx, '{}'::jsonb),
    timeout_milliseconds := 5000);
  return null;
exception when others then
  return left(SQLERRM, 300);
end $$;

-- ── the six RPCs the Edge Function calls ────────────────────────────────────────────────────
-- Every one of them re-checks the secret. Checking it once at the door and trusting the rest
-- of the conversation is how a leaked URL turns into a delete.

-- Raises rather than returning false: a request naming a run that is already closed is a
-- replay, and the only honest answer to a replay is to refuse it before anything is deleted.
create or replace function public.cleanup_ping(p_secret text, p_run bigint)
returns boolean language plpgsql security definer set search_path = public, private as $$
begin
  perform private.cleanup_auth(p_secret);
  if not exists (select 1 from public.ops_cleanup where id = p_run and status = 'dispatched') then
    raise exception 'forbidden: run % is not open', p_run using errcode = '42501';
  end if;
  return true;
end $$;

-- Claims a page of candidates and, per row, the objects that may go with it — all three names,
-- or none at all.
--
-- ⚠️ NONE AT ALL IS NOT A CORNER CASE: 323 img_paths are shared by more than one hide, because
-- a re-hide reuses the object it was made from. An expired row and a live row can name the same
-- file, and taking it because the older one expired blanks out a hide still in the feed —
-- indistinguishable from the 08-21 upload outage, a row that exists with no picture behind it.
-- The expired row is still deleted; only its files stay.
--
-- The `live` CTE is a hash semi-join over one pass of `hides`, NOT a correlated subquery per
-- row: 19k × 40 batches is nothing, 19k × 19k is a night. No index is added for it — `img_path`
-- has none and building one takes a write lock on the hot publish path to save a scan that
-- costs milliseconds. `expires_at` is already indexed, which is what the claim itself rides on.
create or replace function public.cleanup_claim_batch(p_secret text, p_run bigint, p_limit integer)
returns table(id text, paths text[])
language plpgsql security definer set search_path = public, private as $$
begin
  perform private.cleanup_auth(p_secret);
  return query
  with cand as (
    select c.id, c.img_path from private.cleanup_candidates c order by c.id limit greatest(p_limit, 1)
  ),
  live as (
    select distinct h.img_path from public.hides h
     where h.img_path is not null and h.img_path <> ''
       and h.img_path in (select k.img_path from cand k where k.img_path is not null)
       and not (h.expires_at <= now() or h.blocked)
  )
  select c.id,
         case when exists (select 1 from live l where l.img_path = c.img_path)
              then '{}'::text[]
              else private.hide_objects(c.img_path) end
    from cand c;
end $$;

-- Deletes the claimed rows, records whatever the bucket refused, and moves the counters.
--
-- ⚠️ THE ROWS GO WHATEVER THE OBJECTS DID. That is the requirement, and it is the opposite of
-- the old function, where one refused object stopped every row. A refused path is not lost with
-- it — it goes to ops_cleanup_orphans and a later run comes back for it.
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
    /* ⚠️ COUNTED BEFORE THE DELETE, because the delete is what destroys them. Both tables
       cascade off `hides`; `get diagnostics` reports only the top-level row count, so without
       this the largest thing the purge does would go entirely unrecorded. See note 3. */
    select count(*) into v_att from public.attempts    where hide_id = any(p_ids);
    select count(*) into v_tr  from public.seek_traces where hide_id = any(p_ids);

    delete from public.hides where id = any(p_ids);
    get diagnostics v_deleted = row_count;
  end if;

  select count(*) into v_remaining from private.cleanup_candidates;

  update public.ops_cleanup set
    batches           = batches + 1,
    claimed           = claimed + coalesce(array_length(p_ids, 1), 0),
    objects_removed   = objects_removed + coalesce(p_removed, 0),
    rows_deleted      = rows_deleted + v_deleted,
    attempts_cascaded = attempts_cascaded + v_att,
    traces_cascaded   = traces_cascaded + v_tr,
    orphaned          = orphaned + coalesce(array_length(p_failed, 1), 0)
  where id = p_run;

  return jsonb_build_object('deleted', v_deleted, 'remaining', v_remaining);
end $$;

-- One array rather than a set: PostgREST renders a set of scalars and an array differently, and
-- the caller treats the answer as a plain list of strings. Fewest tries first, so a path the
-- bucket keeps refusing cannot monopolise every night's pass.
create or replace function public.cleanup_claim_orphans(p_secret text, p_run bigint, p_limit integer)
returns text[] language plpgsql security definer set search_path = public, private as $$
begin
  perform private.cleanup_auth(p_secret);
  return array(select o.path from public.ops_cleanup_orphans o
                order by o.tries, o.first_seen limit greatest(p_limit, 1));
end $$;

create or replace function public.cleanup_clear_orphans(p_secret text, p_run bigint, p_paths text[])
returns integer language plpgsql security definer set search_path = public, private as $$
declare n integer := 0;
begin
  perform private.cleanup_auth(p_secret);
  if p_paths is null or array_length(p_paths, 1) is null then return 0; end if;
  delete from public.ops_cleanup_orphans where path = any(p_paths);
  get diagnostics n = row_count;
  update public.ops_cleanup set retried = retried + n where id = p_run;
  return n;
end $$;

-- Closes the run and, if it did not go cleanly, says so tonight rather than in twenty nights.
create or replace function public.cleanup_close_run(
  p_secret text, p_run bigint, p_status text, p_error text, p_summary jsonb)
returns void language plpgsql security definer set search_path = public, private as $$
declare r public.ops_cleanup; v_err text; v_msg text;
begin
  perform private.cleanup_auth(p_secret);

  update public.ops_cleanup set
    finished_at     = now(),
    status          = coalesce(nullif(p_status, ''), 'ok'),
    objects_missing = coalesce((p_summary->>'objects_missing')::int, objects_missing),
    objects_shared  = coalesce((p_summary->>'objects_shared')::int,  objects_shared),
    remaining       = coalesce((p_summary->>'remaining')::int,       remaining),
    stopped_for     = nullif(p_summary->>'stopped_for', ''),
    error           = left(coalesce(p_error, nullif(p_summary->>'notes', '[]')), 500)
  where id = p_run
  returning * into r;
  if not found then return; end if;

  if r.status in ('ok', 'nothing_to_do') then return; end if;

  v_msg := format('KAMO · the nightly hide purge finished %s. %s rows deleted, %s objects '
                  || 'removed, %s orphaned, %s still waiting.%s',
                  r.status, r.rows_deleted, r.objects_removed, r.orphaned,
                  coalesce(r.remaining::text, '?'),
                  case when r.error is null then '' else ' — ' || left(r.error, 200) end);
  v_err := private.cleanup_alert(v_msg, jsonb_build_object('run', r.id, 'status', r.status));
  update public.ops_cleanup set alerted = (v_err is null), alert_error = v_err where id = r.id;
end $$;

-- ── what pg_cron actually calls ─────────────────────────────────────────────────────────────
-- The old one is `returns integer`; this returns jsonb, and `create or replace` cannot change a
-- return type in place — the same constraint `get_hide` hits in 2026-08-25-get-hide-best-ms.sql.
-- Dropping is safe: the cron entry names the function in a SQL string, not by OID, so jobid 1
-- keeps working and keeps its history. The schedule and the job itself are NOT touched.
drop function if exists public.cleanup_expired_hides();

create or replace function public.cleanup_expired_hides()
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions
as $$
declare
  c public.ops_cleanup_config;
  prev public.ops_cleanup;
  v_url text; v_secret text; v_n integer; v_run bigint; v_err text;
begin
  select * into c from public.ops_cleanup_config;
  if c is null or not c.enabled then
    insert into public.ops_cleanup (status, finished_at) values ('disabled', now());
    return jsonb_build_object('status', 'disabled');
  end if;

  /* THE WATCHDOG, and the reason it comes first. The failure this file exists to fix was not
     "a statement raised" — it was that nothing noticed for twenty nights. A run that never
     came back stays at `dispatched`, and the only process that can see that is the next one. */
  select * into prev from public.ops_cleanup order by id desc limit 1;
  if prev.id is not null and prev.status = 'dispatched' then
    perform private.cleanup_alert(
      format('KAMO · the nightly hide purge (run %s, %s) never reported back. The Edge Function '
             || 'was dispatched and nothing closed the row — check that cleanup-hides is '
             || 'deployed and that its secret matches.', prev.id,
             to_char(prev.started_at at time zone 'UTC', 'MM-DD HH24:MI')),
      jsonb_build_object('run', prev.id, 'status', 'stuck'));
    update public.ops_cleanup set status = 'failed', finished_at = now(),
           error = coalesce(error, 'never reported back') where id = prev.id;
  end if;

  select count(*) into v_n from private.cleanup_candidates;
  if v_n = 0 then
    /* Still a row. "Nothing to do" and "nothing ran" have to be distinguishable, and until
       2026-09-04 they look identical from the outside. */
    insert into public.ops_cleanup (status, candidates, remaining, finished_at)
    values ('nothing_to_do', 0, 0, now());
    return jsonb_build_object('status', 'nothing_to_do', 'candidates', 0);
  end if;

  insert into public.ops_cleanup (status, candidates) values ('dispatched', v_n)
  returning id into v_run;

  select value into v_url    from private.cleanup_config where key = 'function_url';
  select value into v_secret from private.cleanup_config where key = 'shared_secret';
  if v_url is null or v_secret is null then
    update public.ops_cleanup set status = 'not_armed', finished_at = now(),
           error = 'private.cleanup_config is missing function_url or shared_secret'
     where id = v_run;
    v_err := private.cleanup_alert(
      format('KAMO · the nightly hide purge has %s hides to delete and is not armed — '
             || 'private.cleanup_config has no function_url/shared_secret.', v_n),
      jsonb_build_object('run', v_run, 'status', 'not_armed'));
    update public.ops_cleanup set alerted = (v_err is null), alert_error = v_err where id = v_run;
    return jsonb_build_object('status', 'not_armed', 'candidates', v_n);
  end if;

  /* Fire-and-forget on purpose. The isolate answers 202 in under a second and keeps working
     under EdgeRuntime.waitUntil, so this timeout covers the handshake and not the sweep —
     holding a pg_net worker for a minute and a half every night would be holding the same
     worker every push notification queues through. */
  begin
    perform net.http_post(
      url     := v_url,
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-kamo-secret', v_secret),
      body    := jsonb_build_object('run_id', v_run, 'opts', jsonb_build_object(
                   'batch', c.batch_size, 'api_chunk', c.api_chunk, 'max_batches', c.max_batches,
                   'budget_ms', c.budget_ms, 'orphan_limit', c.orphan_limit)),
      timeout_milliseconds := 10000);
  exception when others then
    v_err := left(SQLERRM, 300);
    update public.ops_cleanup set status = 'dispatch_failed', finished_at = now(), error = v_err
     where id = v_run;
    update public.ops_cleanup set alert_error = private.cleanup_alert(
      format('KAMO · the nightly hide purge could not even be dispatched: %s', v_err),
      jsonb_build_object('run', v_run, 'status', 'dispatch_failed'))
     where id = v_run;
    return jsonb_build_object('status', 'dispatch_failed', 'error', v_err);
  end;

  return jsonb_build_object('status', 'dispatched', 'run', v_run, 'candidates', v_n);
end $$;

-- ── AND THE CHECK THAT PUTS jobid's HONESTY BACK ────────────────────────────────────────────
--
-- Dispatching over pg_net means job 1 can no longer fail in front of pg_cron: it reads SUCCESS
-- whatever happens downstream. That quietly removed the one check anybody actually runs — the
-- `select … from cron.job_run_details where jobid = 1` that found this bug in the first place.
--
-- So the truth goes back where it was already being looked for. A second job reads the last run
-- and RAISES if it was not clean, twenty minutes after the purge — long after a sweep that used
-- its whole 90 s budget has closed. ITS jobid goes red; job 1 stays green because job 1 only
-- queues a request. `cron.job_run_details` is meaningful again, with no new tool to check.
--
-- This is not an alert and does not pretend to be one — it is a status somebody has to go and
-- read, which is exactly what failed for twenty nights. The webhook below is what actually
-- reaches a human, and it is one UPDATE whenever there is somewhere to send it.
create or replace function public.cleanup_assert_healthy()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare r public.ops_cleanup;
begin
  select * into r from public.ops_cleanup order by id desc limit 1;

  if r.id is null then
    raise exception 'kamo cleanup: no run has ever been recorded';
  end if;

  -- The dispatcher stopped firing: job disabled, dropped, or erroring before it can write a
  -- row. 26 hours so a daily job is never flagged for being a few minutes late.
  if r.started_at < now() - interval '26 hours' then
    raise exception 'kamo cleanup: nothing has run since % UTC',
      to_char(r.started_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI');
  end if;

  -- Dispatched and never closed: the Edge Function is undeployed, unreachable, or its secret
  -- stopped matching. This is the shape twenty silent nights had.
  if r.status = 'dispatched' then
    raise exception 'kamo cleanup: run % dispatched at % UTC and never reported back',
      r.id, to_char(r.started_at at time zone 'UTC', 'HH24:MI');
  end if;

  -- `disabled` is the kill switch and a deliberate act, so it is not a failure.
  if r.status not in ('ok', 'nothing_to_do', 'disabled') then
    raise exception 'kamo cleanup: run % finished % — % rows deleted, % objects left orphaned, % still waiting. %',
      r.id, r.status, r.rows_deleted, r.orphaned, coalesce(r.remaining, -1), coalesce(r.error, '');
  end if;
end $$;

-- ── who may call what ───────────────────────────────────────────────────────────────────────
-- The Edge Function reaches these over PostgREST with the service role key; anon and
-- authenticated have no business with any of them. `hides` is what they delete.
revoke all on function public.cleanup_expired_hides()                             from public, anon, authenticated;
revoke all on function public.cleanup_assert_healthy()                            from public, anon, authenticated;
revoke all on function public.cleanup_ping(text, bigint)                          from public, anon, authenticated;
revoke all on function public.cleanup_claim_batch(text, bigint, integer)          from public, anon, authenticated;
revoke all on function public.cleanup_settle_batch(text, bigint, text[], integer, text[]) from public, anon, authenticated;
revoke all on function public.cleanup_claim_orphans(text, bigint, integer)        from public, anon, authenticated;
revoke all on function public.cleanup_clear_orphans(text, bigint, text[])         from public, anon, authenticated;
revoke all on function public.cleanup_close_run(text, bigint, text, text, jsonb)  from public, anon, authenticated;
revoke all on function private.cleanup_auth(text)                                 from public, anon, authenticated;
revoke all on function private.cleanup_alert(text, jsonb)                         from public, anon, authenticated;
revoke all on function private.hide_objects(text)                                 from public, anon, authenticated;

grant execute on function public.cleanup_ping(text, bigint)                          to service_role;
grant execute on function public.cleanup_claim_batch(text, bigint, integer)          to service_role;
grant execute on function public.cleanup_settle_batch(text, bigint, text[], integer, text[]) to service_role;
grant execute on function public.cleanup_claim_orphans(text, bigint, integer)        to service_role;
grant execute on function public.cleanup_clear_orphans(text, bigint, text[])         to service_role;
grant execute on function public.cleanup_close_run(text, bigint, text, text, jsonb)  to service_role;

-- PostgREST resolves an RPC out of a cached schema; a fresh function it has not seen comes
-- back looking exactly like an auth failure. notify-creator lost a diagnostic cycle to that.
select cron.unschedule('kamo-cleanup-check')
 where exists (select 1 from cron.job where jobname = 'kamo-cleanup-check');
select cron.schedule('kamo-cleanup-check', '40 3 * * *', $c$select public.cleanup_assert_healthy()$c$);

notify pgrst, 'reload schema';

commit;

-- ── ARMING IT, in the order that leaves nothing half-live ───────────────────────────────────
--
-- 1. Deploy the isolate. Until it exists, every dispatch closes as `failed` with "never
--    reported back" — loudly, which is the point, but still twenty-four hours per go.
--
--      supabase functions deploy cleanup-hides --no-verify-jwt
--        (infra/edge-cleanup-hides.ts → supabase/functions/cleanup-hides/index.ts)
--
-- 2. Point the database at it. The shared secret is the one notify-creator already uses —
--    copied here explicitly rather than read across at run time, so rotating one function's
--    secret cannot silently change the other's.
--
--      insert into private.cleanup_config (key, value) values
--        ('function_url',  'https://qpztlobbnjyjbxqyuzgg.supabase.co/functions/v1/cleanup-hides'),
--        ('shared_secret', (select value from private.push_config where key = 'shared_secret'))
--      on conflict (key) do update set value = excluded.value;
--
-- 3. OPTIONAL — give it somewhere to shout. Not done, and nothing depends on it: without a URL
--    the alerts land as `raise warning` in the Postgres log, and the failure is still caught by
--    `kamo-cleanup-check` turning jobid 3 red. A webhook is what turns "go and look" into
--    "you are told". Any URL that accepts a POST works; Discord renders the `content` key
--    as-is, which is why the photo probe picked it. Empty here falls back to the probe's, so
--    arming either arms both.
--
--      update public.ops_cleanup_config set webhook_url = 'https://discord.com/api/webhooks/…';
--
-- ── WHAT THE FOUR PROVING RUNS ACTUALLY DID, 2026-08-26 ────────────────────────────────────
--
-- run 1  ok            2 rows, 1 object, 2 missing, 1 SHARED, 31 attempts + 4 traces cascaded,
--                      1.8 s. The two blocked hides. See below — this run is the whole argument.
-- run 2  nothing_to_do 0 candidates, closed immediately. The re-run path.
-- run 3  ok            25 rows in 3 batches (batch_size 10), 25 objects, 50 missing, 4.1 s.
--                      The multi-batch loop, on backdated `source is null` harness rows.
-- run 4  ok            400 rows in 2 batches, 400 objects, 800 missing, 219 attempts cascaded,
--                      14.3 s = **36 ms per hide**. The volume case.
--
-- ⚠️ RUN 1 IS THE REASON THE SHARED-PATH GUARD IS NOT THEORETICAL. Of the two blocked hides,
-- `decdc79a3847761c` shares `mt1gtdtv876pjiub.jpg` with `557ad8f202004d35` — is_public, NOT
-- blocked, expires 2026-09-19, played 7 times. Same photo, two hides, published 27 seconds
-- apart. The old function's `name in (select img_path from hides where … or blocked)` would have
-- deleted that file on its first successful night and left a live public hide showing nothing —
-- the 08-21 symptom, self-inflicted. Verified after the run: the row, its photo and both reveal
-- frames are all still there, and its 7 attempts with them.
--
-- ── WHAT THAT MAKES OF THE BUDGET ───────────────────────────────────────────────────────────
-- 36 ms per hide at batch_size 200 (vs 165 ms at batch_size 10 — the per-batch overhead is what
-- costs, so do not lower it). Real hides carry three objects to the harness's one, so budget
-- ~50 ms. Against that, the nights ahead:
--
--     09-06 … 09-13     265 – 781 hides/night     13 – 39 s     comfortable
--     09-14           1 833 hides                 ~92 s         ⚠️ over the 90 s budget
--     09-15           2 494 hides                ~125 s         ⚠️ over
--
-- Those two stop on `stopped_for = 'time'`, record what is left in `remaining`, and the next
-- night picks it up — the carry-over is designed, not a failure, and 09-16 onward is back to
-- ~970/day. If `remaining` climbs instead of draining, raise budget_ms (the isolate's wall
-- limit is the ceiling, 150 s on the smaller plans) before touching anything else.
--
-- To rehearse again, borrow the harness's leavings rather than publishing anything — they are
-- already junk (`source is null`, see the photo probe) and 7 787 of them are left:
--
--      update public.hides set expires_at = now() - interval '1 day'
--       where id in (select id from public.hides
--                    where source is null and not is_public and not blocked
--                    order by created_at limit 25);
--
-- ⚠️ Do NOT rehearse by backdating rows with `source is not null`. Those are somebody's hides.
--
-- ── READING IT AFTERWARDS ───────────────────────────────────────────────────────────────────
-- ⚠️ jobid 1 reads SUCCESS from tonight whatever happens — it only queues the request. The job
-- to read is **jobid 3, `kamo-cleanup-check`**, which is red exactly when the last run was not
-- clean, and carries the reason in `return_message`:
--
--      select start_time, status, left(return_message, 200)
--        from cron.job_run_details
--       where jobid = (select jobid from cron.job where jobname = 'kamo-cleanup-check')
--       order by start_time desc limit 5;
--
-- The full detail is still the table:
--
--      select started_at, status, candidates, rows_deleted, objects_removed,
--             attempts_cascaded, traces_cascaded, orphaned, remaining, stopped_for, left(error,120)
--        from public.ops_cleanup order by id desc limit 10;
--
--      select count(*), min(first_seen), max(tries) from public.ops_cleanup_orphans;
--
-- The 2 110 genuinely unreferenced objects — NOT touched by anything above, and not to be swept
-- without reading note 2 first:
--
--      select o.name, o.created_at, (o.metadata->>'size')::bigint
--        from storage.objects o
--       where o.bucket_id = 'hides' and o.name !~ '_[bw][.]jpg$'
--         and not exists (select 1 from public.hides h where h.img_path = o.name)
--       order by o.created_at;
--
-- Kill switch:  update public.ops_cleanup_config set enabled = false;
