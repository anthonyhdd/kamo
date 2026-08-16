-- APPLIED 2026-08-16 to Supabase project qpztlobbnjyjbxqyuzgg.
--
-- THREE ADDITIONS, ONE PROBLEM: a round costs the seeker nothing.
--
-- Measured 2026-08-15 over three days: 55% of failed rounds end in under four seconds and
-- 28% in under two. That is not searching, it is a reflex tap on the way past. A wrong tap
-- has no price — no clock runs out, no score moves, nothing is lost — so the cheapest way
-- through a hide is to guess and swipe.
--
-- Everything downstream inherits that. `n_found / n_attempts` cannot describe how well a
-- photo was painted when most of its attempts were never really attempts, which is why no
-- creator-side ranking in this database means anything yet. The seeker has to have something
-- at stake before the creator can be scored.
--
--   1. n_skipped + log_skip()  — the feed's give-up, which has never been recorded at all
--   2. streak + a 13-arg create_hide — a challenge that carries the challenger's run
--   3. streak_board()          — the daily board, read from traces that already exist
--
-- Nothing here is destructive and nothing existing changes shape. Both columns take a
-- default, every function is new or replaced with its signature intact, and no function that
-- the live page already calls has its return type touched — a page loaded before this
-- migration behaves exactly as it did.

-- ══════════════════════════════════════════════════════════════════════════════════════
-- 1. THE GIVE-UP THAT LEAVES NO TRACE
--
-- There is no "I give up" button in the feed — deliberately, the swipe is the exit. So a
-- player who looks at a photo, finds nothing and scrolls on writes NOTHING: no attempt, no
-- trace, no row anywhere. `n_attempts` counts only the people who chose to fire.
--
-- That single fact explains the number that made no sense: feed rounds are found 59.2% of
-- the time in 3.6s average, link rounds 48.0% in 7.3s. The feed does not have easier hides
-- or better players — it only records the rounds somebody already felt sure about, and
-- silently discards every round where the camouflage actually worked.
--
-- So the one measurement that would say "this photo beat people" is the one the product has
-- never taken. This is it, and it is deliberately the cheapest possible shape: one counter on
-- the row, incremented by a function that returns nothing and can fail silently.
--
-- IT IS TELEMETRY, NOT A LEDGER, and the difference is the reason there is no per-device
-- guard here. There is no seeker identity on this path to key one against, inventing one
-- would mint a device id for every anonymous visitor (see the note on author_key in
-- index.html — that is a heavier thing than the counter is worth), and the counter feeds
-- nothing that anybody wins. Read it as an order of magnitude, never as a score, until
-- something is riding on it.
alter table public.hides add column if not exists n_skipped integer not null default 0;

create or replace function public.log_skip(p_id text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  -- Same three guards every write path here uses, and the same posture: a skip on a blocked,
  -- expired or missing hide is not an error the seeker should ever hear about.
  update hides set n_skipped = n_skipped + 1
   where id = p_id and not blocked and expires_at > now();
end
$function$;

grant execute on function public.log_skip(text) to anon, authenticated;

-- ══════════════════════════════════════════════════════════════════════════════════════
-- 2. THE CHALLENGE CARRIES A NUMBER
--
-- "Challenge back" (PR #262) delivers a reply by publishing it: the address is already on the
-- row, the original creator finds it through my_replies, and the server pushes it. What the
-- recipient gets is a round with nobody's name on the scoreboard — an answer with no stake.
--
-- This stamps the challenger's current run onto the reply, so the round arrives as "@X is on
-- four. Break it." rather than as another photo. It is the smallest thing that turns a reply
-- into a rally: one number, set at the moment the reply is made, never updated afterwards.
--
-- smallint and nullable on purpose. Nullable is the honest default for every row that already
-- exists and for every publish from a page loaded before this deploy; the reading side must
-- treat null as "no claim", never as zero.
alter table public.hides add column if not exists streak smallint;

-- WHY THIS IS A NEW OVERLOAD AND NOT AN EDIT — the same reason the 12-argument rung exists
-- (see 2026-08-13-client-hide-id.sql). The page and the database do not deploy together.
-- Editing the 12-argument signature would 404 every publish from a page loaded before this
-- migration; adding a 13th rung leaves every rung below it untouched and still climbed.
create or replace function public.create_hide(
  p_img_path text, p_cx real, p_cy real, p_r real, p_secs integer, p_coverage integer,
  p_limit_s integer, p_max_taps integer, p_name text, p_reply_to text, p_author_key text,
  p_id text, p_streak integer)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_id text; v_name text; v_parent text; v_round int := 1; v_key text; v_streak smallint;
begin
  -- Everything down to v_streak is the 12-argument body verbatim. Kept identical on purpose:
  -- this rung differs from the one under it in exactly one way, and a second difference
  -- introduced here would be invisible until the day the rungs disagree.
  v_id := lower(coalesce(p_id, ''));
  if v_id !~ '^[0-9a-f]{16}$' or exists (select 1 from hides h where h.id = v_id) then
    v_id := substr(replace(gen_random_uuid()::text, '-', ''), 1, 16);
  end if;
  v_name := nullif(regexp_replace(coalesce(p_name, ''), '[^A-Za-z0-9_.]', '', 'g'), '');
  v_key  := nullif(regexp_replace(coalesce(p_author_key, ''), '[^a-zA-Z0-9]', '', 'g'), '');
  select h.id, h.round + 1 into v_parent, v_round from hides h where h.id = p_reply_to;

  -- CLAMPED, BECAUSE IT ARRIVES FROM AN ANONYMOUS CLIENT over the public anon key and it is
  -- about to be printed in front of a stranger. Nothing here is worth a bounds bug: a run
  -- outside 1..999 is not a run, it is a typo or a tamper, and it becomes null — which the
  -- reading side already has to handle for every row published before today.
  v_streak := case when p_streak between 1 and 999 then p_streak::smallint else null end;

  insert into hides (id, img_path, cx, cy, r, secs, coverage, limit_s, max_taps, name,
                     reply_to, round, author_key, streak)
  values (v_id, p_img_path, p_cx, p_cy, p_r, p_secs, p_coverage, p_limit_s, p_max_taps,
          left(v_name, 16), v_parent, coalesce(v_round, 1), left(v_key, 40), v_streak);
  return v_id;
end
$function$;

grant execute on function public.create_hide(text, real, real, real, integer, integer,
  integer, integer, text, text, text, text, integer) to anon, authenticated;

-- ══════════════════════════════════════════════════════════════════════════════════════
-- 3. THE DAILY BOARD, BUILT FROM DATA THAT IS ALREADY BEING WRITTEN
--
-- No new table and no new write path: seek_traces has carried `who` (the handle) and `why`
-- (hit / miss / giveup) on every hunt since it shipped. 66% of hunts over the three days to
-- 08-15 were signed — 3 234 of 4 927, from 186 distinct seekers.
--
-- GROUPED ON `k`, NOT ON `who`, and that is not fussiness. Handles are minted from 24
-- adjectives × 24 animals = 576 combinations, against 169 seekers a day: 187 handles in this
-- database already belong to more than one device. A board keyed on the name would silently
-- merge strangers into one row and hand somebody else's run to whoever loaded it. `k` is the
-- author key, which the page now puts on the trace.
--
-- `k` IS NEVER RETURNED. index.html states the rule for the same value on feed_page: a stable
-- author id readable off a public surface lets anyone cluster every photo one device has
-- published. So the caller passes its own key and the server answers `me` — the client can
-- find its own row and learns nothing about anybody else's.
--
-- THE TIE-BREAK IS THE WHOLE FAIRNESS ARGUMENT. Longest-run is monotonic in rounds played: on
-- 2026-08-15 one seeker played 219 rounds against a median of 14, and with a bare `max(run)`
-- they win every day forever, which makes the board furniture rather than a race. Ranking
-- ties by FEWEST rounds means a careful player who goes 7-for-9 beats a grinder who needed 40
-- — no artificial cap to explain, no rounds silently not counting, and the sentence says
-- itself: "7 in a row, in 9 rounds".
--
-- ONE UTC DAY. Not a rolling window (a board whose contents shift under a countdown is not a
-- day), and not per-device local midnight (the row would have to mean a different span for
-- every reader, and nothing here knows the reader's timezone).
create or replace function public.streak_board(p_day date, p_me text, p_limit integer default 50)
returns table(rank integer, who text, streak integer, rounds integer, me boolean)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with t as (
    select nullif(tr.trace->>'k','') as k,
           nullif(tr.trace->>'who','') as who,
           (tr.trace->>'why') = 'hit' as hit,
           row_number() over (partition by nullif(tr.trace->>'k','')
                              order by tr.created_at, tr.id) as rn
      from seek_traces tr
     where tr.created_at >= p_day::timestamptz
       and tr.created_at <  (p_day + 1)::timestamptz
       and nullif(tr.trace->>'k','') is not null
       -- A trace with no verdict is a recorder that died mid-round, not a round.
       and tr.trace->>'why' in ('hit','miss','giveup')
       -- A REPLAY IS A GUARANTEED HIT: the player already knows where the figure is. It files
       -- no attempt, the page refuses to let it build a run, and it must not reach the board
       -- either — otherwise a creator rewatching their own hides walks to rank 1. Flagged
       -- `r:1` on the trace by chSeek.
       and coalesce((tr.trace->>'r')::int, 0) = 0
  ),
  -- Gaps and islands: consecutive hits share (rn - row_number() within hits).
  islands as (
    select k, hit, rn,
           rn - row_number() over (partition by k, hit order by rn) as grp
      from t
  ),
  runs as (
    select k, count(*)::int as len, max(rn) as ends_at
      from islands where hit group by k, grp
  ),
  best as (
    select distinct on (k) k, len, ends_at
      from runs order by k, len desc, ends_at asc
  ),
  tot as (
    -- The handle shown is the one carried by that day's LAST round: somebody who renames
    -- themselves mid-session should appear under the name they are using now.
    select k, count(*)::int as rounds,
           (array_agg(who order by rn desc) filter (where who is not null))[1] as who
      from t group by k
  ),
  joined as (
    select tot.k,
           coalesce(tot.who,'') as who,
           coalesce(best.len,0) as streak,
           tot.rounds,
           -- ROUNDS SPENT REACHING IT, not rounds played all day: the tie-break has to
           -- reward getting there quickly, and a player who keeps going after their best run
           -- must not be pushed down the board for still being here.
           coalesce(best.ends_at, tot.rounds)::int as spent
      from tot left join best on best.k = tot.k
  )
  select (row_number() over (order by j.streak desc, j.spent asc, j.who asc))::int as rank,
         j.who,
         j.streak,
         j.rounds,
         (j.k = nullif(p_me,'')) as me
    from joined j
   where j.streak > 0            -- a board of zeroes is a list of people who lost
   order by j.streak desc, j.spent asc, j.who asc
   limit greatest(1, least(coalesce(p_limit, 50), 200));
$function$;

grant execute on function public.streak_board(date, text, integer) to anon, authenticated;

-- The board scans one day of traces on every open. Without this it is a full scan of a table
-- that grows by ~5 000 rows a day and is also the replay store.
create index if not exists seek_traces_created_at_idx on public.seek_traces (created_at);
