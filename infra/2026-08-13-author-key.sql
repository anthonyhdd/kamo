-- APPLIED 2026-08-13 to Supabase project qpztlobbnjyjbxqyuzgg.
--
-- WHO MADE A HIDE, SO THE FEED CAN BE TOLD "NOT THIS PERSON AGAIN".
--
-- The feed shows strangers' photos to strangers. Reporting already exists and is blunt on
-- purpose — one report pulls a photo out of the feed for everybody (see the note on
-- n_reported in 2026-08-13-feed.sql). Blocking is the other half and it is personal: it
-- removes one author from ONE viewer's feed, forever, without touching what anybody else
-- sees. It is the thing a viewer reaches for when a photo is not reportable but they still
-- never want to see that person again, and without it the only available reaction to a
-- stranger is the nuclear one.
--
-- THE HALF THAT WAS ALREADY HERE, AND WHY THIS FILE STARTS BY WRITING IT DOWN.
-- `hides.author_key`, `set_hide_author()` and the 5-argument `feed_page()` (which already
-- filters on a block list) were applied to this database earlier today through the dashboard
-- and never mirrored into this directory. They are reproduced below unchanged. Reproducing
-- them is not ceremony: this directory is the only record of this database that lives in
-- version control, and a function nobody can read the history of is a function nobody will
-- dare change. Re-running them is a no-op — the bodies are byte-identical to what is live.
--
-- WHAT WAS ACTUALLY MISSING: nothing wrote the column. All 3191 rows carried author_key
-- NULL, so `feed_page`'s block clause — which reads
--     (p_block is null or h.author_key is null or not (h.author_key = any(p_block)))
-- — passed every row on the `author_key is null` arm. Blocking was not failing loudly; it
-- was a filter that could never match, which is the shape of bug that survives a demo.

-- ============================================================================================
-- ALREADY LIVE, RECORDED HERE FOR THE FIRST TIME
-- ============================================================================================

alter table public.hides add column if not exists author_key text;

-- The write-once companion to set_hide_public / set_hide_lang, reachable by anyone holding the
-- hide id. `and author_key is null` is the load-bearing clause: a hide's author is settled at
-- the moment it is first claimed and cannot be overwritten afterwards, so knowing an id buys
-- the ability to claim an UNCLAIMED hide and nothing else. Retained as a repair path for rows
-- that predate the create_hide overload below; the page does not call it.
create or replace function public.set_hide_author(p_id text, p_key text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  update hides
     set author_key = left(regexp_replace(coalesce(p_key, ''), '[^a-zA-Z0-9]', '', 'g'), 40)
   where id = p_id
     and author_key is null
     and nullif(regexp_replace(coalesce(p_key, ''), '[^a-zA-Z0-9]', '', 'g'), '') is not null;
end $function$;

-- The feed page with a block list, a shuffle seed and an offset. Unchanged.
create or replace function public.feed_page(p_before timestamptz, p_limit integer, p_seed text,
                                            p_offset integer, p_block text[])
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
    and (p_block is null or h.author_key is null or not (h.author_key = any(p_block)))
  order by least(h.n_attempts, 3), md5(h.id || coalesce(p_seed, ''))
  offset greatest(coalesce(p_offset, 0), 0)
  limit least(greatest(coalesce(p_limit, 8), 1), 30);
$function$;

-- ============================================================================================
-- NEW TODAY: THE COLUMN GETS WRITTEN
-- ============================================================================================

-- A FIFTH OVERLOAD, NEVER AN EDIT — the same rule as the fourth, and for the same reason:
-- index.html deploys on push and the database does not, so during a rollout both are live and
-- a page loaded a minute ago still calls the 6-, 8-, 9- or 10-argument form. Those four keep
-- inserting author_key NULL and that is correct: a page that has no key cannot invent one.
--
-- WHY IT CARRIES p_reply_to AS WELL, rather than being a tidier (…, p_name, p_author_key):
-- PostgREST resolves overloads by the exact set of argument NAMES, but Postgres resolves them
-- by TYPE, and (…, text, text) is already taken by the reply form. A tenth-argument author key
-- would collide with `create_hide(…, p_name, p_reply_to)` at the catalogue level — same types,
-- different names, and the second one cannot be created. So there is exactly one new form and
-- it carries both nullable fields; the page sends nulls for whichever does not apply.
--
-- WHY ON create_hide AND NOT A SECOND CALL. set_hide_author() could do this from the page in
-- one fire-and-forget line, next to set_hide_lang. The failure modes are not symmetrical,
-- though. A set_hide_public() that never lands leaves a hide PRIVATE — the safe direction, and
-- that asymmetry is why that one is allowed to be a separate call. A set_hide_author() that
-- never lands leaves a hide with no author, which means a hide nobody can ever block: the
-- failure falls on the side of less protection, silently, on exactly the rows most likely to
-- need it. Written in the insert, it cannot half-happen.
create or replace function public.create_hide(
  p_img_path text, p_cx real, p_cy real, p_r real, p_secs integer, p_coverage integer,
  p_limit_s integer, p_max_taps integer, p_name text, p_reply_to text, p_author_key text)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_id text; v_name text; v_parent text; v_round int := 1; v_key text;
begin
  -- gen_random_uuid(), not gen_random_bytes() — the latter lives in the `extensions` schema
  -- and this function's search_path is 'public'. See the warning at the top of the reply
  -- migration: it fails at runtime, and the page's fallback ladder would hide it.
  v_id := substr(replace(gen_random_uuid()::text, '-', ''), 1, 16);
  v_name := nullif(regexp_replace(coalesce(p_name, ''), '[^A-Za-z0-9_.]', '', 'g'), '');
  -- Narrowed identically to set_hide_author, so a key written by either path is the same
  -- string and a block placed before this deploy still matches a hide made after it.
  v_key := nullif(regexp_replace(coalesce(p_author_key, ''), '[^a-zA-Z0-9]', '', 'g'), '');
  select h.id, h.round + 1 into v_parent, v_round from hides h where h.id = p_reply_to;
  insert into hides (id, img_path, cx, cy, r, secs, coverage, limit_s, max_taps, name,
                     reply_to, round, author_key)
  values (v_id, p_img_path, p_cx, p_cy, p_r, p_secs, p_coverage, p_limit_s, p_max_taps,
          left(v_name, 16), v_parent, coalesce(v_round, 1), left(v_key, 40));
  return v_id;
end $function$;

grant execute on function public.create_hide(text, real, real, real, integer, integer,
                                             integer, integer, text, text, text)
  to anon, authenticated;
grant execute on function public.set_hide_author(text, text) to anon, authenticated;
grant execute on function public.feed_page(timestamptz, integer, text, integer, text[])
  to anon, authenticated;

-- NO BACKFILL, and no way to write one. The 3191 rows that predate this have no author on
-- record anywhere — the key lives only in the creator's localStorage and was never sent. They
-- stay NULL and stay unblockable, which the `h.author_key is null` arm of the feed filter
-- already handles by passing them through. That corpus expires on its own: hides are deleted
-- at 30 days, so the unblockable population is gone by 2026-09-12 without anyone doing
-- anything.
--
-- NOT SOLVED HERE: a viewer still has no way to LEARN which key to block. feed_page returns
-- id, img_path, name and two counters — deliberately not author_key, because a stable author
-- id readable off the feed lets anyone cluster every photo one person has ever published,
-- which is a heavier thing than the block it would enable. The block UI therefore wants to
-- name a HIDE and have the server resolve it to its author, rather than taking the key
-- through the client at all.
