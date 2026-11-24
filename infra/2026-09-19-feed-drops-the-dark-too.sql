-- ═══ AND THE DARK ONES GO TOO, NOT JUST THE RECTANGLES ═════════════════════════════════════
--
-- Founder, 2026-09-19, reading the first sweep: « même si c'est de vraies photos sombres c'est
-- nul, faut enlever. »
--
-- Yesterday's file (2026-09-18-feed-stops-serving-black-slabs.sql) was careful to keep real
-- dark photographs — it matched kfLooksBlack() exactly (mean < 18 AND spread < 10) so that a
-- night room with a painted figure in it stayed in the feed, and it said so at length. That
-- care was aimed at the wrong thing. The question was never "is this a rectangle or a
-- photograph", it is "can somebody PLAY this", and a photograph you cannot see is not better
-- than a rectangle you cannot see — it is the same black screen with a better excuse.
--
-- ── AND THE NUMBERS SAY THE SAME THING ──────────────────────────────────────────────────────
--
-- The sweep measured the whole live corpus, so for the first time the pool can be cut by
-- brightness and read. Public hides played three times or more, by placeholder mean luma:
--
--     mean 0-9     579 hides   385 played   28.8% NEVER found
--     mean 10-19   185 hides   109 played   22.9%
--     mean 20-29   135 hides    80 played   18.8%
--     mean 30-39   136 hides    92 played   26.1%
--     ────────────────────────────────────────────── the cut
--     mean 40-54   240 hides   150 played   16.0%
--     mean 55-79   541 hides   330 played   15.5%
--     mean 80+    4973 hides  2784 played   12.9%
--
-- Every band below 40 is worse than every band above it, and the two sides do not overlap:
-- 18.8-28.8% against 12.9-16.0%. The gradient is NOISY INSIDE the dark half — 20-29 reads
-- better than 30-39, on 80 and 92 played hides — which is exactly why there is ONE cut here
-- and not a scale. 40/255 is 16% of full brightness: not "moody", not "night mode", a frame
-- with nothing legible in it.
--
-- ⚠️ IT COSTS 15.1% OF THE POOL — 1 035 of 6 875 live hides, the largest single exclusion this
-- feed has taken (source cost 6.4%, conceal 8.6%). That is affordable at ~900 publishes a day
-- and it is the founder's call, taken on this table. If the feed ever runs thin, this is the
-- first number to revisit, and revisiting it is an UPDATE to the predicate below — the
-- measurements stay on the rows, so no re-sweep is needed to move the line.
--
-- ── THE SPREAD TEST IS GONE, DELIBERATELY ───────────────────────────────────────────────────
--
-- 18/10 was an AND: near-black *and* flat. It let through the shape that is worst of all —
-- `94fc79fa49ba6121`, mean 1 with a spread of 124: a black frame with one bright light in it.
-- Flat it is not; playable it is not either. Darkness alone decides now, and the spread is
-- still measured and still stored, because the day someone wants "dark but textured" back it
-- is the column that makes that arguable instead of guessable.
--
-- kfLooksBlack() in index.html keeps its own 18/10 and keeps running. It is now the narrower
-- of the two nets and it only ever sees rows this one has not reached yet (under five minutes
-- old). Nothing to change there.
--
-- Applied 2026-09-19.

do $mig$
declare
  r      record;
  src    text;
  n      int := 0;
  missed text[] := '{}';
  old_pred constant text :=
    'and (h.lqip_mean is null or h.lqip_spread is null
         or h.lqip_mean >= 18 or h.lqip_spread >= 10)';
  new_pred constant text :=
    'and (h.lqip_mean is null or h.lqip_mean >= 40)';
begin
  for r in
    select p.oid, p.oid::regprocedure::text as sig
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public' and p.proname in ('feed_page', 'feed_best')
  loop
    src := pg_get_functiondef(r.oid);
    if position(new_pred in src) > 0 then continue; end if;              -- idempotent
    if position(old_pred in src) = 0 then
      missed := missed || r.sig;
      continue;
    end if;
    execute replace(src, old_pred, new_pred);
    n := n + 1;
  end loop;
  -- Same rule as yesterday: a feed function this could not reach is a fleet of clients still
  -- being served the thing the founder asked to have removed.
  if array_length(missed, 1) is not null then
    raise exception 'dark gate not applied to: %', array_to_string(missed, ', ');
  end if;
  raise notice 'dark gate: % feed function(s) rewritten', n;
end $mig$;

-- ── to read it afterwards ───────────────────────────────────────────────────────────────────
--   select count(*) filter (where lqip_mean < 40) dark, count(*) pool
--   from hides where is_public and not blocked and expires_at > now();
--
-- REVERSIBLE: put 40 back to 18/10, or to any number, with the same do-block shape. Nothing
-- was unpublished, nothing was deleted, and every hide still plays by link.
