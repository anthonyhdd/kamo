-- ═══ ONE ANONYMOUS TAP IS NOT A VERDICT ══════════════════════════════════════════════════════
--
-- Founder, 2026-10-09: « après 5 swipes il n'y avait plus d'image ». Measured that evening:
-- feed_page could serve EIGHT hides in total. Not eight per page — eight, out of 1 070 live
-- public camera hides from the last 30 days.
--
-- The funnel (public, camera/library_cam/library, last 30 days):
--
--     1 828 public  →  1 070 never reported  →  559 after coverage/conceal/dark  →  8 after shadow
--
-- Two filters did that, and they are the same filter twice:
--
--   • `n_reported = 0` — ONE report pulls a photo for everybody. 758 of 1 828 (41%) carried one.
--   • shadowed_authors — two hides with ≥1 report and the whole author is gone. 1 258 tags,
--     329 of the 975 authors with a live public hide, and they are the prolific ones: they held
--     551 of the 559 photos that survived everything else.
--
-- WHY 41%: the ⚑ in the feed bar is a one-tap control that ALSO drops the slide and moves to
-- the next one. Players use it as "next". The burst starts on 2026-08-29 (66 authors shadowed
-- that day, 156 the next, against 2-8 a day before). A report has no reporter identity, so one
-- player skipping their way through the feed removes every photo they skip, for everyone, and
-- after two skips on the same author, every photo that author will ever post.
--
-- ── THE CHANGE ────────────────────────────────────────────────────────────────────────────────
--
--   • A hide leaves the feed at TWO reports, not one. The reporter never sees it again either
--     way — the client drops it on the tap (drop(id) / onReported), so the person who reported
--     loses nothing. `blocked` still trips at three, unchanged.
--   • An author is shadowed when TWO of their hides carry TWO reports each — the 2026-08-13
--     rule ("a pattern of two is the difference between an unlucky photo and a person"), with
--     a report meaning two people instead of one tap.
--   • shadowed_authors is recomputed under that rule. The old rows are copied to
--     shadowed_authors_backup_20261009 first, so reverting is an insert-select.
--
-- Result measured right after: feed-eligible hides 8 → ~1 285. The dark cut (lqip_mean >= 40,
-- founder 2026-09-19), the source cut and the conceal cut are untouched.
--
-- ⚠️ THE TRADE-OFF, said plainly: a genuinely bad photo now needs a second report before it
-- leaves strangers' feeds. That is the standard shape of report-based moderation, and with 41%
-- of photos carrying one report the single report had stopped meaning anything. If the ⚑ ever
-- stops being used as "next" (confirm sheet, a real skip control), the threshold can go back
-- to one by swapping the two predicates below.
--
-- Applied 2026-10-09 (in three steps: backup + report_hide, the shadow recompute, then the feed predicates — the single-transaction version timed out through the MCP). Measured after: 1 258 shadowed tags → 0, feed-eligible hides 8 → 1 285.

create table if not exists public.shadowed_authors_backup_20261009 as
  select * from public.shadowed_authors;

create or replace function public.report_hide(p_id text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_tag text; v_n integer;
begin
  update hides set n_reported = n_reported + 1,
                   blocked = (n_reported + 1) >= 3
   where id = p_id
   returning author_tag into v_tag;

  if v_tag is null then return; end if;

  -- Hides of this author that TWO reports have reached, not one tap.
  select count(*) into v_n from hides h
   where h.author_tag = v_tag and h.n_reported >= 2;

  if v_n >= 2 then
    insert into shadowed_authors(tag, hides_reported) values (v_tag, v_n)
    on conflict (tag) do update set hides_reported = excluded.hides_reported;
  end if;
end $function$;

-- Recompute the shadow list under the new rule.
delete from public.shadowed_authors s
 where (select count(*) from public.hides h
         where h.author_tag = s.tag and h.n_reported >= 2) < 2;

-- Every feed function, every overload — same discipline as the 09-18/09-19 files: a feed
-- function this cannot reach fails the migration instead of leaving clients on the old rule.
do $mig$
declare
  r      record;
  src    text;
  n      int := 0;
  missed text[] := '{}';
  old_pred constant text := 'h.n_reported = 0';
  new_pred constant text := 'h.n_reported < 2';
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
  if array_length(missed, 1) > 0 then
    raise exception 'feed functions without the report predicate: %', missed;
  end if;
  raise notice 'feed functions updated: %', n;
end $mig$;
