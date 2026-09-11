-- 2026-09-11 — A ROUND WITH SEVERAL PEOPLE IN IT.
--
-- ⚠️ NOT YET APPLIED. Apply through the dashboard SQL editor BEFORE the index.html that calls
-- these functions reaches main. The page climbs down to the older overloads when a new one
-- 404s, so a page deployed first loses nothing — but the board, the finders and the thread
-- simply do not exist until this runs. Mirror the "APPLIED <date>" line here once it has.
--
-- THE ASK. Founder, 2026-09-11: "il faut qu'on fasse un moyen que le joueur puisse jouer avec
-- plusieurs copains". The link already goes to several people at once — it is pasted into a
-- group chat — and every one of them plays one buzz on no clock, so the round itself was never
-- the problem. What was missing is that they could not SEE EACH OTHER: get_hide returns counts
-- (n_attempts, n_found, best_ms) and an attempt row carries coordinates, a time and a verdict,
-- never who was hunting. Three friends on one photo were "3 tried · 2 found" to the creator and
-- "faster than 50%" to each other.
--
-- FIVE ADDITIONS, ONE SHAPE. Every one is a new column with a default, a new function, or a new
-- overload; no function the live page already calls changes signature or return type. A page
-- loaded before this ran behaves exactly as it did.
--
--   1. attempts.device_key + attempts.who    — the seeker on the attempt, one row per person
--   2. submit_attempt(7 args)                — the overload that writes them
--   3. sign_attempt()                        — the name, added after the buzz
--   4. hide_board() + hide_finders()         — the podium, seeker side and creator side
--   5. hides.thread_id + thread_hides()      — the rally: every reply in a chain, for everyone
--                                              who played in it
--
-- ═══ 1. THE SEEKER ON THE ATTEMPT ════════════════════════════════════════════════════════════
--
-- device_key IS THE SAME IDENTITY seek_traces.device_key carries (2026-08-30): chDeviceId(),
-- already on every device, never the shared "w-nostore" sentinel. It is what makes "one line
-- per person" possible — a friend who opens the link twice is one row on the podium, not two.
-- It is READ BY NO BOARD AND RETURNED TO NO CLIENT; every function below groups on it and
-- prints `who`. The same rule the author key lives under.
--
-- who IS THE LOCAL HANDLE, unverified and not an account — the same string the seek trace has
-- carried since 2026-08-30 and the same string a hide is signed with. Narrowed at insert
-- exactly as create_hide narrows p_name: it is written on one person's device and rendered on
-- everybody else's.
alter table public.attempts add column if not exists device_key text;
alter table public.attempts add column if not exists who text;

create index if not exists attempts_hide_device_idx
  on public.attempts (hide_id, device_key) where device_key is not null;

-- ═══ 2. THE SEVENTH AND EIGHTH ARGUMENT ══════════════════════════════════════════════════════
--
-- A NEW OVERLOAD, NEVER AN EDIT — the rule this database runs on. The 5-argument form is left
-- byte-for-byte as it is: it is the rung the page falls back to during the deploy gap, and the
-- 4-argument form under it is the rung for pages older still. PostgREST resolves by the exact
-- key set sent, so adding keys is safe and changing one is an outage.
--
-- The body is the 5-argument body with two columns on the insert. The ranking, the old-find
-- walk and the counters are untouched; the seeker still sees the percentile they saw before.
create or replace function public.submit_attempt(p_id text, p_x real, p_y real, p_ms integer, p_v integer,
                                                 p_device text, p_who text)
returns table(hit boolean, tries integer, missed integer, secs integer,
              pct integer, others integer, scope text,
              old_round integer, old_name text, old_id text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  h public.hides%rowtype;
  v_hit boolean; v_tries int; v_found int;
  v_others int; v_worse int; v_ms int; v_scope text; v_pct int;
  v_old_round int; v_old_name text; v_old_id text;
  v_dev text; v_who text;
  MIN_FIELD constant int := 5;
begin
  select * into h from hides where id = p_id and not blocked and expires_at > now();
  if not FOUND then raise exception 'no such hide'; end if;

  v_ms := greatest(0, coalesce(p_ms, 0));
  v_hit := sqrt(power(p_x - h.cx, 2) + power(p_y - h.cy, 2)) <= h.r;

  -- Both unvalidated by construction: the caller is anon.
  v_dev := nullif(left(coalesce(p_device, ''), 64), '');
  v_who := nullif(left(regexp_replace(coalesce(p_who, ''), '[^A-Za-z0-9_.]', '', 'g'), 16), '');

  if not v_hit and h.reply_to is not null then
    with recursive chain(id, cx, cy, r, round, name, reply_to, depth) as (
      select p.id, p.cx, p.cy, p.r, p.round, p.name, p.reply_to, 1
        from hides p where p.id = h.reply_to
      union all
      select p.id, p.cx, p.cy, p.r, p.round, p.name, p.reply_to, c.depth + 1
        from hides p join chain c on p.id = c.reply_to
       where c.depth < 20
    )
    select c.round, c.name, c.id into v_old_round, v_old_name, v_old_id
      from chain c
     where sqrt(power(p_x - c.cx, 2) + power(p_y - c.cy, 2)) <= c.r
     order by c.round desc
     limit 1;
  end if;

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

  insert into attempts(hide_id, hit, ms, v, device_key, who)
  values (p_id, v_hit, v_ms, least(greatest(coalesce(p_v,2),2),9), v_dev, v_who);

  update hides h2
     set n_attempts = h2.n_attempts + 1,
         n_found    = h2.n_found + (case when v_hit then 1 else 0 end)
   where h2.id = p_id
   returning h2.n_attempts, h2.n_found into v_tries, v_found;

  if v_hit and v_others > 0 then v_pct := round(100.0 * v_worse / v_others)::int; end if;

  return query select v_hit, v_tries, (v_tries - v_found), h.secs, v_pct, v_others, v_scope,
                      v_old_round, v_old_name, v_old_id;
end $function$;

grant execute on function public.submit_attempt(text, real, real, integer, integer, text, text) to anon, authenticated;

-- ═══ 3. THE NAME, AFTER THE BUZZ ═════════════════════════════════════════════════════════════
--
-- Most seekers have no handle: it is minted on the first PUBLISH, and 63% of the people who
-- open KAMO open it on a link and never publish. So their row lands anonymous, and the podium
-- offers the name field only THEN — once there is a board with their row on it, which is the
-- one moment a stranger has a reason to type one. This stamps it onto the row already filed.
--
-- Keyed on (hide, device), and only onto rows that carry no name yet: a device can name its
-- own attempt once and can name nobody else's. A device that could not be identified at buzz
-- time (v_dev null) has no row this can reach, and gets nothing — never a guess.
create or replace function public.sign_attempt(p_id text, p_device text, p_who text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_who text; v_dev text;
begin
  v_dev := nullif(left(coalesce(p_device, ''), 64), '');
  v_who := nullif(left(regexp_replace(coalesce(p_who, ''), '[^A-Za-z0-9_.]', '', 'g'), 16), '');
  if v_dev is null or v_who is null then return; end if;
  update attempts a set who = v_who
   where a.hide_id = p_id and a.device_key = v_dev and a.who is null
     and exists (select 1 from hides h where h.id = p_id and not h.blocked and h.expires_at > now());
end $function$;

grant execute on function public.sign_attempt(text, text, text) to anon, authenticated;

-- ═══ 4. THE PODIUM ═══════════════════════════════════════════════════════════════════════════
--
-- hide_board: everyone who played THIS photo, one line per person, finders first and fastest
-- first among them. It is what the ending card prints under "Found in 4.1s" and what turns a
-- link in a group chat into a scoreboard the group is already on.
--
-- ONE LINE PER DEVICE, THE FIRST ONE. The first attempt is the real one — the round where the
-- answer was not yet known. A second buzz from the same device (the link opened again) is
-- neither a second player nor a better time. Rows with no device_key (every attempt filed
-- before this migration, and devices whose every store refused) stay one line each: the
-- database genuinely does not know whether they are one person or nine.
--
-- `me` IS THE ONLY THING THE CALLER'S DEVICE KEY BUYS, and the key itself never comes back:
-- the row it marks prints "you" on that one phone. `my_pos` rides on every row (it is one
-- number, and the shape is a table) so the card can say "3rd of 7" even when the third row is
-- not among the twenty returned. `root` is the thread this hide belongs to — see 5 — and is
-- how a seeker's device learns which rally it just joined.
--
-- ORDER IS THE SCORE. hit desc puts the finders on top; among them ms asc, with a clock that
-- never started (ms <= 0, 155 rows in the month to 08-25) ranked after every real time rather
-- than as a 0.0s world record; misses in the order they were filed. Twenty rows: a group chat
-- is a handful of people, and the feed's 400-player hides are not what this is for.
create or replace function public.hide_board(p_id text, p_device text default null)
returns table(root text, n_players integer, my_pos integer, pos integer,
              name text, hit boolean, ms integer, me boolean)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with h as (
    select x.id, coalesce(x.thread_id, x.id) as root
    from hides x
    where x.id = p_id and not x.blocked and x.expires_at > now()
  ),
  ranked as (
    select a.who, a.hit, a.ms, a.device_key, a.created_at,
           row_number() over (partition by a.device_key order by a.created_at) as nth
    from attempts a join h on a.hide_id = h.id
  ),
  players as (
    select * from ranked r where r.device_key is null or r.nth = 1
  ),
  board as (
    select p.who, p.hit, p.ms,
           (coalesce(p_device, '') <> '' and p.device_key = p_device) as me,
           row_number() over (order by p.hit desc,
                                       (case when p.hit and p.ms > 0 then p.ms end) asc nulls last,
                                       p.created_at asc)::int as pos
    from players p
  )
  select h.root,
         (select count(*) from board)::int                  as n_players,
         (select b2.pos from board b2 where b2.me limit 1)  as my_pos,
         b.pos, b.who as name, b.hit, b.ms, b.me
  from board b, h
  order by b.pos
  limit 20;
$function$;

grant execute on function public.hide_board(text, text) to anon, authenticated;

-- hide_finders: the creator's side of the same fact. The mine grid loops chMine() through
-- get_hide and gets counts; this answers "who" for all ten ids in one call, exactly as
-- my_reactions does, so a slow answer costs a missing name and never a missing grid.
-- NAMED FINDERS ONLY, THREE PER HIDE, FASTEST FIRST. An anonymous finder is already in
-- n_found; there is nothing to print for them. Three because it is a caption under a
-- thumbnail, not a table.
create or replace function public.hide_finders(p_ids text[])
returns table(hide_id text, name text, ms integer)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select x.hide_id, x.who, x.ms
  from (
    select a.hide_id, a.who, min(a.ms)::int as ms,
           row_number() over (partition by a.hide_id order by min(a.ms)) as n
    from attempts a
    join hides hh on hh.id = a.hide_id
    where a.hide_id = any(coalesce(p_ids, '{}'))
      and a.hit
      and coalesce(a.who, '') <> ''
      and not hh.blocked and hh.expires_at > now()
    group by a.hide_id, a.who
  ) x
  where x.n <= 3
  order by x.hide_id, x.n;
$function$;

grant execute on function public.hide_finders(text[]) to anon, authenticated;

-- ═══ 5. THE RALLY ════════════════════════════════════════════════════════════════════════════
--
-- "Challenge back" delivers a reply to ONE person: the creator of the hide it answers, through
-- my_replies. In a group of four that is the wrong audience — when B answers A's photo, C and
-- D played that photo too and are the people B is actually playing with. The chain through
-- reply_to already exists (every reply names its parent, and `round` counts the depth); what
-- it lacks is a name for the WHOLE chain that anyone in it can ask for.
--
-- thread_id IS THE ROOT OF THE CHAIN — the first hide, the one that was pasted into the chat.
-- NULL on a root (a hide that answers nobody is its own thread and does not need to say so),
-- the root's id on every reply under it. Set by a trigger rather than by a seventeenth
-- create_hide argument: it is derived entirely from reply_to, which the row already carries,
-- and a trigger reaches every overload at once without editing any of them.
alter table public.hides add column if not exists thread_id text;

create index if not exists hides_thread_idx on public.hides (thread_id) where thread_id is not null;

create or replace function public.set_hide_thread()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if NEW.reply_to is not null and NEW.thread_id is null then
    select coalesce(p.thread_id, p.id) into NEW.thread_id from hides p where p.id = NEW.reply_to;
  end if;
  return NEW;
end $function$;

-- BEFORE the AFTER INSERT notify trigger, by kind, not by name — a BEFORE trigger always runs
-- first, so the row the push reads already carries its thread.
drop trigger if exists trg_hide_thread on public.hides;
create trigger trg_hide_thread
  before insert on public.hides
  for each row execute function set_hide_thread();

-- THE ROWS THAT ALREADY EXIST. Walked from every root down; a reply whose parent has expired
-- (no FK, by design — see 2026-08-13-reply.sql) is never reached and stays NULL, which is the
-- honest answer: its thread is gone. Depth-capped like the old-find walk, for the same reason.
with recursive c(id, root, depth) as (
  select r.id, r.id, 1 from hides r where r.reply_to is null
  union all
  select k.id, c.root, c.depth + 1 from hides k join c on k.reply_to = c.id where c.depth < 30
)
update hides h set thread_id = c.root
  from c
 where h.id = c.id and h.reply_to is not null and h.thread_id is null;

-- thread_hides: everything in one rally, newest first, for anyone who holds the root id.
--
-- THE TRUST MODEL IS my_replies', ONE STEP WIDER, AND DELIBERATELY SO. my_replies answers for
-- ids the caller PUBLISHED; this answers for a root the caller PLAYED — and the root id is
-- exactly what every member of the group was sent. A reply in a thread is therefore visible to
-- the whole thread, not only to the person it answers. That is the feature: it is the
-- difference between a rally and a stack of private messages. What it does not widen: the
-- answer (cx, cy, r) is still never on the wire, a blocked or expired hide is still invisible,
-- and nothing here returns an author key or a device key.
--
-- THE ROOT ITSELF IS IN THE LIST, so a device that joined late can play the photo everyone
-- else already played; the client dims what it has already seen, as it does for replies.
create or replace function public.thread_hides(p_root text)
returns table(id text, reply_to text, name text, img_path text, round integer,
              n_attempts integer, n_found integer, created_at timestamptz)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select h.id, h.reply_to, h.name, h.img_path, h.round, h.n_attempts, h.n_found, h.created_at
  from hides h
  where (h.id = p_root or h.thread_id = p_root)
    and not h.blocked
    and h.expires_at > now()
    and h.img_path is not null and h.img_path <> ''
  order by h.created_at desc
  limit 30;
$function$;

grant execute on function public.thread_hides(text) to anon, authenticated;

-- ═══ WHAT THIS DOES NOT DO ═══════════════════════════════════════════════════════════════════
-- The "someone found your hide" push still says "Someone": the AFTER INSERT trigger on
-- attempts and push_dispatch_payload live only in the dashboard, not in this directory, and a
-- blind rewrite of a function whose source is not in version control is how a notification
-- pipeline dies silently. Now that `who` is on the row, that is a one-line change to make from
-- the dashboard with the real source in front of you: read attempts.who in the payload and let
-- edge-notify-creator.ts print it.
