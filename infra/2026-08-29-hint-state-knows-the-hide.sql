-- 2026-08-29 — THE PAGE CAN FINALLY ASK WHETHER *THIS* HIDE HAS A HINT AT ALL
--
-- Applied as 2026-08-29-hint-state-knows-the-hide.
--
-- Founder, live: "I tapped free hint, it didn't launch, and the hint button disappeared."
--
-- Correct server behaviour meeting a client that could not know about it. hint_region()
-- returns NULL when coalesce(r, 0.06) >= 0.22 — a kamo too big for a hint zone, because the
-- zone (greatest(0.15, r + 0.09)) would swallow the figure and point straight at it.
-- hint_spend() then answers 'hide_too_easy' and the page retires the button.
--
-- ⚠️ THAT IS NOT A RARE PATH. Over the eight days to 2026-08-29, the share of hides published
-- each day with r >= 0.22 ran between 23% and 39% — roughly ONE IN THREE:
--
--   21/08  33.7%    24/08  23.1%    27/08  38.7%
--   22/08  30.6%    25/08  28.9%    28/08  30.8%
--   23/08  30.2%    26/08  39.4%    29/08  27.4%
--
-- The button was offered on all of them, and the only way to discover it could not work was to
-- spend a tap, wait for a round trip, watch nothing appear and see the control vanish. On a
-- FREE hint that reads as "I just burned my one for today". It does not — hint_spend returns
-- before it touches the wallet — and nothing on screen said so.
--
-- The honest fix is not better wording on a refusal, it is not offering what cannot work.
-- hint_state gains an overload that takes the hide, so the button is never mounted on a round
-- with no hint to give. Same source of truth the spend uses, so the two cannot disagree.
--
-- ⚠️ ADDED, NEVER CHANGED. The one-argument form is untouched: this page deploys on push and
-- the database does not, so during a deploy a tab loaded a minute ago is still calling it. The
-- client reads only a DEFINITE false — an absent `hintable` is an older server answering, and
-- treating a missing field as a refusal would take hints away from everybody for the length of
-- a deploy, which is a far worse trade than the bug being fixed.
--
-- ⚠️ AND `hintable` LEAKS NOTHING. It is a boolean about the SIZE of the figure, not its place —
-- the same fact the hint zone already publishes by existing. cx/cy stay behind reveal_hide,
-- after the round is over.
create or replace function public.hint_state(p_owner text, p_hide_id text)
 returns json
 language sql
 security definer
 set search_path to 'public'
as $function$
  select json_build_object(
    'balance', coalesce((select w.balance from public.hint_wallet w where w.owner = p_owner), 0),
    'free_available',
      coalesce((select w.free_claimed_on from public.hint_wallet w where w.owner = p_owner), date '1970-01-01')
        <> (now() at time zone 'utc')::date,
    'hintable', public.hint_region(p_hide_id) is not null
  );
$function$;

-- The population this was measured on, kept so the next reader does not have to rebuild it:
--
--   select date(created_at) as day, count(*) as hides,
--          count(*) filter (where coalesce(r, 0.06) >= 0.22) as no_hint_possible,
--          round(100.0 * count(*) filter (where coalesce(r, 0.06) >= 0.22) / count(*), 1) as pct
--   from hides where created_at >= now() - interval '8 days' and source is not null
--   group by 1 order by 1;
--
-- ⚠️ If that share ever falls near zero, something has changed the FIGURE SIZE, not the hint —
-- and chKeepOnBoard, the capture scale and the v2 body are where to look, not here.
