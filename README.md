# HIDEY 🦎 (working title)

AR camouflage photo-toy riding the **MECCHA CHAMELEON** trend. Solo, serverless,
built for TikTok/Instagram.

**Loop:** open camera or pick a photo → place a white mannequin → capture →
paint-to-camouflage (eyedropper samples exact scene colors) → share a
"Tu me trouves ?" challenge.

## Run locally
Static single file. Serve over http(s) (camera needs a secure context):

```
python3 -m http.server 5599
# open http://localhost:5599
```

Append `?debug` to expose `window.HIDEY` test hooks (no-op for users).

## Deploy
GitHub Pages from `main` / root → https://anthonyhdd.github.io/hidey/

> iOS note: the web camera only works in **Safari** (Chrome/FF/Edge on iOS
> can't access it). "Choisir une photo" works everywhere.
