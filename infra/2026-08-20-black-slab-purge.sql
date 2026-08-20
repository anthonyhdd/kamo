-- 2026-08-20 — 328 hides publics dépubliés : ce sont des rectangles noirs, pas des planques.
--
-- POURQUOI. `feed_black_dropped` a tiré 13 726 fois le 17/08 pour 5 705 `feed_opened` — ~2,4
-- photos jetées par ouverture de feed. kfLooksBlack() faisait donc son travail, mais sur
-- l'appareil de chaque joueur, à chaque page, indéfiniment : la ligne restait dans le corpus et
-- continuait d'occuper un créneau dans toutes les pages servies à tout le monde. Une page de 8
-- qui perd 2 à 3 lignes se vide plus vite, et une page vide poussait paint() dans le second
-- tour (voir S.lap) — c'est-à-dire à reservir au joueur ce qu'il venait de jouer.
--
-- COMMENT LA LISTE A ÉTÉ ÉTABLIE. Pas par heuristique SQL : on ne décode pas un JPEG en
-- Postgres. Les 944 candidats (ceux dont `length(lqip) < 1280` — la séparation est nette, les
-- dalles tiennent en 1091-1107 octets quand la vraie photo la plus courte fait 1271) ont été
-- téléchargés depuis le bucket public, ramenés à 20px de large comme le lqip, et passés dans
-- exactement la luma Rec.601 et les seuils de kfLooksBlack(). 394 sont ressortis noirs.
--
-- SEUIL PLUS STRICT QUE LE CLIENT, ET C'EST VOULU. Le filtre embarqué (mean<18, spread<10) est
-- réversible : il cache une photo pour une session. Une dépublication ne l'est pas de la même
-- façon — elle retire la planque de quelqu'un. Vérification faite, le client est un peu trop
-- large : `msxbm1foo01epnsa` (mean 11 / spread 8) est une VRAIE planque, une pièce sombre avec
-- un pion visible, et le client la jette. On ne purge donc que le noyau mean<4 ET spread<4,
-- 319 img_path / 328 lignes (un même fichier peut porter plusieurs hides). Le plus clair du
-- noyau a été regardé à l'œil : cadre noir, un unique point brillant, injouable.
-- Les 75 lignes entre les deux seuils restent publiques et continuent d'être filtrées côté
-- client — statu quo, pas de régression.
--
-- RÉVERSIBLE EN UNE REQUÊTE. La table d'audit garde la liste exacte :
--   update hides set is_public = true
--   where id in (select id from black_slab_purge_2026_08_20);
--
-- CE QUI N'A PAS ÉTÉ FAIT. 2 796 hides éligibles ont `lqip` NULL. kfLooksBlack() renvoie false
-- sur une valeur nulle, donc ceux-là ne sont JAMAIS testés par le client : si des dalles s'y
-- cachent, elles sont servies à tout le monde sans filet. Population non mesurée ici.

create table if not exists black_slab_purge_2026_08_20 (
  id text primary key,
  img_path text not null,
  purged_at timestamptz not null default now()
);

-- insert into black_slab_purge_2026_08_20 (id, img_path)
-- select h.id, h.img_path from hides h
-- where h.is_public and h.img_path in ( <les 319 img_path vérifiés> )
-- on conflict (id) do nothing;

update hides set is_public = false
where id in (select id from black_slab_purge_2026_08_20) and is_public;
-- 328 lignes. Pool éligible avant/après : inchangé à ~9 350, la publication courante
-- (~906/24h) ayant recouvert la purge pendant l'opération.

-- ============================================================================================
-- SECOND LOT, même jour : 106 hides de plus, ceux dont `lqip` est NULL.
--
-- Ils comptent plus que leur nombre. `kfLooksBlack()` commence par `if(!lqip) return res(false)`
-- — un placeholder absent vaut « pas noir ». Ces lignes-là ne sont donc JAMAIS testées côté
-- client : contrairement aux dalles du premier lot, celles-ci étaient servies à tout le monde,
-- affichées, et jouées comme des manches. C'est le seul endroit où un joueur voyait vraiment un
-- rectangle noir plein écran.
--
-- COMMENT LA POPULATION A ÉTÉ ÉNUMÉRÉE, sans faire transiter 2 795 lignes par le contexte :
-- la surcharge `feed_page(p_before, p_limit, p_block_tags, p_offset)` est appelable par la clé
-- anon et accepte un OFFSET. 312 requêtes de 30 ont donc rendu le corpus entier (9 036 hides
-- distincts, dont 2 795 sans lqip) en local. La lecture REST directe de `hides` est refusée par
-- la RLS — c'est bien, et cette surcharge est le seul chemin qui rende la chose faisable.
--
-- 2 794 images téléchargées et passées dans le même détecteur. 135 noires aux seuils du client,
-- 104 img_path au seuil conservateur mean<4 ET spread<4 → 106 lignes. Les 31 intermédiaires
-- restent publiques. Une seule image reste non vérifiée : son objet de storage ne répond plus.
--
-- ⚠️ `msuuyjp8htczikt4` (mean 17 / spread 10) tombe sous le seuil du CLIENT et pas sous le
-- nôtre — encore un cas où le filtre embarqué jetterait une vraie photo sombre. Deuxième
-- confirmation que 18/10 est trop large.
--
-- RÉVERSIBLE :
--   update hides set is_public = true
--   where id in (select id from black_slab_purge_nolqip_2026_08_20);

create table if not exists black_slab_purge_nolqip_2026_08_20 (
  id text primary key,
  img_path text not null,
  purged_at timestamptz not null default now()
);

-- insert into black_slab_purge_nolqip_2026_08_20 (id, img_path)
-- select h.id, h.img_path from hides h
-- where h.is_public and h.img_path in ( <les 104 img_path vérifiés> )
-- on conflict (id) do nothing;

update hides set is_public = false
where id in (select id from black_slab_purge_nolqip_2026_08_20) and is_public;
-- 106 lignes. Total des deux lots : 434 hides dépubliés.
