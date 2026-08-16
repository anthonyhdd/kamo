-- APPLIED 2026-08-16 to Supabase project qpztlobbnjyjbxqyuzgg (migration `hide_source`).
--
-- ONE COLUMN AND ONE RUNG. The row learns where its photograph came from.
--
-- ══════════════════════════════════════════════════════════════════════════════════════
-- WHY THIS EXISTS
--
-- The library picker shipped in the wrapper on 2026-08-14 (kamo-app, `pick-photo` →
-- launchImageLibraryAsync). Three days later it carried 17.6% of the day's photo intake and
-- climbing — 796 `photo_picked` against 174 `camera_denied` on 08-15, so roughly four in five
-- uploads come from someone who GRANTED the camera and went to the roll anyway. The escape
-- hatch built for the denied cohort became a mainstream path.
--
-- Over the same three days the share of public hides that nobody could solve (>=4 attempts,
-- zero finds) went 1.5% → 3.5% → 4.5%, tracking the upload share almost step for step. That
-- correlation is suggestive and nothing more: the public feed itself opened on 08-13, one day
-- before the picker, so scale and source are confounded and no amount of staring at the
-- existing columns separates them.
--
-- It cannot be separated because THE ROW DOES NOT RECORD IT. `hides` has img_path, cx/cy/r,
-- coverage, secs, is_public — and nothing that says whether the photograph was taken through
-- the shutter the game is built around or picked out of the camera roll. The feed cannot rank
-- on it, moderation cannot act on it, and the question above cannot be answered at all. This
-- migration does not decide anything about uploads; it makes the question answerable.
--
-- ══════════════════════════════════════════════════════════════════════════════════════
-- 1. THE COLUMN. Nullable forever, like lqip: every hide published before this deploy has
--    none, and so does every publish from a page loaded before it. Null means "not recorded",
--    never "camera" — do not coalesce it into one at read time.
alter table public.hides add column if not exists source text;

-- ══════════════════════════════════════════════════════════════════════════════════════
-- 2. THE VOCABULARY, and why it has five words rather than two.
--
--    camera         the shutter. The canonical path, and the only one the game's premise
--                   ("point it at your room") actually describes.
--    rehide         the answered hide's own image, reused by chRehide(). Not an upload: the
--                   photograph is somebody else's capture and misfiling it as one would
--                   inflate exactly the number this column exists to measure.
--    library_cam    picked from the roll, and its EXIF carries a Make/Model tag — i.e. some
--                   camera, somewhere, took it. A real photograph, just not taken here.
--    library_nocam  picked from the roll with EXIF present and no Make/Model. Screenshots,
--                   memes, downloaded images and generated images all land here, because a
--                   camera always writes those tags and none of those four ever do.
--    library        picked, provenance unknown — the <input type="file"> fallback, and any
--                   wrapper too old to send the flag. Honest ignorance, kept separate from
--                   library_nocam so a wrapper rollout cannot be read as a wave of memes.
--
--    The split is DELIBERATELY NOT A POLICY. Nothing here rejects a photo, and the page is
--    not told about any of it. A week of rows tells us whether library_nocam is 2% of the
--    feed or 30%, and whether it concentrates the skips and the reports; a rule can be argued
--    for after that, from numbers rather than from intuition. Shipping the rule first would
--    have blocked users on a hypothesis.
--
--    NOT A CHECK CONSTRAINT. The clamp lives in the function below instead, for the same
--    reason v_streak's does: a value outside the vocabulary arriving from an anonymous client
--    over the public anon key should become null and let the hide publish, not raise and cost
--    the user two minutes of painting.
--
-- 3. THE 15-ARGUMENT RUNG — the 14-argument body verbatim plus p_source. ADDED, NEVER EDITED,
--    like every rung under it: this file deploys on push and the database does not, so during
--    a deploy both are live and a page loaded a minute ago must still find its own signature.
create or replace function public.create_hide(
  p_img_path text, p_cx real, p_cy real, p_r real, p_secs integer, p_coverage integer,
  p_limit_s integer, p_max_taps integer, p_name text, p_reply_to text, p_author_key text,
  p_id text, p_streak integer, p_lqip text, p_source text)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_id text; v_name text; v_parent text; v_round int := 1; v_key text; v_streak smallint;
        v_lqip text; v_source text;
begin
  -- Everything down to v_source is the 14-argument body verbatim. Kept identical on purpose:
  -- this rung differs from the one under it in exactly one way, and a second difference
  -- introduced here would be invisible until the day the rungs disagree.
  v_id := lower(coalesce(p_id, ''));
  if v_id !~ '^[0-9a-f]{16}$' or exists (select 1 from hides h where h.id = v_id) then
    v_id := substr(replace(gen_random_uuid()::text, '-', ''), 1, 16);
  end if;
  v_name := nullif(regexp_replace(coalesce(p_name, ''), '[^A-Za-z0-9_.]', '', 'g'), '');
  v_key  := nullif(regexp_replace(coalesce(p_author_key, ''), '[^a-zA-Z0-9]', '', 'g'), '');
  select h.id, h.round + 1 into v_parent, v_round from hides h where h.id = p_reply_to;
  v_streak := case when p_streak between 1 and 999 then p_streak::smallint else null end;
  v_lqip := case when p_lqip is not null
                  and length(p_lqip) <= 6000
                  and p_lqip ~ '^data:image/jpeg;base64,[A-Za-z0-9+/=]+$'
             then p_lqip else null end;

  -- An enumeration, not a string: anything outside the five words is null rather than an
  -- error, so a wrapper or a page inventing a sixth costs this column one row and never costs
  -- anybody their hide.
  v_source := case when p_source in ('camera', 'rehide', 'library', 'library_cam', 'library_nocam')
                   then p_source else null end;

  insert into hides (id, img_path, cx, cy, r, secs, coverage, limit_s, max_taps, name,
                     reply_to, round, author_key, streak, lqip, source)
  values (v_id, p_img_path, p_cx, p_cy, p_r, p_secs, p_coverage, p_limit_s, p_max_taps,
          left(v_name, 16), v_parent, coalesce(v_round, 1), left(v_key, 40), v_streak, v_lqip,
          v_source);
  return v_id;
end
$function$;

grant execute on function public.create_hide(text, real, real, real, integer, integer,
  integer, integer, text, text, text, text, integer, text, text) to anon, authenticated;

-- ══════════════════════════════════════════════════════════════════════════════════════
-- 4. WHAT IS DELIBERATELY NOT HERE
--
-- feed_page and feed_best are UNTOUCHED. Their ordering already handles the failure mode this
-- investigation started from, and it handles it better than a source rule would: the +3
-- sweet-spot bonus (2026-08-16-feed-quality-lqip-reactions.sql) only pays out on a found-rate
-- between 25% and 75%, so a hide nobody can solve simply never earns it, while a hide that is
-- brutal-but-fair keeps drawing attempts and does. Demoting on "not found" would have punished
-- the second along with the first — a great piece of camouflage and an unwinnable one produce
-- the same zero, and only the seekers' behaviour tells them apart.
--
-- No backfill either. Every row before this deploy has source null and keeps it: the value was
-- never observed for those hides and inventing one would poison the only week of data the
-- decision is going to rest on.
--
-- The read to run in a week, once the wrapper carrying the flag has a real share of the fleet:
--
--   select source,
--          count(*)                                                        as hides,
--          round(100.0 * count(*) filter (where is_public) / count(*), 1)   as pct_public,
--          round(100.0 * sum(n_found) / nullif(sum(n_attempts), 0), 1)      as find_rate,
--          round(100.0 * sum(n_skipped)
--                      / nullif(sum(n_attempts) + sum(n_skipped), 0), 1)    as skip_rate,
--          round(100.0 * count(*) filter (where n_reported > 0) / count(*), 1) as pct_reported
--   from hides
--   where created_at > now() - interval '7 days' and source is not null
--   group by 1 order by hides desc;
--
-- skip_rate is the column to read first. A hard-but-fair hide COLLECTS attempts; an unfair one
-- gets skipped — the seeker looks at it and decides not to bother. That is abandonment rather
-- than failure, and it is the honest quality signal of the two.
