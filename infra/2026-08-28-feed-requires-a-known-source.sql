-- 2026-08-28 — THE FEED ADMITTED, BY NAME, EVERYTHING IT COULD NOT JUDGE
--
-- Applied to qpztlobbnjyjbxqyuzgg as migration 2026-08-28-feed-requires-a-known-source.
--
-- The screenshot filter added on 2026-08-27 reads `source`, and its first clause was
-- `h.source is null or ...`. That clause is right for the back catalogue: `source` was first
-- written on 2026-08-16 — 0% of public hides carry it on the 15th, 46.7% on the 16th, 99.7%
-- from the 17th — so every older hide has NULL and excluding them would have thrown away
-- thousands of good rounds for nothing.
--
-- It also admitted every hide made since. Normally that is 0.3-3% of a day and invisible.
-- Between 2026-08-26 18:00 and 2026-08-27 18:00 UTC it ran at 11-15%, and because the feed
-- serves least-played first those hides went to the top and stayed there: 22 of the top 30
-- slides were source-less, every one of them created after the 17th. Read from the app that
-- looks exactly like "the screenshot filter is not working". The filter was working. It was
-- being handed rows it had no way to judge, with instructions to let them pass.
--
-- ⚠️ THE CUTOFF IS THE WHOLE POINT — do not simplify this to `h.source is not null`. NULL
-- means "before the column existed" on one side of 2026-08-17 and "something went wrong" on
-- the other, and only the second is unsafe to show a stranger. Dropping the date turns a
-- 138-row exclusion into a several-thousand-row one.
--
-- `not in` yields NULL for a NULL source, so the second clause cannot re-admit them. The
-- reply exception is left alone on purpose: a reply is addressed to a person and earns its
-- slide on that, not on its photograph.
--
-- Rewritten by substitution rather than retyped, and guarded: every overload must carry the
-- predicate exactly once and there must be exactly six of them, or the whole migration
-- aborts. Six exists because the page deploys on push and the database does not.
--
-- NOT COVERED HERE, and worth its own decision: feed_best() — the proven-opener slide shown
-- ahead of the feed — carries no source filter at all, so the banger can still be a
-- screenshot. It is a different function with a different job; flagged, not changed.
do $mig$
declare
  r record;
  src text;
  hits int;
  n int := 0;
  old_pred constant text :=
    '(h.source is null or h.source not in (''rehide'', ''library_nocam'') or h.reply_to is not null)';
  new_pred constant text :=
    '((h.source is null and h.created_at < timestamptz ''2026-08-17'') or h.source not in (''rehide'', ''library_nocam'') or h.reply_to is not null)';
begin
  for r in
    select p.oid, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public' and p.proname = 'feed_page'
  loop
    src := pg_get_functiondef(r.oid);
    hits := (length(src) - length(replace(src, old_pred, ''))) / length(old_pred);
    if hits <> 1 then
      raise exception 'feed_page(%) carries the source predicate % time(s), expected exactly 1', r.args, hits;
    end if;
    execute replace(src, old_pred, new_pred);
    n := n + 1;
  end loop;
  if n <> 6 then
    raise exception 'expected 6 feed_page overloads, rewrote %', n;
  end if;
  raise notice 'feed_page: % overloads now require a known source after 2026-08-17', n;
end
$mig$;

-- Proof, run before and after. Before: 22 "(sans source)", 6 camera, 2 rehide.
-- After: 0 source-less, 21 rehide (the reply exception), 9 camera.
--
--   select coalesce(h.source,'(none)'), count(*)
--   from feed_page(30, '{}'::text[], '{}'::text[], 'probe') t
--   join hides h on h.id = t.id group by 1 order by 2 desc;

-- ─────────────────────────────────────────────────────────────────────────────
-- SAME DAY, SAME RULE, DIFFERENT FUNCTION: feed_best()
--
-- Applied as migration 2026-08-28-feed-best-same-source-rule.
--
-- feed_best() picks the slide shown AHEAD of the feed to someone who has never
-- published — the single best first impression the product gets to make. It
-- excluded rehides but not screenshots, and admitted an unknown source outright.
--
-- Its own gates make that MORE likely, not less: n_attempts >= 5 and n_found > 0,
-- and a screenshot is exactly the hide that gets found. A too-easy round scores
-- as a proven one, then goes to the front.
--
-- Written out rather than shared with feed_page: the two have different jobs and
-- one may need to diverge later, but they must not diverge by accident. Change
-- one, look at the other.
--
-- Measured before applying: 2497 candidates -> 2321, dropping 167 screenshots and
-- 9 recent source-less hides. The pool stays deep enough never to run dry.
create or replace function public.feed_best(p_limit integer, p_block_tags text[])
 returns table(id text, img_path text, name text, n_attempts integer, n_found integer, created_at timestamp with time zone, lqip text)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select h.id, h.img_path, h.name, h.n_attempts, h.n_found, h.created_at, h.lqip
  from hides h
  where h.is_public and not h.blocked and h.n_reported = 0
    and h.expires_at > now() and h.img_path is not null and h.img_path <> ''
    and coalesce(h.coverage, 100) >= 70
    and h.n_attempts >= 5
    and h.n_found > 0
    and ((h.source is null and h.created_at < timestamptz '2026-08-17') or h.source not in ('rehide', 'library_nocam') or h.reply_to is not null)
    and (h.author_tag is null or not (h.author_tag = any(coalesce(p_block_tags, '{}'))))
    and (h.author_tag is null or not exists (select 1 from shadowed_authors s where s.tag = h.author_tag))
  order by ((select coalesce(sum(r.n), 0)::int from hide_reactions r where r.hide_id = h.id)
     + case when h.n_found * 4 >= h.n_attempts and h.n_found * 4 <= h.n_attempts * 3 then 3 else 0 end
     - case when h.n_found * 5 >= h.n_attempts * 4 then 3 else 0 end
     - least(coalesce(h.n_skipped, 0) / 3, 4)) desc,
    h.created_at desc
  limit least(greatest(coalesce(p_limit, 1), 1), 10);
$function$;
