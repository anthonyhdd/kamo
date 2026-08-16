-- ══ THE FEED'S CURSOR DOES NOT MATCH ITS OWN ORDER BY ═══════════════════════════════════════
--
-- ⚠️  NOT APPLIED YET. This file is the diagnosis and the proposed fix. The client-side half
--     shipped on 2026-08-16 (feed_dupe_blocked) and hides the symptom; this is the cause.
--
-- FOUNDER'S REPORT, 2026-08-16: "je tombe souvent sur des doublons à la suite."
--
-- Both live overloads of feed_page — (timestamptz, int) and (timestamptz, int, text[]) — sort by
--
--     order by least(h.n_attempts, 3) asc,
--              (<reactions + sweet-spot bonus - too-easy penalty - skip penalty>) desc,
--              h.created_at desc
--
-- and paginate with
--
--     and (p_before is null or h.created_at < p_before)
--
-- where the client sends `S.cursor = rows[rows.length-1].created_at` — the created_at of the
-- LAST ROW OF THE PAGE. That is only the oldest row of the page when the sort is chronological,
-- and this sort is not: the first key is least(n_attempts,3) and the second is a score. The last
-- row is simply the one that ranked lowest, and its created_at sits somewhere arbitrary in the
-- page's time range.
--
-- So the next page's filter `created_at < p_before` does two wrong things at once:
--
--   1. IT RE-SERVES. Every row of the previous page older than that arbitrary pivot passes the
--      filter again, and the ordering puts the highest-ranked of them straight back at the top.
--      Measured against this database while the diagnosis was written:
--
--          select count(*) from page2 where id in (select id from page1)  ->  2 of 8
--
--      The client cannot absorb these with kfSeen(), which is written by activate() and so only
--      knows the slides that were actually LOOKED at. A duplicate whose twin is still sitting
--      unviewed three slides below passes every guard — which is exactly why they arrive
--      "à la suite".
--
--   2. IT SKIPS. Everything with created_at >= the pivot is excluded from every subsequent page,
--      forever, however well it ranks. This is the half no client fix can repair: a hide the
--      query never returns cannot be de-duplicated back into existence. The feed is quietly
--      smaller than the corpus, and `rows.length < KF_PAGE` then latches S.done and ends it
--      early.
--
-- WHY OFFSET AND NOT A KEYSET. A keyset would have to carry all three sort keys, and two of them
-- are volatile: n_attempts moves every time somebody plays, and the score moves on every
-- reaction. A cursor built on values that change under the reader is a cursor that drifts.
-- The ordering is otherwise fully deterministic (no random()), so a plain OFFSET is correct
-- here, and it is what the ORIGINAL 5-argument overload already used before the rewrite dropped
-- it — see feed_page(timestamptz, int, text, int, text[]) with its p_seed/p_offset pair.
--
-- ADDED, NEVER EDITED, like every other rung: a page loaded before this migration keeps calling
-- the 2- and 3-argument forms and behaves exactly as it does today. The client climbs to the
-- widest form it knows and sends p_offset = the number of RAW rows it has already been served
-- (not the number of slides it kept — the filtering is the client's business, the window is the
-- server's).

create or replace function public.feed_page(
  p_before     timestamptz,
  p_limit      int,
  p_block_tags text[],
  p_offset     int
)
returns table(id text, img_path text, name text, n_attempts int, n_found int,
              created_at timestamptz, lqip text)
language sql stable security definer set search_path to 'public' as $function$
  select h.id, h.img_path, h.name, h.n_attempts, h.n_found, h.created_at, h.lqip
  from hides h
  where h.is_public and not h.blocked and h.n_reported = 0
    and h.expires_at > now() and h.img_path is not null and h.img_path <> ''
    and coalesce(h.coverage, 100) >= 70
    -- p_before is kept ONLY as a "feed opened at" epoch guard, so that hides published while
    -- somebody is mid-scroll cannot shift the window under them and re-introduce the very
    -- duplicates this migration removes. The client sends the time the FEED OPENED, once, and
    -- never advances it. It is no longer a cursor; p_offset is the cursor.
    and (p_before is null or h.created_at < p_before)
    and (h.author_tag is null or not (h.author_tag = any(coalesce(p_block_tags, '{}'))))
    and (h.author_tag is null or not exists (
          select 1 from shadowed_authors s where s.tag = h.author_tag))
  order by least(h.n_attempts, 3) asc,
    ((select coalesce(sum(r.n), 0)::int from hide_reactions r where r.hide_id = h.id)
     + case when h.n_attempts >= 3
            and h.n_found * 4 >= h.n_attempts
            and h.n_found * 4 <= h.n_attempts * 3 then 3 else 0 end
     - case when h.n_attempts >= 5
            and h.n_found * 5 >= h.n_attempts * 4 then 3 else 0 end
     - least(coalesce(h.n_skipped, 0) / 3, 4)) desc,
    h.created_at desc,
    h.id                                  -- total order: without it OFFSET can still straddle ties
  offset greatest(coalesce(p_offset, 0), 0)
  limit  least(greatest(coalesce(p_limit, 8), 1), 30);
$function$;

grant execute on function public.feed_page(timestamptz, int, text[], int) to anon, authenticated;

-- VERIFY AFTER APPLYING — page 2 must share nothing with page 1:
--
--   with p1 as (select * from feed_page(now(), 8, '{}', 0)),
--        p2 as (select * from feed_page(now(), 8, '{}', 8))
--   select (select count(*) from p2 where id in (select id from p1)) as must_be_zero;
--
-- and `feed_dupe_blocked` in Amplitude must fall to zero and stay there once the client is
-- sending p_offset.
