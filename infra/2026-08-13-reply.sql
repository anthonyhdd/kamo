-- APPLIED 2026-08-13 to Supabase project qpztlobbnjyjbxqyuzgg.
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
  v_id := encode(gen_random_bytes(8), 'hex');
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
