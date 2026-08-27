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
element id, and chains **42** browser tests — it was six when this line was written, and naming
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

### The push throttle is a priority, not an hour (2026-08-25)

`notify_hide_creator` / `_reaction` / `_reply` used to share one rule — nothing if this hide was
notified in the last hour — which treats every event as worth the same. Measured over 4214
authors, the odds of creating again on a second day are **47.4% after a reply**, **44.6% after a
reaction**, **28.4% after being merely played**, against a 25.6% baseline and 21.0% when nothing
came back at all. A hide takes ~3 attempts, so the cheap signal routinely arrived first, spent
the hour, and the two that actually bring somebody back were dropped in silence.

So: `found(1) < reaction(2) < reply(3)`, via `push_may_notify()` — inside the hour only a
strictly stronger kind may speak, and **two minutes is the floor nothing crosses** (priority
without one puts two buzzes about one hide on a lock screen seconds apart, which is how an app
loses its notifications for good). One shared gate instead of three copies of the same interval;
`infra/2026-08-25-push-priority.sql` is the record.

⚠️ **This is not the bottleneck, and do not let the change suggest otherwise.** Only **3370 of
18682** hides carry a `push_token`, so **721 reactions and 771 replies** could not be announced
at all — the trigger ran, found no token, and returned. All three kinds have been wired and
enabled since 2026-08-16; what is missing is the notification permission, and that is fixed on
the client, not here. Judge this change on pushes *sent per reaction/reply*, never on the total.

`infra/edge-notify-creator.ts` mirrors the deployed `notify-creator` function, the same way
`edge-h.ts` mirrors `h`. **It is a copy, not the source of truth** — the function lives in
Supabase and deploying does not touch this repo, so diff the two before believing either.
Its reaction line printed the emoji three times (twice bracketing the title, once in the
subtitle) until a real lock screen showed what that looks like — 2026-08-25, now one.

### The nightly purge ran twenty times and deleted nothing (2026-08-26)

`cleanup_expired_hides()` — pg_cron job 1, `20 3 * * *` — opened with a direct
`delete from storage.objects`. Supabase has since put `storage.protect_delete()` in front of
that table, so it raises, and being the *first* statement it took the `delete from hides`
underneath with it: **20 runs since 2026-08-07, 0 successes**, nothing ever purged. Nobody
noticed, because the only place it was written down is `cron.job_run_details`.

The trigger is right and `infra/2026-08-26-cleanup-storage-api.sql` does not go round it —
deleting the storage *row* never deleted the *bytes*, so the old function could not have shrunk
the bucket even on a night it worked. The work moves to `infra/edge-cleanup-hides.ts` over
pg_net. **First expiry is 2026-09-04**, with 10 679 hides due inside three weeks, so the window
to get this right closes then.

Four things about the purge that are not obvious from any one file:

- **A hide is 2.48 objects.** `chUploadReveal()` posts `<base>_b.jpg` and `<base>_w.jpg` beside
  the photo — the seeker's snap and A/B flip — at names derived from `img_path` and stored in no
  column. They are 27 918 of the bucket's 48 371 objects and more than half its bytes. Anything
  that deletes a hide must delete all three, or the bucket keeps growing at 60% speed.
- **⚠️ Never sweep storage on "no `hides` row names this object".** 30 028 objects match that,
  and 27 912 of them are the reveal frames of *live* hides — unreferenced by construction. Such
  a sweep takes the payoff frame off every current hide. The genuinely unreferenced population
  is 2 110 objects / 167 MB, and the query that isolates it is at the foot of the migration.
- **The play history now outlives the hide, deliberately** (`2026-08-26-keep-attempt-history.sql`).
  `attempts` and `seek_traces` cascaded off `hides`, so the newly-working purge would have
  destroyed the evidence behind every retention figure above — computed over exactly the
  thirty-day window being purged. Both FKs were dropped; the indexes stayed. Nothing was given
  up doing it: `submit_attempt` and `save_seek_trace` are the only write paths and both already
  check the hide more strictly than the FK did. Each run reports `attempts_kept` / `traces_kept`.
  ⚠️ The cost is that both tables grow forever — ~127 MB/year for `attempts`, ~600 MB/year for
  `seek_traces`. If space bites, window `seek_traces`; never trim `attempts`. And any GLOBAL
  count over either table now includes rows whose hide is gone, which is the point — but a query
  that joins to `hides` to filter will silently drop them.
- **⚠️ `jobid = 1` reads SUCCESS from now on whatever happens.** pg_net is fire-and-forget, so
  cron only sees "request queued". **Read `jobid 3, kamo-cleanup-check` instead** — it runs at
  03:40 and raises when the last run was not clean, so `cron.job_run_details` means something
  again, with the reason in `return_message`. The full detail is `public.ops_cleanup`: a row per
  night, opened at dispatch and closed by the Edge Function, so a run that never reports back
  stays visibly `dispatched` and both the check and the next dispatch catch it.

Two properties are load-bearing and `scripts/test-edge-cleanup.mjs` is what stops them
regressing: the `hides` rows are deleted **even when the bucket refuses** (a refused path goes
to `ops_cleanup_orphans` and is retried later, never forgotten), and an object shared with a
*surviving* hide is never touched. That second one is not theoretical — it fired on the very
first live run. One of the two blocked hides shared its photo with `557ad8f202004d35`, public
and played 7 times; the old function would have deleted that file and left a live hide showing
nothing. 323 `img_path` values are shared this way, because a re-hide reuses its source object.

Applied and proven 2026-08-26: 36 ms per hide at `batch_size 200` (165 ms at 10 — the per-batch
overhead is the cost, so don't lower it). Neither this nor the photo probe has a webhook, so
their alerts land as `raise warning` in the Postgres log; nothing depends on it, because the
03:40 check is what makes a bad night visible. A webhook only turns "go and look" into "you are
told", and it is one `update … set webhook_url` whenever there is somewhere to send it.

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

### Retention, measured 2026-08-24 — and the number every reveal change is judged against

Cohorts computed by window intersection (A + B − union), because Amplitude's retention CSV
returns cohort sizes rather than rates. In-app only (`host = "app"`): the browser population is
~89% automated and poisons every denominator it touches.

| | |
|---|---|
| D1 open (22→23/08) | 86/510 = **16.9%** |
| D1 create | 39/387 = **10.1%** |
| W1→W2 (10-16 → 17-23/08) | 339/1846 = **18.4%** |
| DAU/MAU creators | **9.8%** |
| Make 2+ hides in one sitting | **57.5%** |

The shape is unambiguous, and it is not an engagement problem: **the session is excellent and the
next day does not exist.** Of the few who do return, 45% create. There is no return trigger.

- **The send rate is the guard metric on every reveal/share change, without exception.** 47.6%
  of publishers send. A hide nobody receives has no answer and no reason to bring anyone back,
  so half the creator base sits outside the retention loop by construction. It is also the most
  fragile number in the product — 57.3% on 08-14, 38.7% on 08-22 — and it has been broken twice
  by things that merely sat NEAR the send button: the feed's `.kfHint` pill covering "Send to a
  friend" (08-20, −62%) and the feed-landing arm opening a feed behind the share sheet (08-22,
  halved, killed 08-23). **Read `hide_sent / hide_published` before and after anything that
  touches the reveal, the sheet, or what sits behind it.** Reading the DOM is not enough — both
  failures shipped with the button present and visible.
- **The return machinery is all built; permission is the entire bottleneck.** `armResultsPing`
  schedules the local nudge, `chTally` renders what happened while you were away, the news tray
  orders replies first. But `web_notif_armed` is **ok=false for 3099 users a week against
  ok=true for 500** — six of seven nudges are dropped. And iOS asks exactly once: the prompt
  fires automatically seconds after the share sheet opens, carrying one line of context
  (`#ssSub`), so most of that 3099 is a refusal that has already happened and cannot be re-asked.
  `#ssBell` recovers what it can. The untried lever is gating that one prompt behind a
  deliberate tap instead of spending it automatically.
- **911 replies waited, 287 were opened.** The highest-intent event in the product — somebody
  built an answer addressed to you — is announced by an ~18px grey dot on the wordmark. 624
  people a week were answered and never knew. `REPLY_OPEN_ROLLOUT` tests the fix; as of 08-24 it
  is **not readable** (11 in-app `reply_opened` in three days, and 93% of `hide_sent` still carry
  no `open_arm`), so do not conclude it yet.

### Three mechanics added 2026-08-25, and what each is judged on

All three come out of the same reading of the table above: KAMO does not have a motivation
problem, it has a **restitution** problem. 57.5% make two hides in one sitting, then the hide goes
off and accumulates real outcomes — 63% of hides get played by three people or more — and its
maker learns none of it.

**The run survives its first miss, once.** `kamo_seek_life`, spent on the first miss of a run of 2
or more and given back by the next find (and by a death, so a fresh run never starts already
spent). `"0"` means spent; anything else, missing key included, means available. The median best
run in the base is 3 — one miss sent it to zero, which is the mechanic shape that teaches a player
there is nothing left to come back for. ⚠️ This is a **session** streak, not a day streak: it buys
session depth and should not be expected to move D1. Judge it on `run_saved{at}` against
`run_broken{at}` on the same population — if saves cluster at 2 and 3 the life is buying nothing
anybody would have missed, and if run_broken's distribution moves right, it worked. In tests, seed
`kamo_seek_life` explicitly: an unseeded break case silently becomes a save case that still reads
a pill.

**The hide's record travels.** `get_hide` returns `best_ms` (hits only, `ms > 0` only — a miss
carries an `ms` that measures failing, and 155 hit rows in 30 days carry `ms <= 0`). NULL on the
44% of played hides nobody has cracked; `chBestS()` tests the return, never the field, so none of
them can claim 0.0s. The re-send says "2 of 7 have found it — fastest 4.1s."

**The unbeaten hide goes out as a dare.** `CH_UNBEATEN_MIN = 3`: 1 950 of 18 919 hides over 30
days have ≥3 attempts and no find (10.3%, ~65/day). The row says "unbeaten · 4 have tried" and the
re-send says "Nobody has found it." The seeker's stakes line already dared on this exact number;
the constant exists so the two surfaces cannot drift.

⚠️ **The one rule these did not break.** "The re-send quotes no numbers at all" was about the
round's TERMS — `limit_s` / `max_taps` are a promise about how the round will run, they still sit
on old rows, and nothing honours them, so quoting them promised a dead deal. `n_attempts`,
`n_found` and `best_ms` are a REPORT of what other people already did: it cannot come untrue and
the recipient cannot be short-changed on it. `test-mine-dom` asserts both on the same string.

Split `resend_tapped` on `record` and `unbeaten`. If neither beats the plain invitation, the
numbers are decoration and both come back out.
