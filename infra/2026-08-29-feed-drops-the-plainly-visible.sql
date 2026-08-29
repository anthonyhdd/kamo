-- 2026-08-29 — THE FEED STOPS SERVING KAMOS THAT ARE PLAINLY VISIBLE
--
-- Applied as 2026-08-29-feed-drops-the-plainly-visible.
--
-- `conceal` landed on 2026-08-28 as measurement only, with the explicit instruction that
-- nothing would gate on it until a threshold could be chosen against evidence rather than
-- guessed. One night answered it. Camera-source hides played three times or more:
--
--   conceal 95-100   79 hides   731 attempts   45.4% found
--   conceal 90-94    42 hides   290 attempts   53.1% found
--   conceal 80-89    24 hides   170 attempts   71.2% found
--   conceal <80      21 hides   104 attempts   77.9% found
--
-- Monotone across four bands WITHIN A SINGLE SOURCE, so it measures concealment rather than
-- rediscovering "screenshot or not" — the control that mattered, because `source` already
-- filters those and would otherwise be doing the work. `coverage`, by contrast, reads 100 for
-- 93% of hides and orders nothing at all.
--
-- ⚠️ THE CUT IS 70 AND IT IS DELIBERATELY THE ONLY ONE. Over the whole measured population the
-- gradient is clean at the ends and NOISY IN THE MIDDLE — 70-79 finds at 59.1% while 80-84
-- finds at 72.7%, which cannot both be true of a well-behaved measure. Below 70 it is
-- unambiguous: 75-79% found against 42.3% at the top, over 8.6% of hides. A second, stricter
-- threshold for feed_best() — the proven-opener slide, arguably the highest-stakes one — was
-- considered and REFUSED: with 74 attempts below 70, inventing two cut points is fitting
-- noise. Raise it later if the bands separate; do not guess it now.
--
-- ⚠️ NULL IS ADMITTED, AND THE FEED EMPTIES WITHOUT IT. Every hide published before 2026-08-28
-- carries NULL, and so does every hide from a page loaded before that deploy: roughly 11 000 of
-- the ~11 400 currently eligible. This judges the rows that carry the number and leaves the
-- rest exactly as they were — the same shape the `source` cutoff takes one clause above, and
-- for the same reason.
--
-- ⚠️ AND IT IS THE FEED, NOT THE PUBLISH FLOOR. A refused publish blocks a creator's work at
-- the one place the send rate lives, and that button has been covered twice by things merely
-- sitting near it. A hide under the cut still publishes, still sends, still plays by link and
-- as a direct challenge — it simply does not go in front of strangers.
--
-- Verified immediately after: the feed still returns 30 slides, minimum conceal 76, one slide
-- without a measurement. Pool 11 279, of which 207 measured and 11 excluded today; that share
-- grows toward 8.6% as the measured population replaces the legacy one.
--
-- WHAT TO WATCH: the seeker-side find rate should FALL (a harder feed) while rounds per
-- session hold or rise. If publishing or the send rate moves, this is not the cause — nothing
-- here touches either — and blaming it would cost a real diagnosis.
do $mig$
declare
  r record;
  src text;
  hits int;
  n int := 0;
  old_pred constant text :=
    '((h.source is null and h.created_at < timestamptz ''2026-08-17'') or h.source not in (''rehide'', ''library_nocam''))';
  new_pred constant text :=
    '((h.source is null and h.created_at < timestamptz ''2026-08-17'') or h.source not in (''rehide'', ''library_nocam''))
    and (h.conceal is null or h.conceal >= 70)';
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
  raise notice 'feed: % functions now refuse a measured conceal below 70', n;
end
$mig$;

-- Re-reading it, once the measured population is large enough to argue with. If the middle
-- bands settle into order, the cut can move up; if they stay noisy, 70 is where it belongs.
--
--   select width_bucket(conceal, 0, 100, 10) * 10 as band, count(*) as hides,
--          sum(n_attempts) as attempts,
--          round(100.0 * sum(n_found) / nullif(sum(n_attempts), 0), 1) as find_pct
--   from hides
--   where conceal is not null and n_attempts >= 3 and source = 'camera'
--   group by 1 order by 1;
