-- 2026-08-21 — feed_page apprend QUI demande.
--
-- LE PROBLÈME. `feed_page` n'avait aucune composante par utilisateur dans son ORDER BY :
-- `least(n_attempts,3)`, puis le score, puis `created_at desc`. Aucune de ces clés ne dépend de
-- qui appelle. Tous les appareils parcouraient donc la MÊME liste, et la seule chose qui
-- distinguait deux joueurs était `kfSeen()` — qui vit dans le localStorage et que le serveur
-- n'a jamais vu. Le serveur reservait la même tête, le client la jetait, les pages
-- rétrécissaient, et le feed basculait dans son second tour en resservant ce qui venait d'être
-- joué. Signalement fondateur, 20/08/2026, sur une longue session : « elle voit souvent les
-- mêmes images ».
--
-- LES DEUX MOITIÉS, ET L'ORDRE COMPTE. Le seed seul ne sert à RIEN, et c'est mesuré : la tête
-- sous-jouée (bandes 0-2) fait 96 lignes, une session de 48 hides n'en sort jamais, et deux
-- appareils y partagent 96 % de leurs lignes quel que soit le seed — il ne fait que réordonner
-- un vivier commun. Ce qui débloque, c'est que le client envoie `kfSeen()` dans `p_seen` : le
-- serveur saute alors cette tête et livre les 8 800 lignes du dessous, seul endroit où le
-- mélange a de la place. Là, le recouvrement entre deux appareils tombe de 100 % à ~30 %.
-- Mesuré sur la base live, trois seeds, 21/08/2026.
-- Et bout à bout : deux sessions successives d'un même appareil passent de « la même tête
-- rejetée page après page » à 0 % de répétition sur 48 hides.
--
-- CE QUI NE CHANGE PAS, ET C'EST L'ESSENTIEL. Seul le dernier départage bouge. Conservées à
-- l'identique : les hides impossibles en dernier, les jamais-joués en premier, le score. Ajouté
-- SOUS elles et AU-DESSUS du mélange, un seau par jour — les hides d'aujourd'hui précèdent
-- toujours ceux d'hier. Sans lui, le seed étalerait un appareil uniformément sur les sept jours
-- de la fenêtre et le feed cesserait de paraître vivant. Avec lui, la fraîcheur survit à la
-- granularité qui compte et seul l'ordre À L'INTÉRIEUR d'un jour est propre à l'appareil.
--
-- COÛT : négligeable. Le plan fait déjà un parcours de ~9 000 lignes et un top-N heapsort
-- pilotés par le sous-select corrélé sur `hide_reactions` (8 969 boucles) ; le md5 sur l'id ne
-- pèse rien à côté. Mesuré sur la base live : 64 ms avec le seed contre 87 ms pour l'appel en
-- production.
--
-- ⚠️ UNE SURCHARGE DE PLUS, JAMAIS UNE SUBSTITUTION. Ce fichier se déploie au push, la base
-- non : pendant un déploiement les deux sont vivants et une page chargée il y a une minute
-- appelle encore la forme à 3 arguments. Les cinq signatures existantes sont intactes.
-- Le client a un barreau dédié pour ça et émet `feed_page_seed_unavailable` s'il retombe
-- dessus — à lire comme une horloge de déploiement, pas comme une erreur.
--
-- ⚠️ PostgREST résout les RPC par NOM d'argument, et il existait déjà une surcharge à 4
-- arguments : `(p_before, p_limit, p_block_tags, p_offset)`. Les jeux de noms diffèrent
-- (`p_limit, p_block_tags, p_seen, p_seed`), donc les deux se distinguent. Ne pas renommer un
-- argument de l'une ou de l'autre sans revérifier ça.
--
-- ⚠️ UTC est épinglé dans le `date_trunc` : sur un timestamptz il lit le TimeZone de la
-- connexion, et un seau qui bougerait selon l'appelant réordonnerait le feed pour une raison
-- invisible.
--
-- Un `p_seed` NULL ou vide reste cohérent — impossibles en dernier, jamais-joués en premier,
-- score, jour — avec un ordre arbitraire mais stable dans la journée. Même classe de réponse
-- qu'aujourd'hui, jamais une erreur.

create or replace function public.feed_page(
  p_limit integer, p_block_tags text[], p_seen text[], p_seed text)
returns table(id text, img_path text, name text, n_attempts integer, n_found integer,
              created_at timestamp with time zone, lqip text)
language sql
stable security definer
set search_path to 'public'
as $function$
  select h.id, h.img_path, h.name, h.n_attempts, h.n_found, h.created_at, h.lqip
  from hides h
  where h.is_public and not h.blocked and h.n_reported = 0
    and h.expires_at > now() and h.img_path is not null and h.img_path <> ''
    and coalesce(h.coverage, 100) >= 70
    and (h.source is null or h.source <> 'rehide')
    and not (h.id = any((coalesce(p_seen, '{}'::text[]))[1:300]))
    and (h.author_tag is null or not (h.author_tag = any(coalesce(p_block_tags, '{}'))))
    and (h.author_tag is null or not exists (
          select 1 from shadowed_authors s where s.tag = h.author_tag))
  order by (case when h.n_attempts >= 4 and h.n_found = 0 then 1 else 0 end) asc,
    least(h.n_attempts, 3) asc,
    ((select coalesce(sum(r.n), 0)::int from hide_reactions r where r.hide_id = h.id)
     + case when h.n_attempts >= 3
            and h.n_found * 4 >= h.n_attempts
            and h.n_found * 4 <= h.n_attempts * 3 then 3 else 0 end
     - case when h.n_attempts >= 5
            and h.n_found * 5 >= h.n_attempts * 4 then 3 else 0 end
     - least(coalesce(h.n_skipped, 0) / 3, 4)) desc,
    date_trunc('day', h.created_at at time zone 'UTC') desc,
    md5(h.id || coalesce(p_seed, '')) asc,
    h.id
  limit least(greatest(coalesce(p_limit, 8), 1), 30);
$function$;
