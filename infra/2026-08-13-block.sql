-- APPLIED 2026-08-13 to Supabase project qpztlobbnjyjbxqyuzgg.
-- Follows 2026-08-13-author-key.sql, which put an author on the row. This is what asks for one.
--
-- "DON'T SHOW ME THIS PERSON AGAIN", AND THE TWO THINGS IT MUST NOT COST.
--
-- Reporting already exists and is deliberately blunt: one report pulls a photo out of the
-- feed for everybody (n_reported = 0 in the feed filter). It is the right instrument for a
-- photo that breaks the rules and the wrong one for a photo that is merely not wanted — and
-- a viewer with only the blunt instrument in reach will use it for both, which is how a
-- report count stops meaning anything. Blocking is the quiet instrument: it removes one
-- author from ONE viewer's feed and changes nothing about what anybody else sees.
--
-- COST ONE: THE VIEWER'S ANONYMITY. There are no accounts here, so the block list can only
-- live on the viewer's device and travel up with each request. Fine.
--
-- COST TWO — the one that shaped this file: THE AUTHOR'S. The obvious design hands the
-- client the author's key and lets it filter. That key is stable across every hide a person
-- has ever made, so any client holding it can cluster an author's entire output, and any
-- client that can read it off the feed can do that for every author at once, passively, by
-- scrolling. feed_page has never returned author_key and still does not.
--
-- So the client is given a TAG instead: sha256(author_key || pepper), which identifies an
-- author without being the string create_hide accepts. Two properties fall out of that.
-- Forgery is closed — a tag cannot be replayed into create_hide to publish as somebody else,
-- because it is not invertible. And the pepper is NOT a secret and is not pretending to be:
-- it lives in this DDL and in a public repo. Its whole job is domain separation between "the
-- key the author sends up" and "the handle a stranger holds", and a public constant does that
-- perfectly well. It is versioned (v1) so it can be rotated, at the cost of every stored
-- block lapsing at once.
--
-- WHY A TAG AND NOT THE HIDE ID. Blocking by hide id — "hide everything by whoever made
-- THIS" — needs the blocked hide to still exist at query time to resolve its author, and
-- hides are deleted at 30 days (expires_at). The block would then lapse in silence at the
-- exact moment it starts mattering: the author's OLD photos are gone anyway, so what a block
-- is really for is their NEXT one. A tag is a value the viewer keeps; it outlives the
-- evidence.
--
-- WHAT IS STILL AN ORACLE, said plainly: block_author() will tell any caller the tag of any
-- hide id it holds, one call at a time, so a determined client could walk the feed and
-- cluster authors that way. That is strictly more work than reading a column, and closing it
-- would need an identity for the caller, which this app does not have. The passive leak is
-- shut; the active one is priced.

-- The tag, computed by the database and never by the page. GENERATED rather than written in
-- create_hide so it cannot drift from its source: there is no code path that can set an
-- author_key and forget the tag, including set_hide_author() and anything added later.
-- extensions.digest, schema-qualified — a generated expression is resolved without a
-- search_path, and pgcrypto lives in `extensions` here. Same trap as gen_random_bytes() in
-- the reply migration.
alter table public.hides
  add column if not exists author_tag text
  generated always as (
    case when author_key is null then null
         else encode(extensions.digest(author_key || 'kamo-block-v1', 'sha256'), 'hex')
    end
  ) stored;

-- Answering "who made this" with a handle instead of the key. Returns NULL for a hide that
-- has no author on record — every row made before today — and the page treats that as "this
-- one cannot be blocked" rather than as an error.
create or replace function public.block_author(p_id text)
returns text
language sql
stable
security definer
set search_path to 'public'
as $function$
  select h.author_tag from hides h where h.id = p_id;
$function$;

-- A THIRD feed_page, added and not edited, for the same reason as always: the page deploys
-- on push and the database does not.
--
-- It mirrors the 2-argument form the page actually uses — created_at DESC, cursor paging —
-- rather than the 5-argument shuffle experiment, which no build has ever called. The types
-- (timestamptz, integer, text[]) collide with neither, so PostgREST resolves all three by the
-- exact set of keys sent and an old page keeps getting the old function.
--
-- The NULL arm is load-bearing: `not (h.author_tag = any(...))` is NULL for an untagged row,
-- which SQL treats as not-true, and that would drop every pre-today hide out of the feed for
-- anyone who has blocked so much as one person. Untagged means unblockable, not blocked.
create or replace function public.feed_page(p_before timestamptz, p_limit integer,
                                            p_block_tags text[])
returns table(id text, img_path text, name text, n_attempts integer, n_found integer,
              created_at timestamptz)
language sql
stable
security definer
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
    and (p_before is null or h.created_at < p_before)
    and (h.author_tag is null or not (h.author_tag = any(coalesce(p_block_tags, '{}'))))
  order by h.created_at desc
  limit least(greatest(coalesce(p_limit, 8), 1), 30);
$function$;

grant execute on function public.block_author(text) to anon, authenticated;
grant execute on function public.feed_page(timestamptz, integer, text[]) to anon, authenticated;

-- NOT INDEXED, on purpose. The filter is an anti-join against a handful of tags inside a
-- partial index scan that is already narrow (public + unblocked), and an index on author_tag
-- would answer the question nobody asks here — "everything by this author" — while costing a
-- write on every publish.
