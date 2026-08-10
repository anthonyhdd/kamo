# KAMO

Photo hide-and-seek. You point the camera at a room, the app drops a figure into it, you paint
the figure until it disappears into the background, then you challenge someone to find it.

Three repos, and they are not equals:

| repo | what it is |
|---|---|
| `anthonyhdd/kamo` | **this one.** `index.html` — the entire app, one file. |
| `anthonyhdd/kamo-mirror` | the same file at `kamo.bliss-coach.com`. Share links point here. |
| `anthonyhdd/kamo-app` | the Expo/React Native wrapper on the App Store. A WebView and a bridge. |

KAMO is unrelated to the Sofia/Amelie/Charm/Alex portfolio. Nothing in that CLAUDE.md applies here.

---

## Pushing this repo publishes to every user, within minutes

GitHub Pages serves `index.html` and the app's WebView refetches it **on every launch**. There
is no review, no rollout, no staging. A syntax error anywhere in the inline script takes the
whole app down for everyone at once.

So the gate is **before** the push, not in CI — CI runs after the damage:

```
PW_CORE=<dir with node_modules> node scripts/check.mjs
```

It must be green before every push. It parses every inline script, resolves every unguarded
element id, and chains six browser tests (`test-share`, `test-peek-dom`, `test-mine-dom`,
`test-pass-dom`, `test-home-dom`, `test-seek-dom`). `playwright-core` is not a dependency —
install it anywhere and point `PW_CORE` at it, or the browser tests skip loudly and you are
pushing on the static checks alone.

**Always sync the mirror in the same breath.** Copy `index.html` across and restore the one line
that differs — its `og:image` points at `kamo.bliss-coach.com`, not `anthonyhdd.github.io`.

## Two origins, on purpose

- `anthonyhdd.github.io/kamo/` — what the app loads. **Never attach a custom domain to this
  repo.** Doing so makes it 301 to the apex over cleartext, WKWebView's ATS refuses the
  redirect, and every install shows a blank screen. That is the 2026-08-06 outage, 08:00–12:08.
- `kamo.bliss-coach.com` (the mirror) — where share links land, so a friend without the app gets
  a real page.

`localStorage` is per-origin, so a user's handle, entitlement cache and hide list do not travel
between the two. The app only ever loads the first.

## This repo is also the app's config server

Two JSON files here are fetched by the **binary**, not the page, from the same GitHub Pages
host. They are how native behaviour gets corrected without an App Store review — which is the
difference between a tuning loop of minutes and one of two weeks.

| File | Read by | Effect lands |
|---|---|---|
| `notif.json` | `kamo-app/notifications.js` | next launch of each device |
| `review.json` | `kamo-app/storeReview.js` | next launch of each device |

Both share the same posture, and it matters: every value is **clamped field by field**, anything
wrong (offline, 404, malformed, out of range) falls back to the constant compiled into the
binary, and `enabled: false` is a kill switch. The worst case is the behaviour that shipped. A
typo costs you one value, never the feature.

- **`sessionsBeforeAsk` in `notif.json` was the notification feature's off switch.** At 2, being
  asked at all required coming back a second day, from an audience that arrives on a TikTok ad
  and does not return: 99 of 106 asks died on `not_eligible_yet` and `daily_reminder_scheduled`
  had **never** been ingested by Amplitude. Now 1.
- **`review.json` is inert until the build after 1.0.9** — the code that reads it is not in any
  released binary. Landed first so the config is already serving when that build arrives, rather
  than shipping a build that 404s and quietly runs on defaults.
- Changing notification COPY needs both this file **and** `CH_NOTIF_REV` bumped in `index.html`
  (the page pushes copy over the bridge too). A rev the wrapper has already stored is ignored,
  and the queue runs a fortnight ahead, so an un-bumped edit looks like it never deployed.

Egress is blocked from the agent container, so **neither file can be verified as served from
here** — check them in a browser after a push.

## The wrapper is a version behind, always

App Review takes days; this file takes minutes. As of 2026-08-07 the fleet is **937 users on
1.0.2** and 3 on 1.0.9. Anything the web hands to native must therefore assume the handler may
not exist.

- `nativeCaps` is a capability flag set by the wrapper. Gate on the capability, never on
  `window.ReactNativeWebView` — that is true in *every* wrapper, including the ones that do not
  implement the feature.
- Analytics from the web pass through a compiled `WEB_EVENTS` allow-list in `analytics.js` and
  **anything not on it is silently dropped**. A new event name measures nothing on the live
  build. Two ways round it:
  - `CARRIER_102` — three names on the live allow-list rented out to carry newer events.
  - `WEB_ONLY` — names sent straight to Amplitude from the page, bypassing the bridge. `check.mjs`
    asserts the two sets stay disjoint.

## The pre-push checks are load-bearing, and each one has a story

Every check in `scripts/check.mjs` exists because the thing it asserts already broke in
production. Read the comment before you decide one is being fussy. A few worth knowing:

- The share sheet must not dim or block the reveal in the short state, but **must** take the
  backdrop in the long one (tap-outside-to-dismiss had never once fired — the container was
  `pointer-events:none` in every state).
- No number may be typed into paywall copy; every figure interpolates from its constant.
- Exactly one animation on the share sheet's buttons.
- The round's terms appear once. They were printed twice — a kicker and the card's chips.

## The database

Supabase `qpztlobbnjyjbxqyuzgg`. Two tables: `hides` and `attempts`.

`create_hide` has **three overloads** (6, 8 and 9 arguments) and that is deliberate. This file
deploys on push and the database does not, so during a deploy both are live: a page loaded a
minute ago calls the old signature. Add an overload, never change one. `get_hide` is the
exception — Postgres cannot widen a set-returning function's row type in place, so it has to be
dropped and recreated inside the migration.

Anything a user types that another user's device will render crosses a trust boundary. The
handle is narrowed in three places: the page as it is typed, `create_hide` on insert, and the
seeker screen writes it with `textContent`.

## Founder tools that look like bugs

- **The creator pass.** A SHA-256 in `PASS_HASH`; hold the paywall's Restore button for 1.2s and
  type the phrase to unlock KAMO+. It exists because App Store promo codes grant a free
  *download*, and KAMO is already free — so a code sent to a creator unlocks nothing. What is
  stored is the hash, not a flag, so rotating the constant and pushing revokes every pass ever
  handed out. Real entitlements live in `kamo_pro` and are never touched.
- **The free-user preview.** `FORCE_FREE_HASH`, reached by a 6s press on the wordmark inside the
  member card. It can only ever *remove* Pro.

Neither is a leak. Do not gate them behind `__DEV__` and do not delete them.

## Accounts, keys, ids

| | |
|---|---|
| Amplitude | EU project `100038458`, `app_variant: kamo` |
| RevenueCat | project `proj337c4356`, entitlement `Kamo Pro` |
| Supabase | `qpztlobbnjyjbxqyuzgg` |
| AppsFlyer | app `id6789639784` |
| TikTok | advertiser `7405951008502972433`, app `7664639727052259346` |
| App Store | app id `6789639784`, team `J55T97M8XV` |
| Discord | `https://discord.gg/ET9PYFt8M` |

Versions, fleet split and spend numbers go stale within days. Read them from Amplitude,
RevenueCat and the TikTok API rather than trusting anything written here or in a commit message.

## Where the product actually leaks

Measured 2026-08-07, and worth re-measuring before acting on:

- **The send is the flat number.** ~300 hides published a day, ~71 shares, and roughly one in
  eight challenges is ever played. Every change to the share sheet is judged against this.
- **Paid acquisition loses money per install.** TikTok CPI ~$0.28 against an ARPU of ~$0.084.
- **There is no revenue signal anywhere.** `af_purchase` has never fired, because the live build
  classifies every purchase as a trial. Fixed on `kamo-app` main, unshipped as of this writing.
  Until it ships, no decision about ad optimisation can be made on evidence.
