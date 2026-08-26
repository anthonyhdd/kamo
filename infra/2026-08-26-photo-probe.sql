-- ═══ THE HIDE THAT EXISTS AND HAS NO PICTURE BEHIND IT ══════════════════════════════════════
--
-- 2026-08-21, 05:54 → 21:12 UTC. `x-upsert:"true"` was added to chPrepare's POST so a re-freeze
-- could overwrite the object it supersedes. The anon role has exactly one policy on
-- storage.objects — INSERT — and an upsert needs UPDATE as well, so Postgres refused the row
-- before it ever looked at whether the object was there. Every upload in the app, refused, for
-- FIFTEEN HOURS. 376 of that day's 712 real hides were written with nothing behind them.
--
-- Nothing caught it, and nothing that already exists could have. scripts/check.mjs runs before
-- a push and this was a runtime condition that only exists once the anon key meets the live
-- bucket. A DOM assertion could not see it either: the ROW IS WRITTEN BEFORE THE BYTES ARE, so
-- the publish path reported success, the sheet offered a send, and the hide went out empty. The
-- only place the truth exists is the join between `hides` and `storage.objects`, and nobody was
-- looking at it. So this is the thing that looks at it, every fifteen minutes.
--
-- ── WHY `source is not null` IS THE MOST IMPORTANT LINE IN HERE ─────────────────────────────
--
-- The DOM suites in scripts/ publish against the LIVE database — chRpc is not stubbed in most
-- of them, only the storage POST is — so every check.mjs run leaves a burst of genuinely
-- photoless rows behind it. A dozen at a time, each from a fresh browser context and therefore
-- a fresh author_key, so counting authors instead of hides does not separate them either.
--
-- What DOES separate them is that harness traffic never goes through a photo door. A real
-- client stamps camera / library / library_cam / library_nocam / rehide; the harness stamps
-- nothing. Measured 08-17 → 08-26, and the two populations are not close:
--
--     source is not null    0.09% · 0.14% · 0.19% · 0.47% · [52.81% on 08-21] · 1.77% · 0.34%
--                           · 0.22% · 0.70% · 0.61%
--     source is null        23-66% photoless EVERY single day — all of it the harness
--
-- Without that line the floor is 2-6% and the threshold has to sit at 35% to stay quiet.
-- With it the floor is under 1%, and 5% is still seven times the worst normal day. Proven
-- live while this was being written: one window read 26 hides / 13 photoless / 50% unfiltered
-- and 13 hides / 0 photoless / 0.0% filtered, in the same second.
--
-- ── WHY THE OTHER NUMBERS ARE THE NUMBERS ───────────────────────────────────────────────────
--
-- Backtested over 08-17 → 08-26, every hour, two-hour windows, source-filtered. At
-- (>=20 hides, >=5 photoless, >=5%) it fires on two days in ten and nothing else:
--
--     08-21   17 windows, 05:00Z → 21:00Z    the outage, front to back
--     08-22    2 windows, 17:00Z → 18:00Z    the tail, 12 photoless on 677
--
-- The first breaching window closes at 07:00Z — the bug landed at 05:54Z. One hour six, against
-- the fifteen hours twelve it actually ran. The 3 h cooldown collapses each of those runs into
-- one message rather than seventeen.
--
-- THE FIVE-MINUTE LAG IS NOT DECORATION. The row lands before the object, so a hide created a
-- second ago is legitimately photoless. Measured over three days: p50 0s, p95 7s, p99 15s,
-- max 64s between a row and its object. Five minutes is twenty times the worst observed case;
-- without it this probe reports an outage every time it runs.

begin;

-- ── the measurements, one row per run ───────────────────────────────────────────────────────
create table if not exists public.ops_photo_probe (
  id          bigserial primary key,
  ran_at      timestamptz not null default now(),
  win_start   timestamptz not null,
  win_end     timestamptz not null,
  hides       integer     not null,
  photoless   integer     not null,
  pct         numeric(5,1),
  breached    boolean     not null default false,
  alerted     boolean     not null default false,
  alert_error text
);
create index if not exists ops_photo_probe_ran_at_idx on public.ops_photo_probe (ran_at desc);

-- RLS ON AND NOT ONE POLICY, deliberately. anon and authenticated must never read or write
-- this: it is operational data about the whole base, and the standing rule about the anon role
-- in this project is that it gets INSERT on what it creates and nothing else, ever. postgres
-- and service_role bypass RLS, which is exactly who should see it.
alter table public.ops_photo_probe enable row level security;
revoke all on public.ops_photo_probe from anon, authenticated;

-- ── the dial, so tuning is a one-line UPDATE and not a migration ────────────────────────────
-- `enabled=false` is the kill switch and it is the FIRST thing the function reads. A probe that
-- cannot be silenced from a phone at 3am is a probe that gets dropped from cron and forgotten.
create table if not exists public.ops_photo_probe_config (
  only_row       boolean primary key default true check (only_row),
  enabled        boolean not null default true,
  lag_minutes    integer not null default 5,
  window_hours   integer not null default 2,
  min_hides      integer not null default 20,
  min_photoless  integer not null default 5,
  pct_threshold  numeric not null default 5,
  cooldown_hours integer not null default 3,
  webhook_url    text    not null default ''
);
alter table public.ops_photo_probe_config enable row level security;
revoke all on public.ops_photo_probe_config from anon, authenticated;
insert into public.ops_photo_probe_config (only_row) values (true) on conflict do nothing;

-- ── the probe ───────────────────────────────────────────────────────────────────────────────
create or replace function public.probe_photo_health()
returns public.ops_photo_probe
language plpgsql
security definer
set search_path = public, storage, extensions
as $$
declare
  c public.ops_photo_probe_config;
  r public.ops_photo_probe;
  v_start timestamptz; v_end timestamptz;
  v_hides integer; v_less integer; v_pct numeric;
  v_breach boolean; v_recent boolean; v_send boolean := false;
  v_err text := null;
  v_msg text;
begin
  select * into c from public.ops_photo_probe_config;
  if c is null or not c.enabled then return null; end if;

  v_end   := now() - make_interval(mins => c.lag_minutes);
  v_start := v_end - make_interval(hours => c.window_hours);

  -- The join is the whole point: `hides` alone says a hide exists, `storage.objects` alone says
  -- a picture exists, and only the two together say whether the hide HAS one.
  -- `source is not null` excludes the harness — see the note at the top, it is load-bearing.
  select count(*),
         count(*) filter (
           where not exists (select 1 from storage.objects o
                             where o.bucket_id = 'hides' and o.name = h.img_path))
    into v_hides, v_less
    from public.hides h
   where h.created_at >= v_start and h.created_at < v_end
     and h.source is not null;

  v_pct := case when v_hides > 0 then round(100.0 * v_less / v_hides, 1) else null end;
  v_breach := v_hides >= c.min_hides
          and v_less  >= c.min_photoless
          and coalesce(v_pct, 0) >= c.pct_threshold;

  -- ONE ALERT PER INCIDENT, NOT ONE PER RUN. 08-21 would have breached seventeen windows in a
  -- row; seventeen identical messages is how a channel gets muted, and a muted channel is worse
  -- than no channel because it still looks like coverage.
  select exists (select 1 from public.ops_photo_probe p
                  where p.alerted and p.ran_at > now() - make_interval(hours => c.cooldown_hours))
    into v_recent;
  v_send := v_breach and not v_recent;

  if v_send then
    v_msg := format('KAMO · %s%% of hides have no photo behind them (%s of %s, %s → %s UTC). '
                    || 'Normal is under 1%%. Last time this happened the anon role had lost its '
                    || 'upload path and it ran for 15 hours.',
                    v_pct, v_less, v_hides,
                    to_char(v_start at time zone 'UTC','MM-DD HH24:MI'),
                    to_char(v_end   at time zone 'UTC','HH24:MI'));
    -- THE MEASUREMENT MUST SURVIVE THE MESSENGER. A webhook that 404s, a full pg_net queue, a
    -- typo in the URL — none of those may cost us the row recording what was actually seen,
    -- because the row is what this probe is FOR. Hence the sub-block and alert_error.
    begin
      if c.webhook_url <> '' then
        perform net.http_post(
          url     := c.webhook_url,
          headers := jsonb_build_object('Content-Type','application/json'),
          body    := jsonb_build_object(
                       'content', v_msg,            -- Discord renders this key; others read below
                       'probe',     'photo_health',
                       'pct',       v_pct,
                       'photoless', v_less,
                       'hides',     v_hides,
                       'win_start', v_start,
                       'win_end',   v_end));
      else
        -- No channel wired yet: still be loud where Postgres logs are read. A WARNING lands in
        -- the Supabase log explorer and is greppable; the row below is the durable record.
        raise warning '%', v_msg;
      end if;
    exception when others then
      v_err := left(SQLERRM, 300);
      v_send := false;
    end;
  end if;

  insert into public.ops_photo_probe (win_start, win_end, hides, photoless, pct, breached, alerted, alert_error)
  values (v_start, v_end, v_hides, v_less, v_pct, v_breach, v_send, v_err)
  returning * into r;
  return r;
end $$;

revoke all on function public.probe_photo_health() from public, anon, authenticated;

-- ── every fifteen minutes ───────────────────────────────────────────────────────────────────
-- Fifteen and not sixty: the two-hour window already smooths the number, so the period controls
-- only how long an outage runs before anyone hears about it. `hides` is 19k rows / 30 MB and
-- there is no plain created_at index — a seq scan of that four times an hour is nothing, and
-- adding an index would take a write lock on the hot publish path to save nothing.
select cron.unschedule('kamo-photo-probe') where exists (select 1 from cron.job where jobname = 'kamo-photo-probe');
select cron.schedule('kamo-photo-probe', '*/15 * * * *', $c$select public.probe_photo_health()$c$);

commit;

-- ── PROVEN IN BOTH DIRECTIONS BEFORE BEING TRUSTED ──────────────────────────────────────────
-- Green, live traffic:                    13 hides,  0 photoless,  0.0%, breached=false
-- Red, by rewinding the window onto the
-- real outage (lag_minutes := 7500) —
-- real data, not a fudged threshold:      51 hides, 48 photoless, 94.1%, breached=true,
--                                         alerted=true, alert_error=null
-- The config was restored to lag_minutes=5 and both test rows deleted afterwards, because the
-- red one carried alerted=true and would have suppressed a real alert for three hours.
--
-- ── ARMING THE CHANNEL ──────────────────────────────────────────────────────────────────────
-- Until this is set the probe records and raises a WARNING into the Postgres log, which nobody
-- reads at 06:00 on a Friday. A Discord webhook works as-is — `content` is what Discord renders.
--
--   update public.ops_photo_probe_config set webhook_url = 'https://discord.com/api/webhooks/…';
--
-- Kill switch:  update public.ops_photo_probe_config set enabled = false;
-- Last 24 h:    select ran_at, hides, photoless, pct, breached, alerted
--                 from public.ops_photo_probe where ran_at > now() - interval '24 hours'
--                order by ran_at desc;
