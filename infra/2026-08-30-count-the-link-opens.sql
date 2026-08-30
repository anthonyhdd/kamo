-- 2026-08-30 — A ROW WHEN A CHALLENGE LINK OPENS, NOT ONLY WHEN ITS ROUND ENDS
--
-- seek_traces is written by sendTrace(), which runs on 'hit', 'miss' and 'giveup' — ENDINGS.
-- Somebody who opens a friend's challenge, looks at the photograph and leaves writes nothing at
-- all. So "46% of sent hides were opened" was really "46% were opened AND played to a finish":
-- a floor, and it was being read as an open rate. The send loop is this product's only free
-- acquisition and its middle step had no number.
--
-- ⚠️ NO FOREIGN KEY TO hides, DELIBERATELY. attempts and seek_traces had theirs dropped on
-- 2026-08-26 because the nightly purge would otherwise destroy the evidence behind every
-- retention figure — computed over exactly the window being purged. The whole point of this
-- table is to outlive the hide it describes.
--
-- ⚠️ THE HARD PART IS NOT WRITING THE ROW, IT IS TRUSTING IT. The browser population here is
-- ~89% automated: Amplitude's seek_opened{src:link} reported 3157 uniques on 2026-08-29 against
-- 191 challenges actually sent — sixteen opens per link — and the filters that would clean it
-- (host, wd) do not apply through that API. So three discriminators ride every row and the
-- QUERY decides rather than the writer:
--     wd          navigator.webdriver. Headless Chrome sets it; a stealth framework does not.
--     host        'app' or 'browser'. A challenge opened inside the wrapper is a person.
--     device_key  null when every store refused, which is most crawlers and few humans.
-- None is proof alone. Together they are the difference between a number with a caveat and a
-- number with no meaning. scripts/test-buzz-dom asserts wd:true from Playwright — the harness is
-- an automated browser, so it is the positive control for the flag that has to work.

create table if not exists public.link_opens (
  id          bigserial primary key,
  hide_id     text        not null,
  device_key  text,
  wd          boolean     not null default false,
  host        text,
  created_at  timestamptz not null default now()
);

create index if not exists link_opens_hide on public.link_opens (hide_id);
create index if not exists link_opens_day  on public.link_opens (created_at);
create index if not exists link_opens_dev  on public.link_opens (device_key, created_at)
  where device_key is not null;

alter table public.link_opens enable row level security;
-- No policies and NO table grants to anon: RLS with no policy is default-deny, so this is
-- reachable only through the SECURITY DEFINER function below.
-- ⚠️ seek_traces was set up the other way — RLS on, no policies, but anon holding every grant
-- from INSERT to TRUNCATE. Inert today and one `disable row level security` from being the
-- internet's table. Not repeating that here.

create or replace function public.log_link_open(p_id text, p_dev text, p_wd boolean, p_host text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not exists (select 1 from hides where id = p_id and not blocked and expires_at > now()) then return; end if;
  -- Same spirit as save_seek_trace's 200: a hide with more opens than that is a crawler, and the
  -- measurement does not improve past it. Silently drop — fire-and-forget telemetry must never
  -- surface in a seeker's console.
  if (select count(*) from link_opens where hide_id = p_id) >= 200 then return; end if;
  insert into link_opens(hide_id, device_key, wd, host)
  values (p_id,
          nullif(left(coalesce(p_dev, ''), 64), ''),
          coalesce(p_wd, false),
          nullif(left(coalesce(p_host, ''), 16), ''));
end
$function$;

grant execute on function public.log_link_open(text, text, boolean, text) to anon, authenticated;

-- ⚠️ LINK ROUNDS ONLY, and the client enforces it. A feed slide is the same chSeek() screen, so
-- the call sits one `if (!FEED)` away from firing on every slide — and at ~4900 feed rounds a day
-- against ~190 sends that is 26 parts noise to one part signal, in a table built to answer a
-- question about the signal. scripts/test-feed-dom asserts a feed session writes none.
--
-- ⚠️ APPLIED BEFORE index.html WAS PUSHED. A page calling a function PostgREST does not have yet
-- does not degrade — it 404s and the row is lost outright.
