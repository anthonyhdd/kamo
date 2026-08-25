-- PUSH PRIORITY: not every event is worth the same hour.
-- Applied to qpztlobbnjyjbxqyuzgg on 2026-08-25. Kept here because infra/ is where this
-- database's schema lives in version control — the migration ran through the MCP, this file
-- is the record and the thing to re-read before touching the throttle again.
--
-- WHY. The three notify_hide_* triggers each carried their own copy of one rule: "nothing if
-- this hide was notified in the last hour". That treats every event as equal. Measured over
-- 4214 authors, creating again on a second day runs at:
--
--     47.4%  after a REPLY      (736 authors)
--     44.6%  after a REACTION   (675)
--     28.4%  after being PLAYED (3691)
--     25.6%  baseline
--     21.0%  when nothing came back at all
--
-- A hide takes ~3 attempts, so the cheap signal routinely arrives first and spends the hour,
-- and the two signals that actually bring somebody back are dropped in silence.
--
-- WHAT. found(1) < reaction(2) < reply(3). Inside the hour only a STRICTLY stronger kind may
-- speak; outside it, anything may. Two minutes is the floor nothing crosses — priority without
-- one would put two buzzes about the same hide on a lock screen seconds apart, which is how an
-- app gets its notifications turned off for good.
--
-- NULL last_notified_kind reads as 'found': the safe default, and the true one for rows that
-- predate the column (1861 of ~1951 hides ever notified were found).
--
-- WHAT THIS DOES NOT FIX. The binding constraint is not the throttle, it is the token: only
-- 3370 of 18682 hides carry a push_token, so 721 reactions and 771 replies could not be
-- announced at all. That is the notification permission, and it is fixed on the client.

alter table public.hides add column if not exists last_notified_kind text;

create or replace function public.push_rank(p_kind text)
returns int language sql immutable as $$
  select case coalesce(p_kind, 'found')
    when 'reply'    then 3
    when 'reaction' then 2
    else 1
  end;
$$;

-- STABLE, not IMMUTABLE: it reads now(). Marked wrong, Postgres is free to fold it to a
-- constant and the throttle silently stops throttling.
create or replace function public.push_may_notify(
  p_last timestamptz, p_last_kind text, p_kind text)
returns boolean language sql stable as $$
  select case
    when p_last is null                        then true
    when p_last > now() - interval '2 minutes' then false
    when p_last > now() - interval '1 hour'
      then public.push_rank(p_kind) > public.push_rank(p_last_kind)
    else true
  end;
$$;

-- The three trigger bodies are otherwise untouched: same SECURITY DEFINER, same search_path,
-- same 09:00-22:00 local window, same swallow-into-private.push_log posture, same http bodies.
-- Only the throttle test and the stamp move. See the live definitions with:
--   select pg_get_functiondef(oid) from pg_proc where proname like 'notify_hide_%';
