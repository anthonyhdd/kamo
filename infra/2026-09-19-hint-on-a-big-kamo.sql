-- 2026-09-19 · LE BOUTON HINT AVAIT DISPARU DE LA MAJORITÉ DES MANCHES.
--
-- Rapport du fondateur, en trois mots : « on voit pas le hint bouton ». Ce n'était pas une
-- panne : c'est le produit qui retire le bouton lui-même, exactement comme il a été écrit
-- pour le faire (#412). hint_state(owner, hide) répond `hintable: false` quand
-- hint_region() renvoie NULL, et la page supprime alors le bouton en silence.
--
-- hint_region() renvoyait NULL dès `r >= 0.22`. Ce seuil a été posé quand un kamo médian
-- faisait r = 0.09 et qu'il concernait 1 hide sur 3. Il n'en concerne plus 1 sur 3 :
--
--   semaine du 17-08   p50 r = 0.093    28 % des hides >= 0.22
--   semaine du 31-08   p50 r = 0.101    39 %
--   semaine du 07-09   p50 r = 0.249    52 %
--   semaine du 14-09   p50 r = 0.251    57 %      (2026-09-18 : 60 %)
--
-- Sur le stock vivant entier (9702 hides) : 3571, soit 37 %, n'ont AUCUN bouton Hint. C'est
-- le seul consommable de l'app, et sa seule porte n'existe pas sur plus d'une manche sur
-- trois. Amplitude le dit depuis des semaines et personne ne l'a lu comme ça :
-- hint_unavailable{too_big} = 4894 sur 14 jours contre 16074 hint_offered.
--
-- La distribution des rayons est BIMODALE et ne bougera pas toute seule : un paquet à
-- 0.055–0.10 (kamo réduit) et un paquet à 0.25–0.34 (kamo laissé grand, 0.34 étant le
-- plafond que chGeom() applique). Rien entre 0.15 et 0.20. Attendre que les joueurs fassent
-- des kamos plus petits n'est pas un plan.
--
-- ⚠️ MONTER LE SEUIL EST LA MAUVAISE RÉPONSE, ET C'EST LE PREMIER RÉFLEXE. L'indice actuel
-- CONTIENT la réponse : rad = max(0.15, r + 0.09), et la page dessine une boîte de 4·rad
-- (le cœur clair est la moitié du milieu). À r = 0.22 la boîte fait déjà 1.24 × le cadre :
-- elle déborde de la photo, le dégradé n'a nulle part où s'éteindre, et tout l'écran
-- s'allume. À r = 0.34 elle ferait 1.72 ×. Vendre ça, c'est vendre un indice qui n'indique
-- rien — précisément ce que le NULL protégeait.
--
-- DONC L'INDICE CHANGE DE SENS, IL NE CHANGE PAS DE TAILLE. Deux branches, une fonction :
--
--   r < 0.22   — INCHANGÉ. « c'est quelque part là-dedans » : rad = max(0.15, r+0.09), le
--                disque CONTIENT la réponse, jitter dans [0, rad-r], projection sur le
--                disque (voir 2026-08-20-hint-region-onframe.sql, qui reste la référence
--                pour la loi de tirage et pour la contenance).
--   r >= 0.22  — NOUVEAU. « tape là-dedans » : rad = 0.15 fixe, et le disque est ENTIÈREMENT
--                À L'INTÉRIEUR de la réponse — centre tiré à moins de (r - 0.15) du vrai
--                centre, donc distance + 0.15 <= r. Un kamo à r >= 0.22 occupe déjà 44 % du
--                petit côté : ce qui manque au joueur n'est pas la précision, c'est la
--                direction, et un disque de 0.15 la donne sans allumer la photo entière.
--
-- La géométrie est la MÊME dans les deux cas — un budget `span`, un jitter 0.8·u_mag, un
-- clamp au cadre, une projection sur le budget. Seuls le rayon et le sens du budget changent
-- (`rad - r` contre `r - rad`), ce qui est exactement pourquoi les deux tiennent dans une
-- seule requête au lieu de deux fonctions qui divergeront.
--
-- MESURÉ SUR LES 9702 HIDES VIVANTS, avant d'appliquer :
--   · branche « contient » (6131) : 0 réponse hors de son indice, 0 centre hors cadre
--   · branche « dedans »   (3571) : 0 indice débordant de sa réponse, 0 centre hors cadre
--   · cœur clair max : 0.62 du petit côté côté contenance, 0.30 côté intérieur
--   · 3571 manches qui n'avaient pas de bouton en ont un
--
-- CE QUE ÇA COÛTE, ET C'EST LE VRAI ARBITRAGE : sur ces 37 % de hides, l'indice devient un
-- coup gagnant garanti (taper dans la lumière = trouver). Sur un kamo qui fait déjà la
-- moitié de la photo, c'est du temps gagné, pas une réponse volée — et l'alternative
-- mesurée aujourd'hui est zéro bouton, zéro offre, zéro vente. Un indice gratuit par jour
-- reste un indice gratuit par jour.
--
-- hint_spend() n'est pas touchée : elle lit hint_region() et son refus `hide_too_easy`
-- devient simplement inatteignable pour un hide vivant. Le chemin reste en place côté page
-- (filet), et il est désormais VISIBLE au lieu de supprimer le bouton — voir index.html.
--
-- ROLLBACK — remettre le filtre et la branche unique, deux minutes, aucune autre dépendance :
--   la définition intégrale d'avant est celle de 2026-08-20-hint-region-onframe.sql, à
--   réappliquer telle quelle. Elle se reconnaît à `and coalesce(r, 0.06) < 0.22` dans le CTE
--   `h` et à l'absence de `span`.

create or replace function public.hint_region(p_hide_id text)
 returns json
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with h as (
    select cx, cy, coalesce(r, 0.06) as r, md5(id) as seed
      from public.hides
     where id = p_hide_id and not blocked and expires_at > now()
  ), k as (
    select cx, cy, r, seed,
           -- LA SEULE DÉCISION DE CETTE FONCTION : contenir la réponse, ou tenir dedans.
           (r < 0.22) as holds,
           case when r < 0.22 then greatest(0.15, r + 0.09) else 0.15 end as rad,
           ('x' || substr(seed, 1, 8))::bit(32)::bigint / 4294967296.0 as u_ang,
           ('x' || substr(seed, 9, 8))::bit(32)::bigint / 4294967296.0 as u_mag
      from h
  ), s as (
    -- De combien le centre de l'indice a le droit de s'écarter de la vraie réponse. Positif
    -- dans les deux branches : rad - r >= 0.09 quand on contient, r - rad >= 0.07 quand on
    -- tient dedans (r >= 0.22 et rad = 0.15). Un indice centré pile sur la réponse EST la
    -- réponse ; c'est ce budget qui fait qu'il n'en est pas une.
    select cx, cy, r, rad, u_ang, u_mag,
           (case when holds then rad - r else r - rad end) as span
      from k
  ), j as (
    -- 0.998 : la sortie est arrondie à 4 décimales, et un point projeté EXACTEMENT sur le
    -- budget repasse d'un cheveu au-delà en arrondissant — pire cas mesuré 7.3e-5, soit
    -- 0,03 px à 390. Sans effet à l'écran, et l'indice ne ment toujours pas, ce qui est la
    -- seule propriété que cette fonction n'a pas le droit de perdre.
    select cx, cy, r, rad, span * 0.998 as bud,
           cx + span * 0.8 * u_mag * cos(2 * pi() * u_ang) as jx,
           cy + span * 0.8 * u_mag * sin(2 * pi() * u_ang) as jy
      from s
  ), t as (
    select cx, cy, rad, bud,
           greatest(least(rad, 0.5), least(greatest(1 - rad, 0.5), jx)) as tx,
           greatest(least(rad, 0.5), least(greatest(1 - rad, 0.5), jy)) as ty
      from j
  ), p as (
    select cx, cy, rad, bud, tx, ty,
           sqrt(power(tx - cx, 2) + power(ty - cy, 2)) as d
      from t
  ), c as (
    -- PROJECTION, PAS CLAMP PAR AXE : ramener x et y séparément dans ±budget autorise une
    -- distance de budget·√2, ce qui casse la propriété dans les deux branches. Voir
    -- 2026-08-20-hint-region-onframe.sql, où ça avait coûté 78 hides sur 400.
    select rad,
           cx + (tx - cx) * (case when d > bud then bud / d else 1 end) as fx,
           cy + (ty - cy) * (case when d > bud then bud / d else 1 end) as fy
      from p
  )
  select json_build_object(
           'cx', round(fx::numeric, 4),
           'cy', round(fy::numeric, 4),
           'r',  round(rad::numeric, 4)
         )
    from c;
$function$;
