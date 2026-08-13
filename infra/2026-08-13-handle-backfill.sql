-- APPLIED 2026-08-13 to Supabase project qpztlobbnjyjbxqyuzgg.
--
-- Kept in the repo because this database has no migration history anywhere else — same reason
-- as every other file in this directory.
--
-- THE FEED HAS NOBODY IN IT.
--
-- 126 hides of 3346 carry a name (3.7%), and inside the slice that actually matters it is
-- worse: of the 115 hides the feed can serve right now, 109 are anonymous. Every card says
-- "Someone", which does not read as a room full of people being private. It reads as an
-- empty room. A feed whose whole promise is "strangers made these" cannot afford to look
-- unattended on the screen where a new player decides whether this thing is alive.
--
-- The client half of this ships in the same change: ensureHandle() assigns a pseudonym at the
-- FIRST PUBLISH, silently, and offers personalisation on the home card where the name is
-- already shown. No modal at first launch — that is the highest-abandon moment the app has
-- and a form is the last thing that belongs in it. This file is the other half: the rows that
-- already exist, which no amount of client code can reach.
--
-- WHY ONLY is_public, AND NOT THE OTHER 3100 ROWS.
-- A private hide is a 1:1 link somebody already sent to a friend who knows exactly who they
-- are. Stamping "@MossyHeron" onto that link retroactively changes what that friend sees, and
-- changes it into something less true than "Someone" — the receiver is not being told a name,
-- they are being told the wrong name for a person they can already identify. The feed is the
-- opposite case: nobody there knows anybody, so a pseudonym adds identity where there was
-- none and takes nothing away. The dead-feed problem is entirely inside is_public, so that is
-- exactly how far this reaches. Hides published from here on get their name from the client.
--
-- ONE NAME PER PERSON, NOT ONE PER PHOTO.
-- Grouped on author_key, so a creator with seven hides in the feed is one recognisable
-- @DimLynx rather than seven strangers. 76 of the 110 target rows carry a key (28 distinct
-- authors); the 34 that predate author keys fall back to a per-row seed, which is the honest
-- answer — for those rows the database genuinely does not know who made them, and inventing a
-- shared identity across them would be worse than leaving them as separate strangers.
--
-- DETERMINISTIC, therefore re-runnable. The name is a hash of the seed, not random(), so this
-- file produces the same result every time it is applied and re-applying it after a partial
-- failure cannot hand somebody a second identity. The WHERE clause is idempotent on its own
-- (it only ever touches rows with no name), but determinism is what makes that safe to trust.
--
-- THE WORD LISTS ARE MIRRORED IN index.html — HANDLE_ADJ / HANDLE_NOUN, same 24 and 24, same
-- order. They have to stay in step or the feed reads as two products: the backfilled rows and
-- the new ones would visibly come from different name generators. Edit both or neither.
-- Camouflage is the theme because it is the game. 24 x 24 = 576 combinations; the longest
-- pair is 14 characters, inside cleanHandle()'s 16-character ceiling.

with lists as (
  select array['Mossy','Dusty','Amber','Slate','Umber','Olive','Ashen','Hazel','Ochre','Sable',
               'Ivory','Rusty','Teal','Pewter','Cobalt','Velvet','Silent','Hidden','Drifting','Still',
               'Faint','Shy','Quiet','Dim']::text[] as adj,
         array['Fox','Moth','Gecko','Heron','Lynx','Squid','Owl','Crab','Toad','Viper',
               'Mantis','Skink','Ermine','Otter','Wren','Adder','Newt','Hare','Stoat','Pika',
               'Quail','Snipe','Raven','Vole']::text[] as noun
),
target as (
  -- coalesce, not a join: a row with no author_key gets a seed nothing else can collide with,
  -- so it lands on its own name instead of sharing the bucket every keyless row would share.
  select h.id, coalesce(h.author_key, 'row:' || h.id) as seed
  from public.hides h
  where h.is_public
    and (h.name is null or btrim(h.name) = '')
),
named as (
  -- bit(32)::bigint is non-negative, so the modulo cannot produce a 0 or negative subscript
  -- against a 1-indexed Postgres array. Two different slices of the hash for the two lists,
  -- so the adjective and the noun are not correlated.
  select t.id,
         l.adj [1 + (('x' || substr(md5(t.seed), 1, 8))::bit(32)::bigint % array_length(l.adj, 1))]
      || l.noun[1 + (('x' || substr(md5(t.seed || '#n'), 1, 8))::bit(32)::bigint % array_length(l.noun, 1))]
         as handle
  from target t cross join lists l
)
update public.hides h
   set name = n.handle
  from named n
 where h.id = n.id;
