-- APPLIED 2026-08-13 to Supabase project qpztlobbnjyjbxqyuzgg.
--
-- ⚠️ THE ID LINE IS gen_random_uuid(), NOT gen_random_bytes(). The first version of this
-- overload used gen_random_bytes(), which lives in the `extensions` schema — and every
-- create_hide sets `search_path TO 'public'`, so it raised "function gen_random_bytes(integer)
-- does not exist" on EVERY reply. Worse than a plain error: chUpload()'s fallback ladder would
-- have caught the throw and quietly published the 9-argument form, so replies would have gone
-- out looking normal with no reply_to, no notification, and no reply on anyone's card — the
-- feature failing completely and silently while every screen said it had worked. The other
-- three overloads have always used gen_random_uuid(). Copy the existing line; do not invent an
-- equivalent one.
--
-- SENDING ONE BACK, WITHOUT ASKING WHO TO SEND IT TO.
--
-- iOS never tells us who a share went to, and there is no API to message a contact the user
-- has not picked. But the recipient of a reply is not an unknown contact — it is the creator
-- of the hide that was just played, and we already hold their handle and (sometimes) their
-- push address. So the reply is delivered by us, not by iOS: zero taps, no contact picker.
--
-- The column is the mechanism; the push is only the accelerant. 24 of 3191 hides carry a push
-- token (it only exists on builds after 1.1.0, and only once the notification opt-in has been
-- spent), so a reply that existed ONLY as a notification would reach ~3% of creators. Stored
-- as a row, it reaches 100% of them the next time they open the app — see my_replies() and
-- chReplyCheck() in index.html.

alter table public.hides add column if not exists reply_to text;

-- No FK: hides are deleted wholesale at 30 days (expires_at) and a reply must not be blocked
-- by, or cascade from, the expiry of the hide it answers. A dangling reply_to is readable and
-- harmless — my_replies simply stops matching it.
create index if not exists hides_reply_to_idx on public.hides (reply_to) where reply_to is not null;

-- A FOURTH OVERLOAD, NEVER AN EDIT. This repo's rule, and it is load-bearing: index.html
-- deploys on push and the database does not, so during a rollout both are live and a page
-- loaded a minute ago still calls the 6-, 8- or 9-argument form. PostgREST resolves by the
-- exact set of keys sent, so adding a key is safe and changing one is an outage.
create or replace function public.create_hide(
  p_img_path text, p_cx real, p_cy real, p_r real, p_secs integer, p_coverage integer,
  p_limit_s integer, p_max_taps integer, p_name text, p_reply_to text)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_id text; v_name text;
begin
  v_id := substr(replace(gen_random_uuid()::text, '-', ''), 1, 16);
  -- Narrowed here as well as in the page: this string is rendered on a stranger's device.
  v_name := nullif(regexp_replace(coalesce(p_name, ''), '[^A-Za-z0-9_.]', '', 'g'), '');
  insert into hides (id, img_path, cx, cy, r, secs, coverage, limit_s, max_taps, name, reply_to)
  values (v_id, p_img_path, p_cx, p_cy, p_r, p_secs, p_coverage, p_limit_s, p_max_taps,
          left(v_name, 16),
          -- Only a reply to a hide that exists. A forged id would otherwise let anyone put a
          -- notification on a stranger's lock screen.
          (select h.id from hides h where h.id = p_reply_to));
  return v_id;
end $function$;

-- WHAT CAME BACK, for a device that has no account. The caller passes the ids it remembers
-- publishing (chMine(), capped at ten); the server answers with the replies to them. Same
-- trust model as get_hide and report_hide: the ids are 16 random hex characters that only ever
-- existed on the creator's device and in links they chose to send.
create or replace function public.my_replies(p_ids text[])
returns table(id text, reply_to text, name text, img_path text, created_at timestamptz)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select r.id, r.reply_to, r.name, r.img_path, r.created_at
  from hides r
  where r.reply_to = any(coalesce(p_ids, '{}'))
    and not r.blocked
    and r.expires_at > now()
  order by r.created_at desc
  limit 20;
$function$;

grant execute on function public.create_hide(text, real, real, real, integer, integer, integer, integer, text, text) to anon, authenticated;
grant execute on function public.my_replies(text[]) to anon, authenticated;

-- THE PUSH, ON THE SAME RAILS AS "someone found your hide".
-- Deliberately a sibling of notify_hide_creator rather than a second pipeline: same
-- private.push_config secret, same one-per-hour throttle, same 09:00–22:00 local window, same
-- swallow-and-log posture so a notification can never fail a publish. The throttle and the
-- quiet hours are read off the hide being ANSWERED — the person about to be woken — not off
-- the reply.
create or replace function public.notify_hide_reply()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  orig public.hides%rowtype;
  v_url text;
  v_secret text;
  v_local_hour int;
begin
  if NEW.reply_to is null then return NEW; end if;

  select * into orig from hides where id = NEW.reply_to;
  if not found or orig.push_token is null then return NEW; end if;

  if orig.last_notified_at is not null and orig.last_notified_at > now() - interval '1 hour' then
    return NEW;
  end if;

  v_local_hour := extract(hour from (now() at time zone 'UTC') + make_interval(mins => coalesce(orig.push_tz_offset, 0)));
  if v_local_hour >= 22 or v_local_hour < 9 then return NEW; end if;

  select value into v_url    from private.push_config where key = 'function_url';
  select value into v_secret from private.push_config where key = 'shared_secret';
  if v_url is null or v_secret is null then return NEW; end if;

  update hides set last_notified_at = now() where id = orig.id;

  -- hide_id is the ORIGINAL: it is the row holding the push token, and push_dispatch_payload
  -- is keyed on it. reply_id travels alongside so a future build can open the answer directly.
  perform net.http_post(
    url     := v_url,
    body    := jsonb_build_object('hide_id', orig.id, 'kind', 'reply',
                                  'reply_id', NEW.id, 'from_name', NEW.name),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-kamo-secret', v_secret),
    timeout_milliseconds := 5000
  );
  return NEW;
exception when others then
  begin
    insert into private.push_log(hide_id, error) values (NEW.id, left('reply: ' || SQLERRM, 500));
    delete from private.push_log where id < (select max(id) - 500 from private.push_log);
  exception when others then null;
  end;
  return NEW;
end $function$;

drop trigger if exists trg_notify_hide_reply on public.hides;
create trigger trg_notify_hide_reply
  after insert on public.hides
  for each row execute function notify_hide_reply();


-- ============================================================================================
-- ROUND TWO OF THE SAME DAY: SIX ROUNDS, SIX FIGURES, AND FIVE OF THEM SCORED AS WRONG.
--
-- "Send one back" hands the answered hide's own camouflaged JPEG to the next round, because the
-- figure painted into it is invisible by construction and the image can carry another. True for
-- round two. By round six the photo holds six hidden people and submit_attempt tests the tap
-- against exactly one of them — so a player who correctly spots a camouflaged figure is told
-- they missed. In a hide-and-seek game that is the worst feedback available, and it gets more
-- likely the longer a chain runs: it lands hardest on the most engaged players.
--
-- The fix is not to forbid the accumulation. It is to recognise it: the chain is a linked list
-- through reply_to and every link carries its own answer key, so an "old" find can be named.
-- Applied as migration `reply_rounds_and_old_finds`. The DDL is reproduced here in full
-- rather than referenced: this directory is the only record of this database that lives in
-- version control, and a pointer to a migration name in a dashboard is not a record.

alter table public.hides add column if not exists round integer not null default 1;

-- Depth computed once at insert rather than walked on every read: a chain is read far more
-- often than it is extended, and a recursive CTE per seeker load is a cost paid forever to
-- avoid storing one integer.
create or replace function public.create_hide(
  p_img_path text, p_cx real, p_cy real, p_r real, p_secs integer, p_coverage integer,
  p_limit_s integer, p_max_taps integer, p_name text, p_reply_to text)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_id text; v_name text; v_parent text; v_round int := 1;
begin
  v_id := substr(replace(gen_random_uuid()::text, '-', ''), 1, 16);
  v_name := nullif(regexp_replace(coalesce(p_name, ''), '[^A-Za-z0-9_.]', '', 'g'), '');
  select h.id, h.round + 1 into v_parent, v_round from hides h where h.id = p_reply_to;
  insert into hides (id, img_path, cx, cy, r, secs, coverage, limit_s, max_taps, name,
                     reply_to, round)
  values (v_id, p_img_path, p_cx, p_cy, p_r, p_secs, p_coverage, p_limit_s, p_max_taps,
          left(v_name, 16), v_parent, coalesce(v_round, 1));
  return v_id;
end $function$;

-- get_hide is DROPPED to gain a column: Postgres cannot widen a set-returning function's row
-- type in place. Safe in the deploy gap either way — a page loaded a minute ago reads the
-- columns it knows and ignores `round`.
drop function if exists public.get_hide(text);
create function public.get_hide(p_id text)
returns table(img_path text, secs integer, n_attempts integer, n_found integer,
              limit_s integer, max_taps integer, name text, found_tap integer,
              burned boolean, sent boolean, round integer)
language sql
stable
security definer
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
    h.round
  from hides h
  where h.id = p_id and not h.blocked and h.expires_at > now()
    and coalesce(h.coverage, 100) >= 30;
$function$;

-- Same drop-and-recreate, same reason. The 4-argument form is deliberately left alone: it is
-- the fallback the page uses when this one 404s mid-deploy, and it must keep answering the old
-- shape.
drop function if exists public.submit_attempt(text, real, real, integer, integer);
create function public.submit_attempt(p_id text, p_x real, p_y real, p_ms integer, p_v integer)
returns table(hit boolean, tries integer, missed integer, secs integer,
              pct integer, others integer, scope text,
              old_round integer, old_name text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  h public.hides%rowtype;
  v_hit boolean; v_tries int; v_found int;
  v_others int; v_worse int; v_ms int; v_scope text; v_pct int;
  v_old_round int; v_old_name text;
  MIN_FIELD constant int := 5;   -- below this the hide's own field is noise, not a ranking
begin
  select * into h from hides where id = p_id and not blocked and expires_at > now();
  if not FOUND then raise exception 'no such hide'; end if;

  v_ms := greatest(0, coalesce(p_ms, 0));
  v_hit := sqrt(power(p_x - h.cx, 2) + power(p_y - h.cy, 2)) <= h.r;

  /* THE TAP THAT FOUND THE WRONG PERSON. Only on a miss, and only up the chain: the answer for
     THIS round is untouched, so nothing here can turn a miss into a hit or leak where the
     current figure is. All it can do is name a figure the player has already found with their
     own eyes — the difference between "wrong" and "wrong one".
     Deepest ancestor first: the most recent one is the likeliest thing they were looking at.
     The depth cap is a cycle guard — reply_to can only point at a row that already existed, so
     a loop should be impossible, and "should be impossible" is not a reason to let recursion
     run unbounded inside a function on the tap path. */
  if not v_hit and h.reply_to is not null then
    with recursive chain(id, cx, cy, r, round, name, reply_to, depth) as (
      select p.id, p.cx, p.cy, p.r, p.round, p.name, p.reply_to, 1
        from hides p where p.id = h.reply_to
      union all
      select p.id, p.cx, p.cy, p.r, p.round, p.name, p.reply_to, c.depth + 1
        from hides p join chain c on p.id = c.reply_to
       where c.depth < 20
    )
    select c.round, c.name into v_old_round, v_old_name
      from chain c
     where sqrt(power(p_x - c.cx, 2) + power(p_y - c.cy, 2)) <= c.r
     order by c.round desc
     limit 1;
  end if;

  -- Ranked BEFORE the insert, so "others" is everyone who played before me.
  select count(*),
         count(*) filter (where (not a.hit) or (a.hit and a.ms > v_ms))
    into v_others, v_worse
  from attempts a where a.hide_id = p_id and a.v >= 2;

  if v_others >= MIN_FIELD then
    v_scope := 'hide';
  else
    v_scope := 'all';
    select count(*),
           count(*) filter (where (not a.hit) or (a.hit and a.ms > v_ms))
      into v_others, v_worse
    from attempts a where a.v >= 2;
  end if;

  insert into attempts(hide_id, hit, ms, v) values (p_id, v_hit, v_ms, least(greatest(coalesce(p_v,2),2),9));

  update hides h2
     set n_attempts = h2.n_attempts + 1,
         n_found    = h2.n_found + (case when v_hit then 1 else 0 end)
   where h2.id = p_id
   returning h2.n_attempts, h2.n_found into v_tries, v_found;

  if v_hit and v_others > 0 then v_pct := round(100.0 * v_worse / v_others)::int; end if;

  return query select v_hit, v_tries, (v_tries - v_found), h.secs, v_pct, v_others, v_scope,
                      v_old_round, v_old_name;
end $function$;

grant execute on function public.get_hide(text) to anon, authenticated;
grant execute on function public.submit_attempt(text, real, real, integer, integer) to anon, authenticated;
