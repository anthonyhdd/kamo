/* ═══ THE FEED REFUSED EVERY REPLY, AND THE REASON DID NOT APPLY TO THEM ═══════════════════
 *
 * "Send one back" stamps the new hide `source = 'rehide'`. Every feed_page overload carried
 *
 *     and (h.source is null or h.source not in ('rehide', 'library_nocam'))
 *
 * so a reply could never be served, no matter what its author asked for. Measured over the
 * 14 days to 2026-08-28, on `source is not null` (the DOM suites publish to prod):
 *
 *   1087 replies. 855 of the 1029 rehide ones were is_public — their authors ASKED for the
 *   feed. 644 were never played by anybody: ~46 a day, each one a person who answered
 *   somebody and reached no one.
 *
 * THE CONTROL GROUP IS AN ACCIDENT AND IT IS THE WHOLE PROOF. 58 replies were built through
 * the photo library instead of the button, so they carry `source = 'library'`, which the
 * filter does not name. Same object, same intent, same single addressee — only the label
 * differs:
 *
 *   reply, source='rehide'   (excluded)   1029 rows   37.4% ever played   1.44 attempts
 *   reply, source='library'  (served)       58 rows   93.1% ever played   3.57 attempts
 *   ordinary public hide     (served)     8687 rows   96.7% ever played   4.47 attempts
 *
 * n=58 is small: read the direction, not the second digit.
 *
 * ⚠️ THE FILTER ITSELF IS RIGHT — it exists so a re-hide cannot put the same photograph in
 * the feed twice, and CLAUDE.md records 323 img_path values shared exactly that way. It does
 * not apply to replies: of 1087 replies, ZERO reuse the parent's img_path. Not one. A reply
 * is a new photograph taken by somebody else in their own room; `rehide` names the BUTTON
 * that was pressed, and the filter was reading the button as if it named the content.
 *
 * So the clause gains one disjunct — `or h.reply_to is not null` — and nothing else moves.
 * `h.is_public` is still required, so the 174 replies whose authors did not ask for the feed
 * stay out of it: this exposes nothing that was not already volunteered.
 *
 * ⚠️ WHAT TO WATCH. feed_page orders by `least(n_attempts, 3)` ASCENDING — fewest plays
 * first — and a reply arrives with none, so these land HIGH by construction. That is the
 * point, and it is also the risk: ~46/day enter a feed taking ~230-450 hides/day. If the
 * feed starts reading as all replies, the fix is a cap in the ORDER BY, not a revert.
 *
 * ALL SIX OVERLOADS, on the doctrine in CLAUDE.md: this file deploys on push and the database
 * does not, so during a deploy a page loaded a minute ago is still calling an older
 * signature. Bodies are replaced, signatures are untouched — nothing is dropped, no row type
 * changes, and no page version is left serving the old behaviour.
 *
 * ROLLBACK: re-run this file with `or h.reply_to is not null` deleted from all seven bodies.
 * No data is written, so a revert is complete and instant.
 * ═════════════════════════════════════════════════════════════════════════════════════════ */

/* ── 1/6 — (p_before, p_limit, p_seed, p_offset, p_block) · author_key, coverage >= 30 ───── */
create or replace function public.feed_page(
  p_before timestamp with time zone, p_limit integer, p_seed text, p_offset integer, p_block text[])
returns table(id text, img_path text, name text, n_attempts integer, n_found integer,
              created_at timestamp with time zone)
language sql stable security definer set search_path to 'public'
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
    and (h.source is null or h.source not in ('rehide', 'library_nocam') or h.reply_to is not null)
    and (p_before is null or h.created_at < p_before)
    and (p_block is null or h.author_key is null or not (h.author_key = any(p_block)))
  order by (case when h.n_attempts >= 4 and h.n_found = 0 then 1 else 0 end),
    least(h.n_attempts, 3), md5(h.id || coalesce(p_seed, ''))
  offset greatest(coalesce(p_offset, 0), 0)
  limit least(greatest(coalesce(p_limit, 8), 1), 30);
$function$;

/* ── 2/6 — (p_before, p_limit) · the first page, index.html:17450 ───────────────────────── */
create or replace function public.feed_page(
  p_before timestamp with time zone default null, p_limit integer default 8)
returns table(id text, img_path text, name text, n_attempts integer, n_found integer,
              created_at timestamp with time zone, lqip text)
language sql stable security definer set search_path to 'public'
as $function$
  select h.id, h.img_path, h.name, h.n_attempts, h.n_found, h.created_at, h.lqip
  from hides h
  where h.is_public and not h.blocked and h.n_reported = 0
    and h.expires_at > now() and h.img_path is not null and h.img_path <> ''
    and coalesce(h.coverage, 100) >= 70
    and (h.source is null or h.source not in ('rehide', 'library_nocam') or h.reply_to is not null)
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

/* ── 3/6 — (p_limit, p_block_tags, p_seen) · fallback, index.html:18517 ─────────────────── */
create or replace function public.feed_page(
  p_limit integer, p_block_tags text[], p_seen text[])
returns table(id text, img_path text, name text, n_attempts integer, n_found integer,
              created_at timestamp with time zone, lqip text)
language sql stable security definer set search_path to 'public'
as $function$
  select h.id, h.img_path, h.name, h.n_attempts, h.n_found, h.created_at, h.lqip
  from hides h
  where h.is_public and not h.blocked and h.n_reported = 0
    and h.expires_at > now() and h.img_path is not null and h.img_path <> ''
    and coalesce(h.coverage, 100) >= 70
    and (h.source is null or h.source not in ('rehide', 'library_nocam') or h.reply_to is not null)
    and not (h.id = any((coalesce(p_seen, '{}'::text[]))[1:300]))
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
    h.id
  limit least(greatest(coalesce(p_limit, 8), 1), 30);
$function$;

/* ── 4/6 — (p_before, p_limit, p_block_tags) · fallback, index.html:18528 ───────────────── */
create or replace function public.feed_page(
  p_before timestamp with time zone, p_limit integer, p_block_tags text[])
returns table(id text, img_path text, name text, n_attempts integer, n_found integer,
              created_at timestamp with time zone, lqip text)
language sql stable security definer set search_path to 'public'
as $function$
  select h.id, h.img_path, h.name, h.n_attempts, h.n_found, h.created_at, h.lqip
  from hides h
  where h.is_public and not h.blocked and h.n_reported = 0
    and h.expires_at > now() and h.img_path is not null and h.img_path <> ''
    and coalesce(h.coverage, 100) >= 70
    and (h.source is null or h.source not in ('rehide', 'library_nocam') or h.reply_to is not null)
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

/* ── 5/6 — (p_limit, p_block_tags, p_seen, p_seed) · THE PRIMARY, index.html:18507 ──────── */
create or replace function public.feed_page(
  p_limit integer, p_block_tags text[], p_seen text[], p_seed text)
returns table(id text, img_path text, name text, n_attempts integer, n_found integer,
              created_at timestamp with time zone, lqip text)
language sql stable security definer set search_path to 'public'
as $function$
  select h.id, h.img_path, h.name, h.n_attempts, h.n_found, h.created_at, h.lqip
  from hides h
  where h.is_public and not h.blocked and h.n_reported = 0
    and h.expires_at > now() and h.img_path is not null and h.img_path <> ''
    and coalesce(h.coverage, 100) >= 70
    and (h.source is null or h.source not in ('rehide', 'library_nocam') or h.reply_to is not null)
    and not (h.id = any((coalesce(p_seen, '{}'::text[]))[1:300]))
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
    /* UTC is pinned rather than left to the session: date_trunc on a timestamptz reads the
       connection's TimeZone, and a bucket that moved with whoever was calling would reorder
       the feed for reasons no one could see. */
    date_trunc('day', h.created_at at time zone 'UTC') desc,
    md5(h.id || coalesce(p_seed, '')) asc,
    h.id
  limit least(greatest(coalesce(p_limit, 8), 1), 30);
$function$;

/* ── 6/6 — (p_before, p_limit, p_block_tags, p_offset) ──────────────────────────────────── */
create or replace function public.feed_page(
  p_before timestamp with time zone, p_limit integer, p_block_tags text[], p_offset integer)
returns table(id text, img_path text, name text, n_attempts integer, n_found integer,
              created_at timestamp with time zone, lqip text)
language sql stable security definer set search_path to 'public'
as $function$
  select h.id, h.img_path, h.name, h.n_attempts, h.n_found, h.created_at, h.lqip
  from hides h
  where h.is_public and not h.blocked and h.n_reported = 0
    and h.expires_at > now() and h.img_path is not null and h.img_path <> ''
    and coalesce(h.coverage, 100) >= 70
    and (h.source is null or h.source not in ('rehide', 'library_nocam') or h.reply_to is not null)
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
    h.id
  offset greatest(coalesce(p_offset, 0), 0)
  limit  least(greatest(coalesce(p_limit, 8), 1), 30);
$function$;

/* ── OPTIONAL — feed_best, the banger slot ──────────────────────────────────────────────────
   SEPARATE ON PURPOSE, AND SAFE TO SKIP. feed_best demands n_attempts >= 5 AND n_found > 0,
   which no reply meets today (they average 1.44 attempts) — precisely because they have never
   been served. It changes nothing on the day it is applied and only becomes reachable once
   the six above have given replies an audience. Drop this statement if you want the smallest
   possible change; the reply fix is complete without it. */
create or replace function public.feed_best(p_limit integer, p_block_tags text[])
returns table(id text, img_path text, name text, n_attempts integer, n_found integer,
              created_at timestamp with time zone, lqip text)
language sql stable security definer set search_path to 'public'
as $function$
  select h.id, h.img_path, h.name, h.n_attempts, h.n_found, h.created_at, h.lqip
  from hides h
  where h.is_public and not h.blocked and h.n_reported = 0
    and h.expires_at > now() and h.img_path is not null and h.img_path <> ''
    and coalesce(h.coverage, 100) >= 70
    and h.n_attempts >= 5
    and h.n_found > 0
    and (h.source is null or h.source <> 'rehide' or h.reply_to is not null)
    and (h.author_tag is null or not (h.author_tag = any(coalesce(p_block_tags, '{}'))))
    and (h.author_tag is null or not exists (select 1 from shadowed_authors s where s.tag = h.author_tag))
  order by ((select coalesce(sum(r.n), 0)::int from hide_reactions r where r.hide_id = h.id)
     + case when h.n_found * 4 >= h.n_attempts and h.n_found * 4 <= h.n_attempts * 3 then 3 else 0 end
     - case when h.n_found * 5 >= h.n_attempts * 4 then 3 else 0 end
     - least(coalesce(h.n_skipped, 0) / 3, 4)) desc,
    h.created_at desc
  limit least(greatest(coalesce(p_limit, 1), 1), 10);
$function$;


/* ═══ PROOF IT LANDED ══════════════════════════════════════════════════════════════════════
   BEFORE: eligible = 0. AFTER: the count of replies their authors already volunteered.
   Run it against the PRIMARY overload's own clauses, not from memory. */
-- select count(*) as replies_now_servable
-- from hides h
-- where h.reply_to is not null
--   and h.is_public and not h.blocked and h.n_reported = 0
--   and h.expires_at > now() and h.img_path is not null and h.img_path <> ''
--   and coalesce(h.coverage, 100) >= 70;

/* ═══ THE ONLY NUMBER THAT JUDGES THIS ═════════════════════════════════════════════════════
   Not feed volume, not impressions: the share of replies that ever get played. It sat at
   37.4% for source='rehide' against 93.1% for the 58 that slipped through. Re-run weekly and
   compare the two rows — the accident group is the built-in control, and it should stop being
   different. */
-- select
--   r.source,
--   count(*) as replies,
--   round(100.0*count(*) filter (where r.n_attempts > 0)/count(*),1) as pct_played,
--   round(avg(r.n_attempts)::numeric,2) as avg_attempts
-- from hides r
-- where r.reply_to is not null
--   and r.created_at >= now() - interval '7 days'
--   and r.source is not null
-- group by 1 order by 2 desc;
