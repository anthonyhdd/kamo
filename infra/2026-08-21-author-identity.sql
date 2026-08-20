-- 2026-08-21 — THE IDENTITY A LEADERBOARD CAN BE KEYED ON.
--
-- Applied through the dashboard SQL editor and mirrored here, per CLAUDE.md: this directory
-- is the only record the database has of what changed and why.
--
-- WHY THIS EXISTS BEFORE THE BOARD DOES, AND NOT AFTER. A ranking has to group rows by a
-- person, and `hides.name` is not a person. Measured on 2026-08-21:
--
--   · 865 distinct names across ~3,800 devices in 14 days. The mint pool is 24 x 24 = 576
--     combinations and it is SATURATED: 576 of those names are carried by more than one
--     device, covering 3,613 of them. @MossyOtter is 16 different people, @PewterFox 15.
--     A board grouped on the name would MERGE them into one row.
--   · the name is denormalised onto every hide and renaming does not backfill. 282 authors
--     carry two names or more (up to five), across 1,739 hides. A board grouped on the name
--     would SPLIT each of them into several rows.
--
-- Both failures are invisible in a test fixture and obvious to the person reading the board
-- with their own name on it twice. `author_key` has neither: it is minted once per device by
-- the publish path and never refreshed (see kfAuthorKey's note in index.html), and it is on
-- 12,678 of the 12,695 hides made in the last seven days — 99.9%.
--
-- SO THE RULE IS: GROUP ON author_key, PRINT name. This view is the second half of that
-- sentence and nothing more. It resolves one key to the name that key published MOST
-- RECENTLY, which is what a creator expects to see after they change it, and it reports how
-- many other keys currently answer to the same name so the board can decide what to do about
-- @MossyOtter x16 rather than discovering it in production.
--
-- IT IS NOT REACHABLE FROM A PHONE, ON PURPOSE. feed_page deliberately does not return
-- author_key: a stable author id readable off the feed lets anyone cluster every photo one
-- person has published, which is a heavier thing than the block it would buy. That argument
-- does not weaken because the row is now in a view. Two guards, and both are load-bearing:
-- security_invoker so the view runs as the caller and RLS on `hides` (on, zero policies)
-- still applies, and no grant to anon/authenticated. A board RPC reads this SERVER-side,
-- under security definer, and returns names and counts — never the key.

create or replace view public.author_identity
  with (security_invoker = true) as
with cur as (
  select h.author_key,
         (array_agg(h.name order by h.created_at desc, h.id desc))[1] as name,
         count(*)::int     as hides,
         min(h.created_at) as first_hide,
         max(h.created_at) as last_hide
  from public.hides h
  where coalesce(h.author_key, '') <> ''
    and coalesce(h.name, '') <> ''
  group by h.author_key
)
select author_key,
       name,
       -- HOW MANY PEOPLE ANSWER TO THIS NAME RIGHT NOW. 1 is a person; anything above 1 is
       -- the mint pool talking, and the board has to disambiguate or drop the row.
       count(*) over (partition by lower(name))::int as name_shared_by,
       hides,
       first_hide,
       last_hide
from cur;

revoke all on public.author_identity from anon, authenticated;

comment on view public.author_identity is
  'author_key -> current display name, for boards. Group on author_key, print name; '
  'name_shared_by > 1 means the minted pool collided and the label is not unique. '
  'Server-side only: never grant to anon, never return author_key to a client.';
