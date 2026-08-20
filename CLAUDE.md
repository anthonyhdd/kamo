# KAMO

Photo hide-and-seek. You point the camera at a room, the app drops a figure into it, you paint
the figure until it disappears into the background, then you challenge someone to find it.

Three repos, and they are not equals:

| repo | what it is |
|---|---|
| `anthonyhdd/kamo` | **this one.** `index.html` — the entire app, one file. |
| `anthonyhdd/kamo-mirror` | the same file at `kamo.bliss-coach.com`. Share links point here. |
| `anthonyhdd/kamo-app` | the Expo/React Native wrapper on the App Store. A WebView and a bridge. |

The *app* is unrelated to the Sofia/Amelie/Charm/Alex portfolio — none of that product CLAUDE.md
applies to `index.html`. But **KAMO's entire YouTube acquisition pipeline lives in `~/SPANISH`**
(`anthonyhdd/SPANISH`), and that is not a detail: `content-engine/` renders and schedule-uploads
every Short, and the seven ex-persona channels were all converted to KAMO on 2026-08-17. Nothing
in *this* repo mentions YouTube, so anyone asked about the video pipeline, the channels, or where
the views come from will look here, find nothing, and answer from the wrong repo. Read
`~/SPANISH/content-engine/config.json` and `upload.mjs` first — and read them on `main`, because
the working checkout of that repo is usually parked on a feature branch that is weeks behind.

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
element id, and chains **36** browser tests — it was six when this line was written, and naming
them here only teaches the next reader a list that is already wrong; `grep 'test-.*\.mjs'
scripts/check.mjs` is the answer that stays true. `playwright-core` is not a dependency —
install it anywhere and point `PW_CORE` at it, or the browser tests skip loudly and you are
pushing on the static checks alone.

**Always sync the mirror in the same breath.** Copy `index.html` across — the whole file, and
nothing to restore on the way. The two are byte-identical after a correct sync; the mirror's own
`CNAME` is what makes the domain work, and that is a separate file.

⚠️ This paragraph told you until 2026-08-17 to restore an `og:image` pointing at
`kamo.bliss-coach.com`. **Do not.** The tag stopped being per-origin at `fd44f93` — both repos
have served the branded fallback at `playkamo.com/img/og.jpg` since — so following the old
instruction now *introduces* the very difference it was written to preserve, on the one tag that
decides what a share link looks like in a thread. It was found by diffing the two files instead
of trusting this line; do that before believing any other claim of divergence here.

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
- **`review.json` went live with 1.1.0** (published 2026-08-10). It was inert before that — the
  code that reads it was in no released binary — and it landed first on purpose, so the config
  was already serving when the build arrived rather than shipping a build that 404s and quietly
  runs on defaults. Rating thresholds are now tunable without a review.
- Changing notification COPY needs both this file **and** `CH_NOTIF_REV` bumped in `index.html`
  (the page pushes copy over the bridge too). A rev the wrapper has already stored is ignored,
  and the queue runs a fortnight ahead, so an un-bumped edit looks like it never deployed.

Egress is blocked from the agent container, so **neither file can be verified as served from
here** — check them in a browser after a push.

## The wrapper is a version behind, always

App Review takes days; this file takes minutes. Anything the web hands to native must therefore
assume the handler may not exist.

**1.1.0 was published 2026-08-10** and is the first build in months to move any of this. The
fleet does not turn over on release day, though — on 2026-08-07 it was 937 users on 1.0.2
against 3 on 1.0.9, and a migration takes days — so every capability gate below still earns its
keep. What changed is that the gates now open for a growing share of users instead of nobody:
`revealVideo`, `handleStore`, `notifSchedule`, the Photos permission and `review.json` all
arrive with it. Read the live split from Amplitude rather than from this paragraph.

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

Supabase `qpztlobbnjyjbxqyuzgg`. Two tables: `hides` and `attempts` (plus `seek_traces`).

Schema changes are applied through the dashboard and mirrored into `infra/*.sql` as a dated
file. The database has no migration history of its own, so that directory is the only record
of what changed and why.

`hides.is_public` drives the feed and **defaults to FALSE**. That default is a safety property,
not a preference: a `set_hide_public` call that never lands leaves the hide private, so the
failure mode is "this did not reach the feed", never "this reached strangers without being
asked". Everything published before 2026-08-13 is private permanently — it was made when a
hide went to one person and nothing on screen said otherwise. Do not backfill it.

`hides.reply_to` is how "send one back" reaches a person iOS never named. The share sheet never
says who a challenge went to, but the recipient of a *reply* is knowable — it is the creator of
the hide just played — so `chRehide()` captures that id and `chUpload()` stamps it. Two
deliveries, and the order matters: `my_replies()` + the wordmark dot reach **100%** of creators
on their next launch, and `notify_hide_reply` reaches the **~3%** who have a push token, now.
The row is the mechanism; the notification is the accelerant. Do not invert them.

`create_hide` has **four overloads** (6, 8, 9 and 10 arguments) and that is deliberate. This file
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
| Amplitude | EU project `100038458` — do **not** filter on `gp:app_variant`, see below |
| RevenueCat | project `proj337c4356`, entitlement `Kamo Pro` |
| Supabase | `qpztlobbnjyjbxqyuzgg` |
| AppsFlyer | app `id6789639784` |
| TikTok | advertiser `7405951008502972433`, app `7664639727052259346` |
| App Store | app id `6789639784`, team `J55T97M8XV` |
| Discord | `https://discord.gg/ET9PYFt8M` |

Versions, fleet split and spend numbers go stale within days. Read them from Amplitude,
RevenueCat and the TikTok API rather than trusting anything written here or in a commit message.

## Reading the analytics without fooling yourself

Four ways this project has produced a confident, wrong number. Each one cost real hours and
one of them nearly bought a redesign of something that was not broken.

- **Never filter on `gp:app_variant`.** It is a GROUP property and web users do not carry it,
  so it silently zeroes every `WEB_ONLY` event — `hide_published`, `invite_shared`,
  `sheet_presented`, `pose_changed`, `home_opened`, `save_ok`, `handle_restored`, `hide_signed`.
  Use `segments: [{conditions: []}]`. A zero here means "wrong filter", not "nobody did it".

- **Never read one event of the invite/share family alone.** On 2026-08-10 `invite_shared` went
  180 → 22 over the same hourly window, which reads as the loop collapsing by 88%. It was not:
  `invite_native` + `invite_tapped` went 0 → 45 over the same window, taking the volume through
  a newer path. Summed, 180 → 67 — in line with the ~43% Sunday-to-Monday fall across every
  other event, and `share_completed` actually ROSE, 25 → 30. Sum the family before concluding.

- **An event reading zero before a date is usually an event that did not exist.** Check when it
  first appears in `git log` before calling it a drop. `sheet_presented` and `pose_changed` were
  born in commit `6ff7896`, 2026-08-09 17:03 — every zero before that hour is the absence of the
  event, not the absence of the behaviour.

- **`home_opened` is a tap on the wordmark, not an app open.** Its only caller is `brandTap()`.
  Dozens a day against hundreds of publishes is correct and expected; it is not a broken event
  and it does not belong in a funnel next to loop volumes.

`purchase_completed` is wrong in Amplitude (1.0.2 classification bug) — revenue is read from
RevenueCat, never from Amplitude. RevenueCat's own Paywall analytics are empty because the SDK
predates the 5.51.1 requirement, so they cannot arbitrate anything either.

## Where the product actually leaks

Measured 2026-08-07, and worth re-measuring before acting on:

- **The send is the flat number.** ~300-600 hides published a day against ~200-300 shares
  actually sent. The "~71 shares" that stood here until 2026-08-10 was `share_opened`, which
  fires only from `openShareSheet()` — the sheet that presents itself on the reveal never went
  through it, so the most common way anyone meets the sheet was uncounted. Judging share-sheet
  changes against that number was judging them against an instrumentation gap.
- **Paid acquisition loses money per install.** TikTok CPI ~$0.28 against an ARPU of ~$0.084.
- **The revenue signal exists now, and it is young.** `af_purchase` had never fired, because the
  live build classified every purchase as a trial (`isTrialPurchase` read `willRenew`, which is
  always false for a non-consumable). Fixed in `kamo-app` `5aca567`, and that commit first
  reached users with **1.1.0, published 2026-08-11**. TikTok's `ACTIVE_PAY` is off zero — 3
  conversions against 38 `SUBSCRIBE` — so money is finally distinguishable from trials. It will
  only fill in as the fleet leaves 1.0.2, so treat any paid-vs-trial ratio before ~mid-August as
  measuring adoption of the new binary, not user behaviour.
- **Subscription and lifetime are NOT confounded, in any of the three systems** — checked
  2026-08-11, because the question keeps coming back. RevenueCat reports the 4 one-time
  purchases in its own Non-subscription Purchases chart and keeps them out of MRR (which
  matches 3 weeklies at $2.99); TikTok carries `SUBSCRIBE`, `IN_APP_ORDER` and `ACTIVE_PAY` as
  distinct events with distinct counts. The `Type: Subscription` label on
  `com.blisscoach.kamo.pro`'s RevenueCat product page is cosmetic — its transactions are
  recorded `ONE TIME` — and it has 4 paying customers behind it, so **do not "fix" it by
  detaching it from the entitlement or changing its type.** The open question is which event the
  ad groups optimise on, not whether the events are separable.
