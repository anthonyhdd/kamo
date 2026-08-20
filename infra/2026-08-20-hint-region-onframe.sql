-- 2026-08-20 · L'ANNEAU DU HINT DOIT ÊTRE SUR LA PHOTO.
--
-- hint_region() décale le centre du cercle par rapport à la vraie réponse, d'une distance
-- tirée dans [0, rad - r]. C'est voulu : un cercle centré sur le kamo donnerait la réponse
-- exacte au lieu de rétrécir la recherche. Mais le décalage était appliqué en coordonnées
-- brutes et n'était JAMAIS ramené dans le cadre.
--
-- Mesuré sur les 400 derniers hides vivants, avant :
--   · 152 (38 %)  — l'anneau est coupé par le bord de la photo
--   ·  16 (4 %)   — le CENTRE de l'anneau est hors de l'image (ex. 22f135f0a3dcf22d, cx=1.031)
--
-- Dans ce dernier cas le joueur paie un indice et reçoit un arc dans un coin, le kamo ailleurs.
-- C'est le rapport du fondateur, testé en live : « ça l'affiche pas où y'a le perso ».
--
-- ⚠️ LA CONTENANCE EST LA PROPRIÉTÉ DURE, ET LA PREMIÈRE VERSION DE CE FICHIER LA CASSAIT.
-- submit_attempt teste sqrt((x-cx)²+(y-cy)²) <= r sur des coordonnées normalisées par axe, et
-- la page dessine exactement ce disque. Le centre du hint doit donc rester à moins de
-- (rad - r) de la réponse — une CONTRAINTE CIRCULAIRE. Clamper x et y séparément dans
-- ±(rad-r), ce qui était le premier réflexe, autorise une distance de (rad-r)·√2 : testé sur
-- les mêmes 400 hides, 78 d'entre eux se retrouvaient avec un indice qui ne contenait plus le
-- kamo. Un indice qui ment est très pire que le bug corrigé ici.
-- D'où la PROJECTION sur le disque plutôt qu'un clamp par axe : on tire vers le cadre, puis on
-- ramène le vecteur à la longueur du budget. 0 violation sur 400.
--
-- APRÈS, sur les 800 derniers hides vivants : 0 kamo hors de son indice, 0 centre hors image,
-- 154 anneaux coupés (19 %, contre 38 %), décalage moyen 0,54 du budget, 172 tangents (21 %).
--
-- Un kamo posé au bord de la photo garde un anneau coupé (78 sur 400) : c'est géométriquement
-- inévitable, et l'anneau est alors aussi dans le cadre que le budget l'autorise.
--
-- ET LA LOI DU TIRAGE CHANGE AVEC, PARCE QUE LE CLAMP SEUL AGGRAVAIT L'AUTRE MOITIÉ DU
-- PROBLÈME. sqrt(u_mag) est uniforme en AIRE : elle pousse la réponse vers le bord par
-- construction (décalage moyen 0,67 du budget, 72/400 kamos tangents au bord intérieur).
-- Ramener les anneaux dans le cadre écarte encore le centre de la réponse sur les hides de
-- bord — avec sqrt() conservé, les tangents passaient de 72 à 142, soit « l'indice ne montre
-- pas le perso » deux fois plus souvent qu'avant. 0.8·u_mag ramène la moyenne à 0,54 et les
-- tangents à 84, c'est-à-dire la difficulté d'aujourd'hui, bug en moins. Trois variantes ont
-- été mesurées avant de choisir ; les deux autres sont dans le PR.
--
-- ROLLBACK — la définition d'avant, à réappliquer telle quelle :
--   with h as (select cx, cy, coalesce(r,0.06) as r, md5(id) as seed from public.hides
--              where id = p_hide_id and not blocked and expires_at > now()
--                and coalesce(r,0.06) < 0.22),
--        k as (select cx, cy, r, seed, greatest(0.15, r+0.09) as rad,
--                     ('x'||substr(seed,1,8))::bit(32)::bigint/4294967296.0 as u_ang,
--                     ('x'||substr(seed,9,8))::bit(32)::bigint/4294967296.0 as u_mag from h)
--   select json_build_object(
--     'cx', round((cx + (rad-r)*sqrt(u_mag)*cos(2*pi()*u_ang))::numeric, 4),
--     'cy', round((cy + (rad-r)*sqrt(u_mag)*sin(2*pi()*u_ang))::numeric, 4),
--     'r',  round(rad::numeric, 4)) from k;

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
       and coalesce(r, 0.06) < 0.22          -- see 'hide_too_easy' above
  ), k as (
    select cx, cy, r, seed,
           greatest(0.15, r + 0.09) as rad,
           ('x' || substr(seed, 1, 8))::bit(32)::bigint / 4294967296.0 as u_ang,
           ('x' || substr(seed, 9, 8))::bit(32)::bigint / 4294967296.0 as u_mag
      from h
  ), j as (
    -- 0.8 * u_mag : uniforme en RAYON et non en aire — voir l'en-tête
    -- 0.998 : la sortie est arrondie à 4 décimales, et un point projeté EXACTEMENT sur le
    -- budget repasse d'un cheveu au-delà en s'arrondissant — pire cas mesuré 7,3e-5, soit
    -- 0,03 px à 390. Invisible, et pourtant un indice qui ne contient plus prouvablement sa
    -- réponse : la seule propriété que cette fonction n'a pas le droit de perdre.
    select cx, cy, r, rad, (rad - r) * 0.998 as bud,
           cx + (rad - r) * 0.8 * u_mag * cos(2 * pi() * u_ang) as jx,
           cy + (rad - r) * 0.8 * u_mag * sin(2 * pi() * u_ang) as jy
      from k
  ), t as (
    -- où l'anneau VOUDRAIT être pour tenir dans le cadre
    select cx, cy, rad, bud,
           greatest(least(rad, 0.5), least(greatest(1 - rad, 0.5), jx)) as tx,
           greatest(least(rad, 0.5), least(greatest(1 - rad, 0.5), jy)) as ty
      from j
  ), p as (
    select cx, cy, rad, bud, tx, ty,
           sqrt(power(tx - cx, 2) + power(ty - cy, 2)) as d
      from t
  ), c as (
    -- projeté sur le disque de contenance : le budget gagne, toujours
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
