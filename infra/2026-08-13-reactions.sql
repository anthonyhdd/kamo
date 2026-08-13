-- APPLIED 2026-08-13 to Supabase project qpztlobbnjyjbxqyuzgg.
-- Four emoji on the feed's ending card. The whitelist is enforced SERVER-side, not by the
-- four buttons: the buttons are a UI and anybody can call the RPC, so the set of things that
-- can ever appear under somebody's photo is decided here.
create table if not exists public.hide_reactions(
  hide_id text not null, emoji text not null, n integer not null default 0,
  primary key (hide_id, emoji));
create or replace function public.react_to_hide(p_id text, p_emoji text)
returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  if p_emoji is null or p_emoji not in ('🔥','😂','😱','👏') then return; end if;
  if not exists (select 1 from hides h where h.id = p_id and not h.blocked) then return; end if;
  insert into hide_reactions(hide_id, emoji, n) values (p_id, p_emoji, 1)
  on conflict (hide_id, emoji) do update set n = hide_reactions.n + 1;
end $function$;
create or replace function public.hide_reactions_of(p_id text)
returns table(emoji text, n integer) language sql stable security definer set search_path to 'public'
as $function$ select r.emoji, r.n from hide_reactions r where r.hide_id = p_id order by r.n desc; $function$;
grant execute on function public.react_to_hide(text, text) to anon, authenticated;
grant execute on function public.hide_reactions_of(text) to anon, authenticated;
