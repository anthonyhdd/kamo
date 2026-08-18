-- APPLIED 2026-08-18 to Supabase project qpztlobbnjyjbxqyuzgg (migration
-- `feed_drop_rehide_demote_unsolved`).
--
-- THE FEED STOPS SERVING THE TWO THINGS NOBODY CAN FIND. No column, no policy on what may be
-- published — only what the public feed hands to a stranger's thumb.
--
-- ══════════════════════════════════════════════════════════════════════════════════════
-- WHY THIS EXISTS
--
-- "Les images sur le feed sont trop difficiles a trouver", 2026-08-18. The question that came
-- with it was whether to remove the library picker — and `hides.source`, added on 08-16 for
-- exactly this argument, says no. Public hides with at least one attempt, 08-16 → 08-18:
--
--   source     hides   ever found   find rate/attempt   skips
--   camera     2342    88.0%        65.5%               21.8%
--   (null)     1080    84.0%        53.3%               25.5%
--   library    1066    78.0%        50.7%               25.6%
--   rehide      281    66.5%        33.6%               17.6%
--
-- Uploads are WORSE, not broken — 78% against 88% — and they are 21.5% of the day's hides on a
-- feed that already runs dry under the thumb (see drop() → dry() in index.html). Closing that
-- door costs a fifth of the supply to move ten points on one cohort.
--
-- `rehide` is the actual floor: 33.6% find rate, a third of its hides never found, 22% of the
-- ones that got four attempts still unsolved — for 5.8% of the volume. And it is mechanical
-- rather than accidental: chRehide() re-uses the answered hide's own photograph, so the second
-- kamo is painted into a picture that already holds one. Every round in a chain is harder than
-- the one before it, by construction.
--
-- Two changes, both here, none in `index.html`:
--
--   1. A REHIDE NO LONGER REACHES THE PUBLIC FEED. It keeps everything else — "send one back"
--      is a REPLY, it travels on hides.reply_to to one named person and through my_replies()
--      on their next launch. That path is untouched. This only stops a chain link from being
--      handed to a stranger who has never seen the photograph it is built on.
--
--   2. AN UNSOLVED HIDE SORTS LAST INSTEAD OF FIRST. `least(n_attempts,3) asc` gives every new
--      hide its first three plays before ranking begins — which is right, and which also means
--      a hide that four people have failed to solve sits in the same bucket as every other
--      mature row and keeps its turn. It is demoted, NOT filtered: it stays reachable at the
--      tail, the author is not silenced, and a hide that is merely hard rather than impossible
--      climbs back the moment somebody finds it.
--
-- WHY NULL IS NOT A REHIDE. `source` is nullable forever (see 2026-08-16-hide-source.sql):
-- every hide published before that deploy, and every publish from a page loaded before it,
-- carries none. Null means "not recorded" — the clause is `source is null or source <> 'rehide'`
-- so that a page that never learned to send the column publishes into the feed exactly as it
-- does today. Reading null as camera, or as rehide, would both be inventions.
--
-- ALL FIVE OVERLOADS, and that is the point. `feed_page` has five live signatures because this
-- file deploys on push and the database does not — a page loaded a minute ago calls the older
-- one, and index.html's own fallback ladder (feed_page_seen_unavailable) climbs down two rungs
-- on purpose. Fixing only the newest would leave a stale page serving the rehides this
-- migration exists to remove. Row types are untouched, so CREATE OR REPLACE is enough; nothing
-- here needs the drop-and-recreate that get_hide required.
--
-- WHAT TO WATCH. The share of feed rounds ending in a give-up, and n_skipped per served hide.
-- If the feed thins out instead (5.8% of supply is small, but the tail is where dry() lives),
-- the cheap retreat is to demote rehides the same way as unsolved ones rather than exclude
-- them — one clause, same file, no client change.

-- ══════════════════════════════════════════════════════════════════════════════════════
-- 1. THE LIVE PATH. kfRpc("feed_page",{p_limit,p_block_tags,p_seen}) — the exclusion overload.
create or replace function public.feed_page(p_limit integer, p_block_tags text[], p_seen text[])
 returns table(id text, img_path text, name text, n_attempts integer, n_found integer, created_at timestamp with time zone, lqip text)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select h.id, h.img_path, h.name, h.n_attempts, h.n_found, h.created_at, h.lqip
  from hides h
  where h.is_public and not h.blocked and h.n_reported = 0
    and h.expires_at > now() and h.img_path is not null and h.img_path <> ''
    and coalesce(h.coverage, 100) >= 70
    -- A chain link is a reply, not a feed post. Null is "not recorded", never "rehide".
    and (h.source is null or h.source <> 'rehide')
    -- Bounded server-side as well as client-side: this is an anonymous client and an unbounded
    -- array here is an unbounded scan. 300 is well past any real session.
    and not (h.id = any((coalesce(p_seen, '{}'::text[]))[1:300]))
    and (h.author_tag is null or not (h.author_tag = any(coalesce(p_block_tags, '{}'))))
    and (h.author_tag is null or not exists (
          select 1 from shadowed_authors s where s.tag = h.author_tag))
  -- FOUR PEOPLE TRIED AND NOBODY FOUND IT → the tail, ahead of the fresh-hide rule rather than
  -- inside the score, so no amount of reactions can lift an unsolvable photograph back up.
  order by (case when h.n_attempts >= 4 and h.n_found = 0 then 1 else 0 end) asc,
    least(h.n_attempts, 3) asc,
    ((select coalesce(sum(r.n), 0)::int from hide_reactions r where r.hide_id = h.id)
     + case when h.n_attempts >= 3
            and h.n_found * 4 >= h.n_attempts
            and h.n_found * 4 <= h.n_attempts * 3 then 3 else 0 end
     - case when h.n_attempts >= 5
            and h.n_found * 5 >= h.n_attempts * 4 then 3 else 0 end
     - least(coalesce(h.n_skipped, 0) / 3, 4)) desc,
    h.created_at desc,
    h.id
  limit least(greatest(coalesce(p_limit, 8), 1), 30);
$function$;

-- 2. THE CURSOR OVERLOAD.
create or replace function public.feed_page(p_before timestamp with time zone, p_limit integer, p_block_tags text[], p_offset integer)
 returns table(id text, img_path text, name text, n_attempts integer, n_found integer, created_at timestamp with time zone, lqip text)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select h.id, h.img_path, h.name, h.n_attempts, h.n_found, h.created_at, h.lqip
  from hides h
  where h.is_public and not h.blocked and h.n_reported = 0
    and h.expires_at > now() and h.img_path is not null and h.img_path <> ''
    and coalesce(h.coverage, 100) >= 70
    and (h.source is null or h.source <> 'rehide')
    -- p_before is now only a "feed opened at" epoch guard: the client sends the time the feed
    -- opened, once, and never advances it, so hides published mid-scroll cannot shift the
    -- window under the reader and re-introduce the duplicates this removes. p_offset is the cursor.
    and (p_before is null or h.created_at < p_before)
    and (h.author_tag is null or not (h.author_tag = any(coalesce(p_block_tags, '{}'))))
    and (h.author_tag is null or not exists (
          select 1 from shadowed_authors s where s.tag = h.author_tag))
  order by (case when h.n_attempts >= 4 and h.n_found = 0 then 1 else 0 end) asc,
    least(h.n_attempts, 3) asc,
    ((select coalesce(sum(r.n), 0)::int from hide_reactions r where r.hide_id = h.id)
     + case when h.n_attempts >= 3
            and h.n_found * 4 >= h.n_attempts
            and h.n_found * 4 <= h.n_attempts * 3 then 3 else 0 end
     - case when h.n_attempts >= 5
            and h.n_found * 5 >= h.n_attempts * 4 then 3 else 0 end
     - least(coalesce(h.n_skipped, 0) / 3, 4)) desc,
    h.created_at desc,
    h.id                              -- total order: without it OFFSET can straddle ties
  offset greatest(coalesce(p_offset, 0), 0)
  limit  least(greatest(coalesce(p_limit, 8), 1), 30);
$function$;

-- 3. THE BLOCK-LIST FALLBACK — first rung of index.html's climb down.
create or replace function public.feed_page(p_before timestamp with time zone, p_limit integer, p_block_tags text[])
 returns table(id text, img_path text, name text, n_attempts integer, n_found integer, created_at timestamp with time zone, lqip text)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select h.id, h.img_path, h.name, h.n_attempts, h.n_found, h.created_at, h.lqip
  from hides h
  where h.is_public and not h.blocked and h.n_reported = 0
    and h.expires_at > now() and h.img_path is not null and h.img_path <> ''
    and coalesce(h.coverage, 100) >= 70
    and (h.source is null or h.source <> 'rehide')
    and (p_before is null or h.created_at < p_before)
    and (h.author_tag is null or not (h.author_tag = any(coalesce(p_block_tags, '{}'))))
    and (h.author_tag is null or not exists (select 1 from shadowed_authors s where s.tag = h.author_tag))
  order by (case when h.n_attempts >= 4 and h.n_found = 0 then 1 else 0 end) asc,
    least(h.n_attempts, 3) asc,
    ((select coalesce(sum(r.n), 0)::int from hide_reactions r where r.hide_id = h.id)
     + case when h.n_attempts >= 3
            and h.n_found * 4 >= h.n_attempts
            and h.n_found * 4 <= h.n_attempts * 3 then 3 else 0 end
     - case when h.n_attempts >= 5
            and h.n_found * 5 >= h.n_attempts * 4 then 3 else 0 end
     - least(coalesce(h.n_skipped, 0) / 3, 4)) desc,
    h.created_at desc
  limit least(greatest(coalesce(p_limit, 8), 1), 30);
$function$;

-- 4. THE TWO-ARGUMENT FALLBACK — the call this feed has always made, and the one kfSeedBest's
--    neighbour at line 14806 still makes on the cold path.
create or replace function public.feed_page(p_before timestamp with time zone default null::timestamp with time zone, p_limit integer default 8)
 returns table(id text, img_path text, name text, n_attempts integer, n_found integer, created_at timestamp with time zone, lqip text)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select h.id, h.img_path, h.name, h.n_attempts, h.n_found, h.created_at, h.lqip
  from hides h
  where h.is_public and not h.blocked and h.n_reported = 0
    and h.expires_at > now() and h.img_path is not null and h.img_path <> ''
    and coalesce(h.coverage, 100) >= 70
    and (h.source is null or h.source <> 'rehide')
    and (p_before is null or h.created_at < p_before)
    and (h.author_tag is null or not exists (select 1 from shadowed_authors s where s.tag = h.author_tag))
  order by (case when h.n_attempts >= 4 and h.n_found = 0 then 1 else 0 end) asc,
    least(h.n_attempts, 3) asc,
    ((select coalesce(sum(r.n), 0)::int from hide_reactions r where r.hide_id = h.id)
     + case when h.n_attempts >= 3
            and h.n_found * 4 >= h.n_attempts
            and h.n_found * 4 <= h.n_attempts * 3 then 3 else 0 end
     - case when h.n_attempts >= 5
            and h.n_found * 5 >= h.n_attempts * 4 then 3 else 0 end
     - least(coalesce(h.n_skipped, 0) / 3, 4)) desc,
    h.created_at desc
  limit least(greatest(coalesce(p_limit, 8), 1), 30);
$function$;

-- 5. THE SEEDED OVERLOAD — the oldest one, no lqip, coverage floor 30. Kept in step for the
--    same reason as the rest: an old page is a live page.
create or replace function public.feed_page(p_before timestamp with time zone, p_limit integer, p_seed text, p_offset integer, p_block text[])
 returns table(id text, img_path text, name text, n_attempts integer, n_found integer, created_at timestamp with time zone)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select h.id, h.img_path, h.name, h.n_attempts, h.n_found, h.created_at
  from hides h
  where h.is_public
    and not h.blocked
    and h.n_reported = 0
    and h.expires_at > now()
    and h.img_path is not null
    and h.img_path <> ''
    and coalesce(h.coverage, 100) >= 30
    and (h.source is null or h.source <> 'rehide')
    and (p_before is null or h.created_at < p_before)
    and (p_block is null or h.author_key is null or not (h.author_key = any(p_block)))
  order by (case when h.n_attempts >= 4 and h.n_found = 0 then 1 else 0 end),
    least(h.n_attempts, 3), md5(h.id || coalesce(p_seed, ''))
  offset greatest(coalesce(p_offset, 0), 0)
  limit least(greatest(coalesce(p_limit, 8), 1), 30);
$function$;

-- ══════════════════════════════════════════════════════════════════════════════════════
-- 6. THE BANGER SLOT. feed_best seeds slide 3 with a PROVEN hide, and it asked for five
--    attempts without ever asking that any of them succeeded — so a photograph eight people
--    failed on qualified as a banger. `n_found > 0` is the whole claim the slot makes.
create or replace function public.feed_best(p_limit integer, p_block_tags text[])
 returns table(id text, img_path text, name text, n_attempts integer, n_found integer, created_at timestamp with time zone, lqip text)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select h.id, h.img_path, h.name, h.n_attempts, h.n_found, h.created_at, h.lqip
  from hides h
  where h.is_public and not h.blocked and h.n_reported = 0
    and h.expires_at > now() and h.img_path is not null and h.img_path <> ''
    and coalesce(h.coverage, 100) >= 70
    and h.n_attempts >= 5
    and h.n_found > 0
    and (h.source is null or h.source <> 'rehide')
    and (h.author_tag is null or not (h.author_tag = any(coalesce(p_block_tags, '{}'))))
    and (h.author_tag is null or not exists (select 1 from shadowed_authors s where s.tag = h.author_tag))
  order by ((select coalesce(sum(r.n), 0)::int from hide_reactions r where r.hide_id = h.id)
     + case when h.n_found * 4 >= h.n_attempts and h.n_found * 4 <= h.n_attempts * 3 then 3 else 0 end
     - case when h.n_found * 5 >= h.n_attempts * 4 then 3 else 0 end
     - least(coalesce(h.n_skipped, 0) / 3, 4)) desc,
    h.created_at desc
  limit least(greatest(coalesce(p_limit, 1), 1), 10);
$function$;
