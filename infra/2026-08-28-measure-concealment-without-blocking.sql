-- 2026-08-28 — MEASURE WHETHER A KAMO IS ACTUALLY HIDDEN. BLOCK NOTHING.
--
-- Applied to qpztlobbnjyjbxqyuzgg as 2026-08-28-measure-concealment-without-blocking.
--
-- `coverage` does not mean what its name says, and has not for months. computeScore() counts
-- the fraction of the figure's pixels carrying ANY paint, read off the paint layer's alpha:
--
--     if(md[i+3]>128){ fig++; if(pd[i+3]>128) painted++; }
--
-- It never compares the paint to what it sits against. Drag the brush over the whole figure in
-- the cream of the wall behind you, stand it in front of a dark hoodie: 100. Over the seven
-- days to 2026-08-28, 92.9% of hides report exactly 100 — so the `>= 70` floors in
-- create_hide, feed_page and get_hide are guards whose condition is always true.
--
-- Found from a founder screenshot ("the grey figure in the middle was not the right one"),
-- then proven off the bytes rather than inferred:
--
--   99711286d1ca0eb6  @OchreHare  round 1  cx 0.499 cy 0.429  coverage 100
--   592749d72a7a4af2  @po         round 2  cx 0.221 cy 0.228  coverage 100
--
-- Round 1's own published JPEG is a flat, entirely unpainted white silhouette dead centre of
-- the frame. Its child inherits that photograph, so the round-2 seeker meets two plainly
-- visible figures and the big obvious one is NOT the answer — the answer is small, top-left,
-- behind the subtitle. Nothing in the reveal is at fault; the photograph really does contain
-- an unhidden kamo, and the floor waved it through because it had nothing to say about it.
--
-- ⚠️ THIS COLUMN CHANGES NOTHING YET, AND THAT IS THE INSTRUCTION, NOT AN OVERSIGHT.
-- Founder's call: measure first, block nothing. No floor reads `conceal`, no feed function
-- filters on it, no publish path can be refused by it. It exists so a threshold can be chosen
-- against n_found/n_attempts — the ground truth for "too easy" — instead of guessed. Anything
-- that starts gating on it is a separate, deliberate change, and the send rate is the guard
-- metric on it: half the creator base already sits outside the loop for want of a send.
--
-- ⚠️ AND IT IS NOT `coverage` RENAMED. coverage crosses the bridge, and the NATIVE side gates
-- the App Store review prompt on it (storeReview.js: MIN_SCORE = 30, >= 85 picks "Nice hide")
-- in a build we cannot recut. Redefining it would silently suppress review prompts on every
-- installed binary. Two numbers, two jobs.
--
-- WHAT THE NUMBER IS: edge contrast across the silhouette, 0-100, 100 = indistinguishable.
-- Deliberately NOT the interior board-vs-blur distance that lived in this app once and was
-- removed as noise — that compared a lit figure against a global idea of the scene, so it
-- punished the shading pass and moved when the light moved. A boundary comparison is local:
-- an evenly-lit room and a dramatic one score the same, and shading to match now helps.
-- Verified on chosen colours before being trusted on photographs (scripts/test-conceal-dom.mjs):
-- exact match 100, white on near-black 0, four points off 96, too small to read NULL never 0.
alter table hides add column if not exists conceal smallint;

comment on column hides.conceal is
  'Edge contrast across the figure silhouette at publish time, 0-100, 100 = indistinguishable '
  'from its surroundings. Measurement only as of 2026-08-28 — nothing gates on it. Distinct '
  'from `coverage`, which counts painted pixels and crosses the bridge to the native review '
  'gate. NULL on every row published before this date and by any client on an older overload.';

-- The sixteenth overload. ADD, NEVER CHANGE: this page deploys on push and the database does
-- not, so during a deploy a tab loaded a minute ago is still calling the fifteen-argument form.
create or replace function public.create_hide(
  p_img_path text, p_cx real, p_cy real, p_r real, p_secs integer, p_coverage integer,
  p_limit_s integer, p_max_taps integer, p_name text, p_reply_to text, p_author_key text,
  p_id text, p_streak integer, p_lqip text, p_source text, p_conceal integer)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_id text; v_name text; v_parent text; v_round int := 1; v_key text; v_streak smallint;
        v_lqip text; v_source text; v_conceal smallint;
begin
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
  v_source := case when p_source in ('camera', 'rehide', 'library', 'library_cam', 'library_nocam')
                   then p_source else null end;
  -- Clamped like every other field rather than trusted: a client sending nonsense costs one
  -- NULL in a column nothing depends on, never a bad row.
  v_conceal := case when p_conceal between 0 and 100 then p_conceal::smallint else null end;

  insert into hides (id, img_path, cx, cy, r, secs, coverage, limit_s, max_taps, name,
                     reply_to, round, author_key, streak, lqip, source, conceal)
  values (v_id, p_img_path, p_cx, p_cy, p_r, p_secs, p_coverage, p_limit_s, p_max_taps,
          left(v_name, 16), v_parent, coalesce(v_round, 1), left(v_key, 40), v_streak, v_lqip,
          v_source, v_conceal);
  return v_id;
end
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- READING IT, once rows have accumulated. The question is not "what is the mean" but
-- "does it predict the thing we care about" — a cut is only worth making where find rate
-- actually turns. Judge on played hides only; an unplayed hide says nothing either way.
--
--   select width_bucket(conceal, 0, 100, 10) * 10 as band,
--          count(*) as hides,
--          sum(n_attempts) as attempts,
--          round(100.0 * sum(n_found) / nullif(sum(n_attempts), 0), 1) as find_pct
--   from hides
--   where conceal is not null and n_attempts >= 3
--   group by 1 order by 1;
--
-- If find_pct falls monotonically as the band rises, the measure works and the threshold is
-- wherever the product wants the difficulty floor. If it is flat, the measure is wrong and
-- nothing should be gated on it — that verdict is as useful as the other one.
