-- ═══ THE FEED STOPS SERVING BLACK RECTANGLES, AND KEEPS STOPPING ═══════════════════════════
--
-- ⚠️ ITS THRESHOLD WAS SUPERSEDED THE NEXT DAY by 2026-09-19-feed-drops-the-dark-too.sql: the
-- gate is `lqip_mean < 40`, darkness alone, not the 18-AND-flat pair written below. Everything
-- else here — the columns, the sweep, the edge function, the cron, the reasoning about what
-- this is allowed to do to a hide — is current and still the file to read first. The section
-- called THE NUMBERS ARE STORED, THE CUT IS NOT explains why moving the line cost one UPDATE
-- and no re-measurement, which is the part that worked.
--
-- Founder, 2026-09-18: « il y a plein de photos totalement noires et ça nuit au jeu. Enlève
-- toutes ces photos et n'en mets plus sur le feed à l'avenir. »
--
-- The first half of that sentence was already answered once, by hand, on 2026-08-20:
-- `infra/2026-08-20-black-slab-purge.sql` unpublished 434 hides after downloading 3 738 images
-- through the public bucket and running them through the client's own thresholds, locally, in
-- a laptop. It worked. It also could not be repeated: the list was pasted into the migration,
-- the second half of the sentence was never answered at all, and ~900 hides a day have been
-- published since. A one-off purge of a corpus that refills is a purge that has to be redone
-- every month by whoever remembers it exists.
--
-- So this is not a purge. It is the measurement, made once per hide, stored on the row, and
-- read by the feed — the same shape `conceal` took on 2026-08-28 and `source` on 2026-08-27.
--
-- ── WHAT WAS ACTUALLY BROKEN ────────────────────────────────────────────────────────────────
--
-- kfLooksBlack() in index.html has judged these since 2026-08-17 and it judges them WELL. What
-- it cannot do is remember. It runs on each player's device, on each page, for ever: 13 726
-- drops for 5 705 feed opens on 08-17, ~2.4 photographs thrown away per feed opened. The row
-- stays in the corpus, keeps winning a slot in every page served to everyone, and gets dropped
-- again — so a page of 8 arrives as a page of 5 or 6, the feed empties faster than it should,
-- and an empty page is what pushes paint() into a second lap over hides the player just saw.
--
-- The filter was never the problem. The corpus was.
--
-- ── THE MEASUREMENT IS READ OFF THE LQIP, SERVER-SIDE, EXACTLY ONCE ─────────────────────────
--
-- `lqip` is a ~20px JPEG carried in the row — the same pixels the photograph is made of, and
-- the same bytes kfLooksBlack() reads. So the verdict needs no bucket download, no storage
-- call and no client: `infra/edge-measure-lqip.ts` decodes it in an isolate and writes back
-- `lqip_mean` / `lqip_spread`, and `lqip_judged_at` says we looked.
--
-- ⚠️ NOT REPORTED BY THE PLAYERS' DEVICES, WHICH WAS THE OBVIOUS DESIGN AND IS WRONG. Every
-- seeker's browser already computes this verdict and already fires `feed_black_dropped` with
-- it; having it POST the number instead would have cost one RPC and no new infrastructure. It
-- would also have made "this hide is invisible to everyone, for ever" a thing any holder of
-- the anon key — which ships inside index.html — can assert about any id they can read out of
-- feed_page. The feed would be one loop away from empty. The bytes are in the database; the
-- database is where they get read.
--
-- ── THE NUMBERS ARE STORED, THE CUT IS NOT ──────────────────────────────────────────────────
--
-- mean AND spread, both, because either alone is wrong — a night room is dark without being
-- flat, a grey wall is flat without being dark, and what is unplayable is both at once. They
-- are stored as measured so the threshold can move later with a one-line UPDATE to this
-- predicate instead of a re-measurement of the whole corpus.
--
-- THE CUT IS THE CLIENT'S OWN: mean < 18 AND spread < 10, the KF_DARK_MEAN / KF_DARK_SPREAD
-- pair in index.html, deliberately identical. The 08-20 purge chose a much stricter core
-- (mean<4 and spread<4) and was right to: it was setting is_public = false, which takes a
-- hide away from the person who made it, and it had found two rows — msxbm1foo01epnsa (11/8)
-- and msuuyjp8htczikt4 (17/10) — that are real dark hides the client is a little too eager to
-- drop. THIS IS NOT THAT. Nothing here unpublishes anything: the row keeps is_public, keeps
-- its link, keeps arriving as a direct challenge, keeps playing. It stops taking a slot in the
-- feed — a slot it was already losing on every device that rendered it. Matching the client
-- exactly means the pool finally contains what players actually see, and those two rows lose
-- nothing they still had.
--
-- ── AND IT IS THE FEED, NOT THE PUBLISH FLOOR ───────────────────────────────────────────────
--
-- Same rule as 2026-08-29. A refused publish blocks a creator at the one button where the send
-- rate lives; that button has been covered twice already by things merely sitting near it.
-- Nothing in this file can refuse a publish, and nothing in it runs on the publish path.
--
-- ── WHAT STAYS EXACTLY AS IT IS ─────────────────────────────────────────────────────────────
--
-- kfLooksBlack() stays in index.html and stays armed. The sweep runs every 5 minutes, so a
-- slab published 30 seconds ago is measured within a few minutes, and the client filter is
-- what covers those few minutes. Belt and braces, and `feed_black_dropped` becomes the
-- monitoring for this file: it should collapse toward the handful of rows younger than one
-- sweep. If it does not, the sweep is not running — look at ops_lqip_sweep.
--
-- Applied 2026-09-18, as one batch (every statement below is transactional DDL; the cron
-- lines at the bottom are the only thing that must land whether or not they are replayed).

-- ── the measurement, on the row ─────────────────────────────────────────────────────────────
-- Both numbers or neither: a half-written verdict is a row the gate below cannot reason about,
-- and an undecodable placeholder (there are a few: a 2x2, a truncated object) must read as
-- "judged, not black" rather than as "dark with an unknown spread".
alter table public.hides
  add column if not exists lqip_mean      smallint,
  add column if not exists lqip_spread    smallint,
  add column if not exists lqip_judged_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'hides_lqip_verdict_whole') then
    alter table public.hides add constraint hides_lqip_verdict_whole
      check ((lqip_mean is null) = (lqip_spread is null)) not valid;
  end if;
end $$;

-- The sweep's only query. Partial, so it stays the size of the backlog rather than the size of
-- the table, and empties to nothing once the corpus is caught up.
create index if not exists hides_lqip_unjudged_idx
  on public.hides (created_at desc)
  where lqip_judged_at is null and lqip is not null;

-- ── the gate, in every overload of both feed functions ──────────────────────────────────────
-- ⚠️ ALL SEVEN. This page deploys on push and the database does not, so a browser holding a
-- minute-old copy still calls the signature it was built against. Gating one would clean the
-- feed for some users and not others — worse than not gating at all, because it would look
-- like the feature working. Substitution rather than seven literals, so they cannot drift.
--
-- ⚠️ AND THE NULLS ARE SPELLED OUT. `not (mean < 18 and spread < 10)` is the predicate a reader
-- writes first and it is a trap: on an unjudged row both sides are NULL, `not NULL` is NULL,
-- and a WHERE clause drops what it cannot prove — the whole backlog would vanish from the feed
-- the moment this ran. The is-null rungs come first and admit the row, which is also what
-- `conceal` does one line above and for the same reason.
do $mig$
declare
  r      record;
  src    text;
  n      int := 0;
  missed text[] := '{}';
  anchor constant text := 'and (h.conceal is null or h.conceal >= 70)';
  gated  constant text :=
    'and (h.conceal is null or h.conceal >= 70)
    and (h.lqip_mean is null or h.lqip_spread is null
         or h.lqip_mean >= 18 or h.lqip_spread >= 10)';
begin
  for r in
    select p.oid, p.oid::regprocedure::text as sig
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public' and p.proname in ('feed_page', 'feed_best')
  loop
    src := pg_get_functiondef(r.oid);
    if position('lqip_mean' in src) > 0 then continue; end if;          -- idempotent
    if position(anchor in src) = 0 then
      missed := missed || r.sig;                                        -- never silently skip one
      continue;
    end if;
    execute replace(src, anchor, gated);
    n := n + 1;
  end loop;
  -- Loud, and it takes the transaction with it. A feed function this could not reach is a
  -- fleet of clients still being served rectangles, and finding that out from a founder a
  -- month later is the failure mode this whole file exists to end.
  if array_length(missed, 1) is not null then
    raise exception 'feed gate not applied to: %', array_to_string(missed, ', ');
  end if;
  raise notice 'lqip gate: % feed function(s) rewritten', n;
end $mig$;

-- ── the sweep's dials, so tuning is an UPDATE and not a migration ───────────────────────────
-- `enabled = false` is the kill switch and the function reads it first: a sweep that cannot be
-- silenced from a phone is a sweep that gets dropped from cron and forgotten.
create table if not exists public.ops_lqip_config (
  only_row     boolean primary key default true check (only_row),
  enabled      boolean not null default true,
  batch_size   integer not null default 400,    -- rows per RPC round trip (~650 KB of lqip)
  budget_ms    integer not null default 20000,  -- the isolate's wall clock, left short of its limit
  function_url text    not null default ''
);
alter table public.ops_lqip_config enable row level security;
revoke all on public.ops_lqip_config from anon, authenticated;
insert into public.ops_lqip_config (only_row, function_url)
values (true, 'https://qpztlobbnjyjbxqyuzgg.supabase.co/functions/v1/measure-lqip')
on conflict (only_row) do nothing;

-- One row per dispatch, so "is the sweep running" is a query and not a guess.
create table if not exists public.ops_lqip_sweep (
  id         bigserial primary key,
  ran_at     timestamptz not null default now(),
  request_id bigint,
  backlog    integer
);
create index if not exists ops_lqip_sweep_ran_at_idx on public.ops_lqip_sweep (ran_at desc);
alter table public.ops_lqip_sweep enable row level security;
revoke all on public.ops_lqip_sweep from anon, authenticated;

-- ── the shared secret, checked by the database and not by the isolate ───────────────────────
-- Same contract as cleanup-hides: the secret travels DB → isolate in the `x-kamo-secret` header
-- and comes back on every RPC, so the isolate stores nothing and a leaked function URL buys an
-- attacker a 42501. Generated here; nobody needs to read it.
create table if not exists private.lqip_config (key text primary key, value text not null);
insert into private.lqip_config (key, value)
values ('shared_secret', encode(gen_random_bytes(32), 'hex'))
on conflict (key) do nothing;

create or replace function private.lqip_auth(p_secret text)
returns void language plpgsql security definer set search_path = private, public as $$
declare v text;
begin
  select value into v from private.lqip_config where key = 'shared_secret';
  if v is null or p_secret is null or p_secret <> v then
    raise exception 'forbidden' using errcode = '42501';
  end if;
end $$;

-- ── the two RPCs the isolate calls ──────────────────────────────────────────────────────────
-- No claim table and no lease: two overlapping sweeps would measure the same rows twice and
-- write the same numbers, which costs a few hundred milliseconds and corrupts nothing. A lease
-- would add a failure mode (rows stuck claimed by an isolate that died) to defend against an
-- outcome that is already harmless.
--
-- NEWEST FIRST, deliberately. The backlog is one-off; the rows published in the last five
-- minutes are the ones the feed is about to serve, and they must never wait behind 8 000
-- historical ones.
create or replace function public.lqip_next_batch(p_secret text, p_limit integer)
returns table (id text, lqip text)
language plpgsql security definer set search_path = public, private as $$
begin
  perform private.lqip_auth(p_secret);
  return query
    select h.id, h.lqip
    from public.hides h
    where h.lqip is not null
      and h.lqip_judged_at is null
      and h.is_public and not h.blocked and h.expires_at > now()
    order by h.created_at desc
    limit least(greatest(coalesce(p_limit, 400), 1), 1000);
end $$;

create or replace function public.lqip_record(
  p_secret text, p_ids text[], p_means integer[], p_spreads integer[])
returns integer
language plpgsql security definer set search_path = public, private as $$
declare n integer;
begin
  perform private.lqip_auth(p_secret);
  if p_ids is null or array_length(p_ids, 1) is null then return 0; end if;
  -- Three arrays travelling as one record is a shape that goes wrong silently: a short means[]
  -- would pair every verdict with the wrong hide from that point on, and the result would look
  -- exactly like a working sweep. Refuse rather than write.
  if coalesce(array_length(p_means, 1), -1) <> array_length(p_ids, 1)
     or coalesce(array_length(p_spreads, 1), -1) <> array_length(p_ids, 1) then
    raise exception 'lqip_record: % ids, % means, % spreads',
      array_length(p_ids, 1), array_length(p_means, 1), array_length(p_spreads, 1);
  end if;
  with v as (
    select unnest(p_ids) as id, unnest(p_means) as mean, unnest(p_spreads) as spread
  )
  update public.hides h
     set lqip_mean   = case when v.mean is null or v.spread is null then null
                            else greatest(0, least(255, v.mean))::smallint end,
         lqip_spread = case when v.mean is null or v.spread is null then null
                            else greatest(0, least(255, v.spread))::smallint end,
         lqip_judged_at = now()
    from v
   where v.id = h.id;
  get diagnostics n = row_count;
  return n;
end $$;

-- The anon key ships inside index.html, and EXECUTE is granted to PUBLIC by default on every
-- function Postgres creates. The secret check would refuse them anyway; this is the second
-- lock, and it is the one that does not depend on a string comparison.
revoke all on function public.lqip_next_batch(text, integer) from public, anon, authenticated;
revoke all on function public.lqip_record(text, text[], integer[], integer[]) from public, anon, authenticated;
grant execute on function public.lqip_next_batch(text, integer)                    to service_role;
grant execute on function public.lqip_record(text, text[], integer[], integer[])   to service_role;

-- ── the dispatch ────────────────────────────────────────────────────────────────────────────
-- Returns the pg_net request id, or null when there was nothing to do — so an idle sweep
-- writes no row and `ops_lqip_sweep` stays a log of work rather than a log of ticks.
create or replace function public.sweep_lqip()
returns bigint
language plpgsql security definer set search_path = public, private, extensions as $$
declare
  cfg      record;
  v_secret text;
  v_req    bigint;
  v_left   integer;
begin
  select * into cfg from public.ops_lqip_config;
  if cfg is null or not cfg.enabled or cfg.function_url = '' then return null; end if;

  select count(*) into v_left
  from public.hides h
  where h.lqip is not null and h.lqip_judged_at is null
    and h.is_public and not h.blocked and h.expires_at > now();
  if v_left = 0 then return null; end if;

  select value into v_secret from private.lqip_config where key = 'shared_secret';

  -- 60 s rather than the 5 s the alert paths use: this one has an answer worth keeping, and
  -- pg_net stores it in net._http_response where the summary can be read after the fact.
  select net.http_post(
    url     := cfg.function_url,
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'x-kamo-secret', v_secret),
    body    := jsonb_build_object('batch', cfg.batch_size,
                                  'budget_ms', cfg.budget_ms),
    timeout_milliseconds := 60000) into v_req;

  insert into public.ops_lqip_sweep (request_id, backlog) values (v_req, v_left);
  return v_req;
end $$;

revoke all on function public.sweep_lqip() from public, anon, authenticated;

-- ── cron ───────────────────────────────────────────────────────────
-- Every 5 minutes: the backlog drains in the first few runs and each run afterwards measures
-- the ~3 hides published since the last one. Unschedule-then-schedule so re-running this file
-- cannot leave two jobs racing.
select cron.unschedule('kamo-lqip-sweep')
where exists (select 1 from cron.job where jobname = 'kamo-lqip-sweep');
select cron.schedule('kamo-lqip-sweep', '*/5 * * * *', $cron$select public.sweep_lqip()$cron$);

-- ── how to read it afterwards ───────────────────────────────────────────────────────────────
--   backlog:   select count(*) from hides
--              where lqip is not null and lqip_judged_at is null and is_public
--                and not blocked and expires_at > now();
--   verdicts:  select count(*) filter (where lqip_mean < 18 and lqip_spread < 10) as black,
--                     count(*) filter (where lqip_mean is null) as undecodable,
--                     count(*) as judged
--              from hides where lqip_judged_at is not null;
--   dispatch:  select * from ops_lqip_sweep order by ran_at desc limit 10;
--   answers:   select id, status_code, left(content, 300) from net._http_response
--              order by id desc limit 5;
--
-- REVERSIBLE IN ONE LINE, and it does not even need this file: raise the cut, or disarm it.
--   update ops_lqip_config set enabled = false;                -- stop measuring
--   -- and to serve the slabs again, put the predicate back to (h.conceal is null or ...)
--   --   alone in the seven functions, exactly as the do-block above found them.
