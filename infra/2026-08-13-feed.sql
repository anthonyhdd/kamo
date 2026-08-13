-- APPLIED 2026-08-13 to Supabase project qpztlobbnjyjbxqyuzgg.
--
-- Kept in the repo because this database has no migration history anywhere else: the schema
-- lives in a dashboard and the only record of how it got there is CLAUDE.md prose. A file
-- per change is cheap, and the first time somebody has to answer "when did hides become
-- public, and what was the default" it is the difference between reading a diff and guessing.
--
-- THE FEED, AND THE ONE THING IT MUST NOT DO: publish a photo somebody took believing it was
-- going to exactly one friend.
--
-- Every hide that existed when this ran (2980 of them, 2026-08-05 → 2026-08-13) was made
-- under the 1:1 contract: you paint, you send a link, one person opens it. Nothing on screen
-- ever said "this may be shown to strangers". So the column defaults to FALSE and the
-- backfill below is a no-op by construction — nothing becomes public retroactively, and
-- nothing becomes public because a deploy landed in the wrong order either. The web build
-- opts a hide in with set_hide_public() AFTER the share sheet has said, in words, that it
-- will play in the feed.

alter table public.hides add column if not exists is_public boolean not null default false;

-- Explicit, not implied. `add column ... default false` already backfills; the intent is the
-- point: the pre-feed corpus is private forever.
update public.hides set is_public = false where is_public;

-- Partial so it stays small: public + unblocked is a tiny slice of the table and the only
-- slice this index ever has to answer for.
create index if not exists hides_feed_idx
  on public.hides (created_at desc)
  where is_public and not blocked;

-- THE FEED PAGE. Same contract as get_hide: the answer (cx, cy, r) is NEVER on the wire. The
-- anon key has no SELECT on hides at all, so this function is the entire surface — what it
-- does not return cannot be read.
--
-- Cursor pagination on created_at rather than offset: the table grows by ~400 rows/day at the
-- top, and an offset pager re-serves rows the scroller has already passed every time somebody
-- publishes mid-session.
--
-- n_reported = 0 is deliberately stricter than `blocked` (which trips at 3, see report_hide).
-- One report pulls a photo out of the feed immediately while leaving its link alive — the
-- feed shows strangers' photos to strangers, so it takes the cautious reading, and a wrong
-- report costs one hide its feed slot rather than costing a person their photo on 400 phones.
create or replace function public.feed_page(p_before timestamptz default null, p_limit integer default 8)
returns table(id text, img_path text, name text, n_attempts integer, n_found integer, created_at timestamptz)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select h.id, h.img_path, h.name, h.n_attempts, h.n_found, h.created_at
  from hides h
  where h.is_public
    and not h.blocked
    and h.n_reported = 0
    and h.expires_at > now()
    and h.img_path is not null
    and h.img_path <> ''
    -- the same publish floor get_hide enforces: under 30% coverage the figure is standing in
    -- plain sight and there is no game to play
    and coalesce(h.coverage, 100) >= 30
    and (p_before is null or h.created_at < p_before)
  order by h.created_at desc
  limit least(greatest(coalesce(p_limit, 8), 1), 30);
$function$;

-- The switch. Reachable by anyone holding the hide id — the same trust model as report_hide
-- and mark_hide_sent, and the id is a random 16-character string that only ever exists on the
-- creator's device and in links they chose to send.
create or replace function public.set_hide_public(p_id text, p_public boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  update hides set is_public = coalesce(p_public, false) where id = p_id;
end
$function$;

grant execute on function public.feed_page(timestamptz, integer) to anon, authenticated;
grant execute on function public.set_hide_public(text, boolean) to anon, authenticated;
