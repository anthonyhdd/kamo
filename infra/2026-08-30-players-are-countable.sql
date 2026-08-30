-- 2026-08-30 — A PLAYER WHO NEVER PUBLISHES BECOMES COUNTABLE
--
-- Founder, 2026-08-30: "Rétention devrait juste être des active users non ? Pas besoin de
-- créer non ??". He is right, and until this migration the database could not answer him.
--
-- Retention was only ever measurable for people who had PUBLISHED. The author key is minted on
-- the first publish and nowhere else, so somebody who opens the app daily and plays twenty
-- rounds without ever making one was, to every query we can run, nobody. Measured the same day:
-- creator D1 for the 26→28/08 cohort was 13.2%, and "played OR published" was 19.9% — but that
-- second number still only covers people who had published at least once. Everyone else was
-- invisible by construction.
--
-- ⚠️ THE OBVIOUS FIX IS FORBIDDEN. Minting `k` on a play would stamp an author identity onto
-- every anonymous visitor who ever opened a share link, and `k` is the LEADERBOARD's entry
-- ticket — the board's population would silently become "everyone who ever tapped a link".
-- The seeker's own note in index.html says kfAuthorKeyRO() is read-only for exactly this.
-- So the play identity is SEPARATE, on its own column, read by no board and no creator.
--
-- ⚠️ AND NOTHING IS MINTED. chDeviceId() already exists, is already durable (localStorage +
-- cookie + IndexedDB since 2026-08-21) and already rides every analytics event. This writes the
-- identifier that is already on the device onto a row a query can group by.

alter table public.seek_traces add column if not exists device_key text;

create index if not exists seek_traces_device_day
  on public.seek_traces (device_key, created_at)
  where device_key is not null;

-- A NEW OVERLOAD, NEVER A CHANGED SIGNATURE. index.html deploys on push and this database does
-- not, so during a deploy both are live and a page loaded a minute ago calls the 2-argument
-- form. Same rule as create_hide's four overloads.
-- ⚠️ ORDER MATTERS AND IT IS THE OTHER DIRECTION THAT BITES: this migration must be applied
-- BEFORE index.html is pushed. A page calling a signature PostgREST does not have yet does not
-- degrade — PostgREST 404s and the trace is lost outright.
create or replace function public.save_seek_trace(p_id text, p_trace jsonb, p_device text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if p_trace is null or pg_column_size(p_trace) > 60000 then return; end if;
  if not exists (select 1 from hides where id = p_id and not blocked and expires_at > now()) then return; end if;
  if (select count(*) from seek_traces where hide_id = p_id) >= 200 then return; end if;
  -- left(...,64): the caller is anon and the value is unvalidated by construction.
  -- nullif(...,''): the client sends "" rather than the "w-nostore" sentinel when every store
  -- refused. That sentinel is SHARED by all such devices, so writing it through would collapse
  -- them into one row-group that plays all day and never churns — a fabricated super-retained
  -- user, inflating the exact number this column exists to measure.
  insert into seek_traces(hide_id, trace, device_key)
  values (p_id, p_trace, nullif(left(coalesce(p_device, ''), 64), ''));
end
$function$;

grant execute on function public.save_seek_trace(text, jsonb, text) to anon, authenticated;

-- ═══ AND A LEAK FOUND WHILE DOING IT, WHICH IS OLDER THAN THIS CHANGE ═══════════════════════
-- index.html's own note above sendTrace reads: "ANYTHING PUT HERE IS PUBLIC-ISH TELEMETRY ON A
-- ROW ANY CREATOR CAN REPLAY. Facts about the ROUND belong here; nothing about the person does."
-- That rule was already broken. `k` (author key) and `ho` (hint-wallet key, chUserId or
-- dev:deviceId) are both STABLE PER-PERSON identifiers, and get_seek_traces returned the whole
-- jsonb — so any creator replaying a hide received a key that follows a stranger across every
-- round they have ever played, on every hide, and could join them across their own hides.
--
-- Fixed on the READ side rather than by removing the fields, for two reasons: streak_board_v2
-- groups on `k` and counts hints on `ho`, so both must stay in the row; and stripping at read
-- time repairs EVERY ROW ALREADY WRITTEN, which removing the fields going forward would not.
-- Verified against the live client before shipping: it reads only s, a, end, src and who.
-- `who` stays — a handle somebody chose to display is the whole point of "@marie found you".
create or replace function public.get_seek_traces(p_id text)
returns table(created_at timestamp with time zone, why text, ms integer, trace jsonb)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select t.created_at,
         coalesce(t.trace->>'why', 'unknown') as why,
         nullif(t.trace->'end'->>'ms', '')::int as ms,
         (case when (t.trace->>'why') = 'hit'
               then (t.trace - 'end') || jsonb_build_object(
                      'a', coalesce((select jsonb_agg(x) from (
                             select x from jsonb_array_elements(coalesce(t.trace->'a','[]'::jsonb)) x
                             where coalesce((x->>'c')::int, 0) = 0     -- abandoned aims only
                           ) s), '[]'::jsonb))
               else t.trace
          end) - 'ho' - 'k' as trace
  from seek_traces t
  join hides h on h.id = t.hide_id
  where t.hide_id = p_id and not h.blocked and h.expires_at > now()
  order by t.created_at desc
  limit 10;
$function$;

-- ═══ PROVEN AGAINST THE LIVE DATABASE, NOT AGAINST THE DDL ══════════════════════════════════
-- A probe row was written through the 3-argument form carrying k='AUTHOR_KEY_SECRET' and
-- ho='dev:WALLET_SECRET', then read back through get_seek_traces and deleted:
--     device_key written .................. PROBE_DEVICE_123
--     k returned to the creator ........... (removed)
--     ho returned to the creator .......... (removed)
--     who returned to the creator ......... probe
--
-- ═══ WHAT THIS DOES NOT DO ══════════════════════════════════════════════════════════════════
-- It fills going forward only. The first D1 on real players is readable two days after the
-- push, and any cohort spanning the deploy is half-blind — a device seen for the first time on
-- day 1 may have been playing for a week.
--
-- ⚠️ AND ONE THING LEFT ALONE, DELIBERATELY. seek_traces carries RLS with ZERO policies while
-- `anon` holds every table grant on it — INSERT, SELECT, UPDATE, DELETE, TRUNCATE. RLS with no
-- policy is default-deny, so those grants are inert today and the table is reachable only
-- through the SECURITY DEFINER functions above. They are still one `alter table ... disable row
-- level security` away from handing the whole table to the internet. Not revoked here because
-- revoking a grant is not additive and this migration ships beside a page deploy; it wants its
-- own change, on its own day, with the app watched afterwards.
