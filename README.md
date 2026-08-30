# KAMO 🦎

Hide-and-seek played through your phone camera. Point it at anything in front of you — a
brick wall, a rug, a cluttered desk — drop in a small figure called a **kamo**, and paint it
with the colours of whatever is behind it until it disappears into the shot. A score rates
the blend. Then it becomes a challenge: whoever you send it to hunts for the kamo **in their
browser, with nothing to install**, and an animated reveal wipes across to show where it was.

- **App Store** (free, iPhone) — https://apps.apple.com/app/id6789639784
- **Site** — https://playkamo.com/ · press kit: https://playkamo.com/press/

> **It is not an AR game.** It uses the ordinary camera — no room scanning, no LiDAR
> requirement — which is why it runs on old phones. This gets miscategorised constantly, and
> the previous version of this README was one of the places doing it.

## This repo is the whole app

`index.html` — one file. `anthonyhdd/kamo` is served from GitHub Pages at
**https://anthonyhdd.github.io/kamo/**, and the shipped binary's WebView refetches that URL
**on every launch**. There is no review, no rollout, no staging: pushing here publishes to
every installed user within minutes, and a syntax error takes the app down for all of them at
once.

So the gate is *before* the push:

```
PW_CORE=<dir with node_modules> node scripts/check.mjs
```

It must be green every time. Without `PW_CORE` the browser tests skip loudly and you are
pushing on the static checks alone. **Read `CLAUDE.md` before touching anything** — it covers
the mirror, the config server, the database, and why each check exists.

> ⚠️ **Never attach a custom domain to this repo.** It makes Pages 301 to the apex over
> cleartext, WKWebView's ATS refuses the redirect, and every install shows a blank screen.
> That is the 2026-08-06 outage, 08:00–12:08, plus a Guideline 2.1(a) rejection four hours
> later.

## The other repos

| repo | what it is |
|---|---|
| `anthonyhdd/kamo` | **this one** — the app |
| `anthonyhdd/kamo-mirror` | the same file at `kamo.bliss-coach.com`, where share links land |
| `anthonyhdd/kamo-app` | the Expo/React Native wrapper on the App Store — a WebView and a bridge |
| `anthonyhdd/playkamo` | `playkamo.com`, the marketing site. Separate deployment, cannot affect the app. |

Challenge links are `playkamo.com/h/<id>` — a Cloudflare Worker (`infra/playkamo-worker.js`)
in front of the Supabase edge function in `infra/edge-h.ts`, which renders each hide's own
link preview.

## Run locally

Static single file, but the camera needs a secure context, so serve it over http(s) rather
than opening the file directly:

```
python3 -m http.server 5599
# open http://localhost:5599
```

Append `?debug` to expose the `window.HIDEY` test hooks — no-op for users. That name is left
over from the working title; the DOM tests drive `window.KAMO*` instead. Both are
load-bearing, so don't rename either one to tidy up.

> iOS note: the web camera only works in **Safari**. Chrome/Firefox/Edge on iOS cannot
> access it. Picking a photo works everywhere.

<!-- ci probe: index.html is main as-is; this file is not served -->
