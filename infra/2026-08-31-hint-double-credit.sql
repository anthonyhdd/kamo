-- KAMO — 2026-08-31. Le portefeuille d'indices : un achat créditait deux fois, et rien ne
-- disait si un achat était réel. APPLIQUÉ EN PRODUCTION le 2026-08-31.
--
-- ① UN ACHAT DONNAIT DIX UNITÉS POUR CINQ PAYÉES.
--    hint_credit() crédite le portefeuille de l'id RevenueCat. hint_claim() AJOUTAIT ensuite
--    les mêmes unités au portefeuille de l'appareil. Les deux existaient donc en parallèle,
--    et personne ne l'a vu parce que la page ne lisait qu'un côté — le côté appareil.
--    La 1.1.7 a changé de côté : hintOwner() est `chUserId || ("dev:"+chDeviceId())`, et le
--    commit « The RevenueCat id reaches the page » a fait arriver chUserId. Du jour au
--    lendemain la page a lu le portefeuille RevenueCat, et le second exemplaire du seul achat
--    de l'histoire est apparu à son acheteur — cinq indices qu'il croyait offerts.
--    hint_claim DÉPLACE maintenant : il débite le portefeuille du grant avant de créditer
--    l'appareil. La somme des deux clés est conservée quel que soit le côté que la page lit.
--
-- ② UNE VENTE ET UN TEST SANDBOX ÉTAIENT LA MÊME LIGNE.
--    rc-hints crédite délibérément les achats sandbox — sans ça la fonctionnalité ne se teste
--    pas sur un vrai téléphone, et un achat sandbox exige un compte Apple sandbox qu'un
--    utilisateur ordinaire n'a pas. Mais l'environnement ne partait que dans la RÉPONSE du
--    webhook : il atteignait le journal de livraison et rien d'autre.
--    ⚠️ Ça a produit une affirmation fausse à voix haute le 31/08 — l'unique grant a été
--    appelé « un test sandbox », alors que l'API RevenueCat le donne en production, 1,16 USD
--    brut, acheté depuis la France (purchase otpAap930…, store_purchase_identifier
--    570002729826170). C'est la PREMIÈRE ET SEULE vente réelle du pack. Toute statistique de
--    vente doit filtrer sur environment = 'PRODUCTION'.
--
-- ③ LA SURCHARGE À 4 ARGUMENTS EST AJOUTÉE, L'ANCIENNE RESTE.
--    La fonction edge et la base se déploient séparément, donc pendant un déploiement les
--    deux sont vivantes et un webhook en vol appelle encore la signature à 3 arguments.
--    Même règle que create_hide. Le miroir de la fonction edge est infra/edge-rc-hints.ts.

alter table public.hint_grants add column if not exists environment text;

comment on column public.hint_grants.environment is
  'PRODUCTION | SANDBOX, tel que RevenueCat le rapporte. NULL = crédité avant 2026-08-31, '
  'quand rien ne l''enregistrait. Toute statistique de vente doit filtrer sur PRODUCTION.';

update public.hint_grants
   set environment = 'PRODUCTION'
 where event_id = '0514A0DB-FA97-4449-98A2-83A94CC139AF'
   and environment is null;

-- Surcharge à 4 arguments (le corps est identique à celle à 3, plus la colonne).
create or replace function public.hint_credit(
  p_event_id text, p_owner text, p_units integer, p_environment text)
returns json language plpgsql security definer set search_path to 'public' as $function$
declare
  v_inserted boolean := false;
  v_balance  integer;
begin
  if p_event_id is null or p_owner is null or coalesce(p_units, 0) <= 0 then
    return json_build_object('credited', false, 'reason', 'bad_input');
  end if;

  insert into public.hint_grants (event_id, owner, units, environment)
  values (p_event_id, p_owner, p_units, nullif(upper(trim(coalesce(p_environment,''))), ''))
  on conflict (event_id) do nothing;

  get diagnostics v_inserted = row_count;

  if not v_inserted then
    select balance into v_balance from public.hint_wallet where owner = p_owner;
    return json_build_object('credited', false, 'reason', 'duplicate',
                             'balance', coalesce(v_balance, 0));
  end if;

  insert into public.hint_wallet (owner, balance)
  values (p_owner, p_units)
  on conflict (owner) do update
    set balance = public.hint_wallet.balance + excluded.balance,
        updated_at = now()
  returning balance into v_balance;

  return json_build_object('credited', true, 'balance', v_balance);
end;
$function$;

-- La même porte unique que la signature à 3 arguments : jamais anon, jamais authenticated.
revoke all on function public.hint_credit(text, text, integer, text) from public, anon, authenticated;
grant execute on function public.hint_credit(text, text, integer, text) to service_role;

-- hint_claim : identique à l'existant, à un UPDATE près — le débit qui en fait un transfert.
-- (corps complet dans la migration appliquée ; seule la partie changée est reproduite ici,
--  le reste est inchangé mot pour mot)
--
--   update public.hint_grants set claimed_by = p_dev where event_id = v_grant.event_id;
-- +
-- + /* ⚠️ LE DÉBIT VIENT EN PREMIER, ET C'EST LA CORRECTION. hint_credit a déjà crédité le
-- +    portefeuille de v_grant.owner ; ce bloc ne fait que déplacer ces unités vers l'appareil
-- +    qui les réclame. Avant le 31/08 il n'y avait que le crédit ci-dessous, donc un achat
-- +    donnait 5 unités des deux côtés — 10 pour 5 payées. greatest(0, …) parce qu'un
-- +    portefeuille peut avoir déjà dépensé : on ne rend jamais un solde négatif. */
-- + update public.hint_wallet
-- +    set balance = greatest(0, balance - v_grant.units), updated_at = now()
-- +  where owner = v_grant.owner;
--
--   insert into public.hint_wallet (owner, balance) values (p_dev, v_grant.units) ...

-- Le doublon du 26/08, remis à zéro : 5 payées, 5 dépensées côté appareil, 5 en trop.
-- Il en restait 4 au moment de la correction.
--   update public.hint_wallet set balance = 0, updated_at = now()
--    where owner = '$RCAnonymousID:f9f708c7731b4c4294b5d8b130685989';
