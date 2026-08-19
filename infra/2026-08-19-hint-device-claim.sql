-- 2026-08-19 · THE CREDIT HAS TO REACH A DEVICE THAT HAS NO REVENUECAT ID.
--
-- The RevenueCat webhook credits hint_wallet by app user id. A device whose page never
-- received that id — App.js sets chUserId from ONE unretried getAppUserID() inside a silent
-- catch, so a lost cold-start race leaves the page unidentified for the whole session —
-- spends a wallet keyed "dev:<deviceId>" instead. Its own purchase therefore lands in a
-- wallet it can never spend from: money taken, no hints. That is the one thing the web fix
-- of the same day refused to allow, which is why it could not sell at all.
--
-- This links the two, narrowly and fail-closed. Apply in the dashboard, then merge the web PR
-- (the page refuses to open Apple's sheet until hint_intent answers, so the order is safe
-- either way round).

alter table public.hint_grants add column if not exists created_at timestamptz not null default now();
alter table public.hint_grants add column if not exists claimed_by text;

create table if not exists public.hint_intents(
  dev_key    text primary key,
  created_at timestamptz not null default now()
);
alter table public.hint_intents enable row level security;

-- Stamped when the page opens Apple's sheet on an unidentified device, and the page treats a
-- failure here as "do not sell" — so this function existing is also the feature's switch.
create or replace function public.hint_intent(p_dev text)
returns json language plpgsql security definer set search_path to 'public' as $$
begin
  if p_dev is null or p_dev not like 'dev:%' then
    return json_build_object('ok', false, 'reason', 'bad_input');
  end if;
  insert into public.hint_intents (dev_key) values (p_dev)
    on conflict (dev_key) do update set created_at = now();
  return json_build_object('ok', true);
end;
$$;

-- FOUR CONDITIONS, AND EVERY ONE OF THEM IS A LOCK ON SOMEBODY ELSE'S MONEY.
--   1. only a "dev:" key claims — an identified device is credited directly and never comes here
--   2. it must have opened Apple's sheet in the last 20 minutes (hint_intent above)
--   3. it may claim ONCE, ever
--   4. there must be EXACTLY ONE unclaimed grant in that window — two candidates and this
--      refuses rather than guessing, because guessing spends a stranger's pack
--
-- Fail-closed by construction: an ambiguous window credits nobody and the units stay in the
-- buyer's own wallet, recoverable the moment the native id retry ships. The exposure this
-- carries is one pack, once, per device key; the exposure of NOT having it is that the only
-- consumable this app sells cannot be bought at all on an unidentified device.
create or replace function public.hint_claim(p_dev text)
returns json language plpgsql security definer set search_path to 'public' as $$
declare
  v_grant public.hint_grants;
  v_n     integer;
  v_bal   integer;
begin
  if p_dev is null or p_dev not like 'dev:%' then
    return json_build_object('claimed', false, 'reason', 'bad_input');
  end if;

  if not exists (select 1 from public.hint_intents
                  where dev_key = p_dev and created_at > now() - interval '20 minutes') then
    return json_build_object('claimed', false, 'reason', 'no_intent');
  end if;

  if exists (select 1 from public.hint_grants where claimed_by = p_dev) then
    return json_build_object('claimed', false, 'reason', 'already_claimed',
      'balance', coalesce((select balance from public.hint_wallet where owner = p_dev), 0));
  end if;

  select count(*) into v_n from public.hint_grants
   where claimed_by is null and owner <> p_dev and owner not like 'dev:%'
     and created_at > now() - interval '20 minutes';

  if v_n <> 1 then
    return json_build_object('claimed', false,
      'reason', case when v_n = 0 then 'no_grant' else 'ambiguous' end);
  end if;

  select * into v_grant from public.hint_grants
   where claimed_by is null and owner <> p_dev and owner not like 'dev:%'
     and created_at > now() - interval '20 minutes'
   for update skip locked;

  if v_grant.event_id is null then
    return json_build_object('claimed', false, 'reason', 'no_grant');
  end if;

  update public.hint_grants set claimed_by = p_dev where event_id = v_grant.event_id;

  insert into public.hint_wallet (owner, balance) values (p_dev, v_grant.units)
    on conflict (owner) do update
      set balance = public.hint_wallet.balance + excluded.balance, updated_at = now()
    returning balance into v_bal;

  return json_build_object('claimed', true, 'balance', v_bal);
end;
$$;

grant execute on function public.hint_intent(text) to anon, authenticated;
grant execute on function public.hint_claim(text)  to anon, authenticated;
