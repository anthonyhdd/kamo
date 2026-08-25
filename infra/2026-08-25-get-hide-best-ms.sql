-- APPLIED TO PRODUCTION 2026-08-25 (migration `get_hide_best_ms`).
-- Supabase has no review gate: this file is the record, not the deployment.
--
-- THE HIDE'S OWN RECORD, so its maker can be told something about it that is worth
-- repeating. get_hide already carries n_attempts / n_found — how many played and how many
-- won — but not the one number that turns a count into a story: how fast the best of them
-- was. Everything else on this row is a tally; this is a performance, and it is what makes
-- "2 of 7 have found it — fastest 4.1s" a sentence somebody sends on.
--
-- ONLY A HIT COUNTS, AND ONLY A POSITIVE ONE. A miss carries an `ms` too and it measures the
-- time spent failing, which is not the same thing; and 155 hit rows in the 30 days to
-- 2026-08-25 carry ms <= 0 (a clock that never started), which would make every one of those
-- hides claim a record of 0.0s. NULL when nobody has found it — 44% of played hides — which
-- the client reads as "no record yet" rather than as a zero. chBestS() tests the return, not
-- the field, for exactly this reason.
--
-- DROP AND CREATE, because RETURNS TABLE is part of the signature and CREATE OR REPLACE
-- cannot widen it. One transaction, so there is no window where get_hide does not exist.
-- Adding a column is backward compatible for every client already in the field: PostgREST
-- hands back the extra key and an older index.html never looks at it.
drop function if exists public.get_hide(text);

create or replace function public.get_hide(p_id text)
 returns table(img_path text, secs integer, n_attempts integer, n_found integer,
               limit_s integer, max_taps integer, name text, found_tap integer,
               burned boolean, sent boolean, round integer, best_ms integer)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select h.img_path, h.secs, h.n_attempts, h.n_found, h.limit_s, h.max_taps, h.name,
    (select cnt from (
       select count(*)::int as cnt
       from attempts a
       where a.hide_id = h.id
         and a.created_at <= (select min(a2.created_at) from attempts a2
                              where a2.hide_id = h.id and a2.hit)
     ) t where exists (select 1 from attempts a3 where a3.hide_id = h.id and a3.hit)
    ) as found_tap,
    (not exists (select 1 from attempts a4 where a4.hide_id = h.id and a4.hit)
     and (select count(*) from attempts a5 where a5.hide_id = h.id) >= coalesce(h.max_taps, 5)
    ) as burned,
    (h.sent_at is not null) as sent,
    h.round,
    (select min(a6.ms)::int from attempts a6
     where a6.hide_id = h.id and a6.hit and a6.ms > 0) as best_ms
  from hides h
  where h.id = p_id and not h.blocked and h.expires_at > now()
    and coalesce(h.coverage, 100) >= 30
    -- the photo is in the bucket, or it is new enough that it still might be
    and (h.created_at > now() - interval '3 minutes'
         or exists (select 1 from storage.objects o
                    where o.bucket_id = 'hides' and o.name = h.img_path));
$function$;

grant execute on function public.get_hide(text) to anon, authenticated;

-- Verified against live rows straight through the function:
--   a hide with 673 attempts / 415 found -> best_ms 998
--   a hide with  35 attempts /   0 found -> best_ms null
