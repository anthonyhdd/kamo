-- 2026-08-28 (evening) — THE FEED STOPS SERVING PHOTOGRAPHS THAT HOLD MORE THAN ONE KAMO
--
-- Applied as 2026-08-28-feed-drops-stacked-figure-photos.
--
-- ⚠️ THIS REVERSES 2026-08-28-feed-serves-replies, APPLIED THE SAME MORNING. Founder's explicit
-- decision, taken after being shown both sets of numbers and the case for capping instead.
-- Recorded as a decision, not a correction: that change was well-motivated and its measurement
-- stands. The recommendation on the table was a cap in the ORDER BY rather than an exclusion —
-- which is what the morning migration's own note prescribes for "the feed shows only replies" —
-- and full masking was chosen over it.
--
-- WHAT THE MORNING CHANGE WAS FOR. "Send one back" stamps source='rehide', and the predicate
-- excluded that word, so no reply had ever reached the feed: 1029 of them, 855 with their
-- author's public box ticked. The permanent control is the 58 replies made through the photo
-- library, which carry source='library' and were served — 93.1% of those had been played
-- against 37.4% of the excluded ones. Roughly 46 replies a day played by nobody. That cost
-- comes back with this migration and it was accepted knowingly.
--
-- WHERE ITS REASONING WAS WRONG, which is what changed the decision. It concluded the stacking
-- motive did not apply because ZERO of 1087 replies share the parent's `img_path`. True, and it
-- does not answer the question: a rehide fetches the parent's photograph, composes on top of it
-- and uploads a NEW object. Different path, accumulated content. Proven off the bytes:
--
--   mt8vql00xabc5t5y.jpg  round 1  @OchreHare  figure at cx 0.499 cy 0.429, unpainted, centre
--   mt8vw0bebc30rjmd.jpg  round 2  @po         carries that figure AND its own at 0.221/0.228
--
-- Two distinct objects, and the second visibly contains the first one's kamo. The photographs
-- really do stack: by round four a seeker is shown four hidden people and told to find one.
--
-- WHAT THE OUTCOMES SAY, over the live public population, by what the photograph actually is:
--
--   round 1                     8847 hides   39350 attempts   58.1% found
--   rehide (stacked figures)     883 hides    1741 attempts   34.8% found
--   reply on a fresh photo        52 hides     200 attempts   42.0% found
--
-- ⚠️ SOURCE, NOT ROUND — and this is the whole precision of the change. A reply made from the
-- camera or the library has round > 1 and exactly ONE figure in its photograph (the 52-hide
-- line) and it STAYS in the feed. Only `source = 'rehide'` reuses the parent's picture. So all
-- that is removed is the `or h.reply_to is not null` disjunct: single-figure replies were
-- already admitted by the `not in` clause and still are. Anyone tempted to write
-- `round = 1` here would throw those away for nothing.
--
-- Verified on the top 30 slides immediately after: 29 camera, 1 library_cam, zero rehide, zero
-- screenshot, zero source-less. Before this it was 21 rehide out of 30.
--
-- WHAT TO WATCH: the seeker side should improve (find rate, rounds completed) and the
-- reply-played gap will reopen. If creation-after-a-reply falls, this is the change that did it.
do $mig$
declare
  r record;
  src text;
  hits int;
  n int := 0;
  old_pred constant text :=
    '((h.source is null and h.created_at < timestamptz ''2026-08-17'') or h.source not in (''rehide'', ''library_nocam'') or h.reply_to is not null)';
  new_pred constant text :=
    '((h.source is null and h.created_at < timestamptz ''2026-08-17'') or h.source not in (''rehide'', ''library_nocam''))';
begin
  for r in
    select p.oid, p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public' and p.proname in ('feed_page', 'feed_best')
  loop
    src := pg_get_functiondef(r.oid);
    hits := (length(src) - length(replace(src, old_pred, ''))) / length(old_pred);
    if hits <> 1 then
      raise exception '%(%) carries the source predicate % time(s), expected exactly 1', r.proname, r.args, hits;
    end if;
    execute replace(src, old_pred, new_pred);
    n := n + 1;
  end loop;
  if n <> 7 then
    raise exception 'expected 7 feed functions, rewrote %', n;
  end if;
  raise notice 'feed: % functions no longer serve stacked-figure photographs', n;
end
$mig$;
