-- ═══ THE FEED STOPS SERVING PICTURES THAT ARE NOT PHOTOGRAPHS ═══════════════════════════════
--
-- Applied 2026-08-27. Founder: "trop facile de cacher un perso en blanc sur un fond blanc". A
-- screenshot is a flat field of colour, so hiding a figure in one is not camouflage, it is
-- erasure — the seeker is asked to find something with nothing to be found against.
--
-- THE SIGNAL ALREADY EXISTS AND IS ALREADY STORED, which is why this is a migration and not a
-- release. usePhotoReady() records the wrapper's reading of the picked asset's EXIF:
-- `library_cam` when a Make/Model tag is present, `library_nocam` when EXIF came back without
-- one. A camera always writes those tags; screenshots, memes, downloads and generated images
-- never do — the comment at that call site says so in as many words. So `library_nocam` IS the
-- population, and no client change is needed to find it.
--
-- AND IT IS MEASURABLY THE WORST. Public hides played, 14 days to 2026-08-27:
--
--     source          played   find rate   never found (>=3 tries)
--     camera           5764      61.8%           12.6%
--     library_cam       403      54.6%           16.6%
--     library          1618      50.2%           21.5%
--     library_nocam     560      46.5%           23.4%     <- excluded here
--     rehide            349      34.6%           27.2%     <- already excluded
--
-- ⚠️ ONLY library_nocam, NOT every library upload. A real photograph out of the camera roll is
-- a legitimate hide and carries its EXIF. Excluding all three library sources would have cost
-- 2581 of 8694 played hides — 30% of the catalogue — on a feed that already has a repetition
-- problem. This costs 6.4% and removes the worst-performing population in it.
--
-- `library` (unknown: an old wrapper, or the file-input fallback) is deliberately KEPT: honest
-- ignorance rather than a reading, and at 50.2% it is not the problem.
--
-- ⚠️ AND IT IS ALSO NOT THE SIZE, WHICH IS WHERE I LOOKED FIRST. The unfindable hides have a
-- figure 43% smaller on average (r 0.087 against 0.152), which reads like a clean explanation
-- until library_nocam is cut out on its own: r 0.138, within a whisker of camera's 0.151, and
-- a find rate 15 points worse. Size is a correlate. The picture is the cause.

do $$
declare f record; src text; n int := 0;
begin
  -- ⚠️ ALL SIX OVERLOADS. This page deploys on push and the database does not, so a browser
  -- holding a minute-old copy still calls the signature it was built against. Rewriting one
  -- would filter the feed for some users and not others — worse than not filtering at all,
  -- because it would look like the feature working. Substitution rather than six literals, so
  -- they cannot drift apart.
  for f in
    select oid::regprocedure::text as sig, pg_get_functiondef(oid) as def
    from pg_proc where proname = 'feed_page'
  loop
    if position('library_nocam' in f.def) > 0 then continue; end if;   -- idempotent
    src := replace(f.def,
      'and (h.source is null or h.source <> ''rehide'')',
      'and (h.source is null or h.source not in (''rehide'', ''library_nocam''))');
    if src = f.def then
      raise exception 'feed_page overload % does not carry the expected source predicate', f.sig;
    end if;
    execute src;
    n := n + 1;
  end loop;
  raise notice 'feed_page overloads rewritten: %', n;
end $$;

-- ── VERIFIED AFTER APPLYING ──────────────────────────────────────────────────────────────────
--   select count(*), count(*) filter (where position('library_nocam' in prosrc) > 0)
--     from pg_proc where proname='feed_page';                         -> 6, 6
--   select count(*), count(*) filter (where h.source='library_nocam')
--     from feed_page(40, array[]::text[], array[]::text[]) f
--     join hides h on h.id = f.id;                                    -> 30, 0
--
-- TO REVERT: run the same loop with the two literals swapped. The predicate is the only thing
-- this touches.
