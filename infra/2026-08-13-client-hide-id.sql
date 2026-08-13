-- APPLIED 2026-08-13 to Supabase project qpztlobbnjyjbxqyuzgg.
--
-- LET THE CLIENT NAME THE HIDE, so a share can carry a link before the row exists.
--
-- THE PROBLEM. `invite_shared` with link=false ran 13 times on 2026-08-12 and 7 on 08-13 —
-- shares that reached a friend with no game in them. They are NOT the deliberate under-the-
-- floor sends: `share_target_tapped` with bare=true is zero on both days. They are the web
-- branch losing a race it cannot enter.
--
-- navigator.share must be called on the user activation the tap granted, and the first await
-- spends it — so unlike the native path (which got an 8s wait on 08-12, because postNative
-- carries no activation debt) the web path CANNOT hold for create_hide. When the thumb lands
-- inside the 3-6s the upload takes, chLink() is still empty and the message degrades to the
-- generic invite.
--
-- THE FIX IS TO REMOVE THE RACE, not to wait faster: if the id is known before the round trip,
-- the link is knowable synchronously and there is nothing to lose. chSlot() already mints the
-- storage NAME this way, for exactly this reason; this extends the same idea to the id.
--
-- WHY THIS IS A NEW OVERLOAD AND NOT AN EDIT. The page and the database do not deploy
-- together (see CLAUDE.md). Editing the 11-argument signature would 404 every publish from a
-- page loaded before the migration. This is the 12-argument rung; every rung below it is
-- untouched and still climbed by older pages.
--
-- THE VALIDATION IS A SECURITY FILTER, WHICH IS WHY IT IS IN THE BODY rather than expressed as
-- another overload. The id now arrives from an anonymous client over the public anon key, so
-- it is checked here rather than trusted:
--
--   * it must be exactly 16 lowercase hex characters — the shape the Cloudflare Worker parses
--     out of /h/<id>, so anything else could not be served as a link anyway
--   * it must not already exist. This is the one that matters: without it a caller could pass
--     the id of somebody else's hide. The insert would raise on the primary key, so nothing
--     could ever be OVERWRITTEN, but the failure would be handed to a legitimate publisher as
--     a lost round. Taking a fresh id instead means a hijack attempt costs the attacker
--     nothing and the victim nothing.
--
-- Either check failing falls back to a server-generated id — the row always lands, which is
-- the rule everywhere else in this file. The client's optimistic link would then point at a
-- hide that does not exist, which is why the page only uses it on the web branch, where the
-- alternative is a link-less invite rather than a working link.

create or replace function public.create_hide(
  p_img_path text, p_cx real, p_cy real, p_r real, p_secs integer, p_coverage integer,
  p_limit_s integer, p_max_taps integer, p_name text, p_reply_to text, p_author_key text,
  p_id text)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_id text; v_name text; v_parent text; v_round int := 1; v_key text;
begin
  -- See the note above: validated, never trusted, and never allowed to collide.
  v_id := lower(coalesce(p_id, ''));
  if v_id !~ '^[0-9a-f]{16}$' or exists (select 1 from hides h where h.id = v_id) then
    v_id := substr(replace(gen_random_uuid()::text, '-', ''), 1, 16);
  end if;

  -- Everything below is the 11-argument body verbatim. Kept identical on purpose: this rung
  -- differs from the one under it in exactly one way, and a second difference introduced here
  -- by accident would be invisible from the client.
  v_name := nullif(regexp_replace(coalesce(p_name, ''), '[^A-Za-z0-9_.]', '', 'g'), '');
  v_key := nullif(regexp_replace(coalesce(p_author_key, ''), '[^a-zA-Z0-9]', '', 'g'), '');
  select h.id, h.round + 1 into v_parent, v_round from hides h where h.id = p_reply_to;
  insert into hides (id, img_path, cx, cy, r, secs, coverage, limit_s, max_taps, name,
                     reply_to, round, author_key)
  values (v_id, p_img_path, p_cx, p_cy, p_r, p_secs, p_coverage, p_limit_s, p_max_taps,
          left(v_name, 16), v_parent, coalesce(v_round, 1), left(v_key, 40));
  return v_id;
end $function$;
