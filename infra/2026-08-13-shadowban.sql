-- APPLIED 2026-08-13 to Supabase project qpztlobbnjyjbxqyuzgg.
--
-- A REPORTED AUTHOR LEAVES THE FEED, QUIETLY.
--
-- Reporting was already the fastest lever in the product: n_reported = 0 in every feed
-- filter, so ONE report pulls a photo for everybody, while `blocked` only trips at three.
-- What it could not do was reach the PERSON. A photo of a child's head was seen in the feed
-- (founder, 2026-08-13); pulling that one photo leaves whoever posted it free to post the
-- next one, and the next report starts from zero again.
--
-- So reports now accumulate against the AUTHOR, through the author_tag added this morning.
-- Two reported hides from one tag and that tag stops being served — to everybody, without a
-- word to its owner. Silent on purpose: an author told they are shadowed is an author who
-- opens a second device, and the whole value of this is that it does not teach evasion.
--
-- TWO, not three. `blocked` uses three because it acts on a single photo somebody may have
-- been reported for by accident. This acts on a pattern, and a pattern of two is already the
-- difference between an unlucky photo and a person.
--
-- EVERY OVERLOAD, INCLUDING THE OLD ONES. This is the one change in this file that is edited
-- into existing signatures rather than added beside them — the "add an overload, never edit"
-- rule protects pages that are mid-deploy, and a page mid-deploy must not keep serving a
-- shadowed author for the hours it takes to turn over. Safety filters go in the body.

create table if not exists public.shadowed_authors(
  tag text primary key,
  since timestamptz not null default now(),
  hides_reported integer not null default 0
);

-- The counter is "how many of this author's hides carry a report", not "how many reports" —
-- so ten reports on one unlucky photo do not shadow anybody, and two photos do.
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

  if v_tag is null then return; end if;   -- pre-tag hides: the photo goes, the author cannot be reached

  select count(*) into v_n from hides h
   where h.author_tag = v_tag and h.n_reported > 0;

  if v_n >= 2 then
    insert into shadowed_authors(tag, hides_reported) values (v_tag, v_n)
    on conflict (tag) do update set hides_reported = excluded.hides_reported;
  end if;
end $function$;

-- Both feed_page overloads the page can reach gain the same NOT EXISTS. The 5-argument
-- shuffle experiment is left alone; no build has ever called it.
-- (bodies as applied — see the migration in the dashboard for the full text)
