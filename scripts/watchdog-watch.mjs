#!/usr/bin/env node
/**
 * THE WATCHDOG'S SCHEDULE WAS NOT RUNNING. This is the fix, and it is not a new check.
 *
 * watchdog.mjs is correct and stays untouched: one sweep, exit 0 or 1, run it by hand on a
 * laptop exactly as before. What was broken is how often GitHub actually ran it.
 *
 * MEASURED 2026-09-18, over the 403 runs of the previous 30 days:
 *
 *     cron says            every 10 min   (4306 runs in the window)
 *     actually fired       403 runs       = 9.4% of them
 *     gap between checks   median 49 min · p90 4h33 · WORST 12h32
 *
 * Scheduled workflows are explicitly best-effort — GitHub sheds them under load, and sheds
 * high-frequency ones hardest. So the file whose header promises to "turn a four-hour outage
 * into a ten-minute one" was, on its worst day, blind for twelve and a half hours. That is
 * longer than the outage it was written for. Nobody could see this from the repo: the cron
 * line says 10 minutes and the runs that never happen leave no trace.
 *
 * ONE RUN THAT WATCHES FOR HOURS, instead of many runs that mostly do not happen. A fired run
 * sweeps every two minutes until its deadline, so a single fire buys ~5h45 of real coverage
 * at 2-minute resolution. The ten-minute cron stays exactly as it is, and becomes the way back
 * in rather than the mechanism: whenever a fire does get through while nothing is watching, it
 * starts the next watcher, and the concurrency group in the workflow keeps that to one live
 * watcher plus at most one waiting to take over.
 * Actions minutes are free on a public repo, and this job sleeps through almost all of them.
 *
 * ⚠️ AND CADENCE ALONE WOULD HAVE MADE IT WORSE, which is the other half of this file.
 * Going from 4 sweeps a day to ~700 multiplies false alarms by the same factor, and an alert
 * that cries wolf gets filtered to a folder — at which point the watchdog is worse than
 * nothing, because it looks like cover. The run of 2026-09-18 18:32 is the case in point: one
 * HTTP 503 from GitHub Pages on the app origin, while the mirror answered 200 in the same
 * second, and the next sweep was clean. That is a CDN blip, not an outage, and at two-minute
 * resolution there will be one most days.
 *
 * So a failure is never reported on first sight. It is re-swept CONFIRM_S later, and only a
 * failure that is still there the second time exits non-zero. What that costs is 45 seconds
 * of delay on a real outage. What it buys is that a red run means something.
 *
 * A blip that keeps coming back is NOT a blip, so they are counted in a ROLLING WINDOW:
 * FLAP_ALERT of them within FLAP_WINDOW_MIN and the run goes red anyway, naming the count. An
 * origin that fails a tenth of requests is an outage for a tenth of users, and it is exactly
 * the shape that "re-check and shrug" would otherwise hide forever. The window is what keeps
 * that from becoming its own false alarm: five blips spread across a six-hour watch is two
 * CDNs being CDNs, five inside an hour is an origin degrading.
 *
 *   node scripts/watchdog-watch.mjs
 *
 * Env, all optional — the defaults are the production contract, the knobs exist for
 * scripts/test-watchdog-watch.mjs, which drives this with seconds instead of hours:
 *   KAMO_WATCH_MINUTES            how long this run watches for    (default 340)
 *   KAMO_WATCH_EVERY_S            seconds between sweeps           (default 120)
 *   KAMO_WATCH_CONFIRM_S          pause before re-testing a fail   (default 45)
 *   KAMO_WATCH_FLAP_ALERT         blips in the window before red   (default 5)
 *   KAMO_WATCH_FLAP_WINDOW_MIN    how long a blip is remembered    (default 60)
 *   KAMO_WATCH_SWEEP_TIMEOUT_S    a sweep that hangs is a failure  (default 90)
 * Everything watchdog.mjs itself reads (KAMO_WATCH_ORIGINS, KAMO_CANARY_HIDE, …) is inherited
 * untouched — this process only decides WHEN to run it, never what it checks.
 */
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const num = (name, dflt) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : dflt;
};
const MINUTES = num('KAMO_WATCH_MINUTES', 340);
const EVERY_S = num('KAMO_WATCH_EVERY_S', 120);
const CONFIRM_S = num('KAMO_WATCH_CONFIRM_S', 45);
const FLAP_ALERT = num('KAMO_WATCH_FLAP_ALERT', 5);
const FLAP_WINDOW_MIN = num('KAMO_WATCH_FLAP_WINDOW_MIN', 60);
/* THE BOUND THE JOB TIMEOUT USED TO PROVIDE. The old workflow capped the whole thing at five
   minutes, so a hung request could not cost more than that. This one runs for hours, and
   node's fetch has NO default timeout — an origin that accepts the connection and then never
   answers would park the watcher until the job timeout, six hours later, with the log ending
   in nothing. And a hanging origin is not a stalled runner: it is an outage, and the shape it
   would take is the one failure this file must never mistake for infrastructure.
   90s: a healthy sweep is four requests and takes about a second. */
const SWEEP_TIMEOUT_S = num('KAMO_WATCH_SWEEP_TIMEOUT_S', 90);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = () => new Date().toISOString().slice(11, 19) + 'Z';

/* CAPTURED, NOT INHERITED. A healthy sweep prints ~17 lines; at this cadence that is three
   thousand lines of "✓" per run, in which the one red sweep is invisible. So the output is
   held and printed only when it is worth reading: the first sweep (which is the log of what
   is actually being checked, and the proof the watcher started correctly) and any failure.
   Everything else collapses to one heartbeat line — enough to tell a watcher that is alive
   from a runner that froze, which is the only other thing this log has to answer. */
function sweep() {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(ROOT, 'scripts', 'watchdog.mjs')], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let done = false;
    const finish = (r) => { if (done) return; done = true; clearTimeout(timer); resolve(r); };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish({ code: 1, out: out + `  ✗ the sweep did not answer within ${SWEEP_TIMEOUT_S}s — an origin is`
        + ' accepting connections and never replying, which is an outage that returns no status code.\n' });
    }, SWEEP_TIMEOUT_S * 1000);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    /* A spawn that never starts (bad path, no node) must not read as a healthy sweep. */
    child.on('error', (e) => finish({ code: 1, out: `  ✗ could not run watchdog.mjs: ${e.message}\n` }));
    /* `code` is null when the child died on a signal — that is a failure, not a pass. */
    child.on('close', (code) => finish({ code: code === 0 ? 0 : 1, out }));
  });
}

/* The child ends every run with its own verdict line. On a sweep we have decided NOT to alert
   on, printing "KAMO IS BROKEN IN PRODUCTION" under a heading that says we are re-testing is
   how a reader — or a founder skimming an email — concludes the opposite of what happened.
   The child's verdict is about one sweep; ours is the one that counts. */
const withoutVerdict = (out) => out.split('\n').filter((l) => !/KAMO IS BROKEN IN PRODUCTION/.test(l)).join('\n');

const started = Date.now();
const deadline = started + MINUTES * 60_000;
let sweeps = 0;
/* Timestamps, not a count. Five blips spread over a six-hour watch is two CDNs being CDNs;
   five inside an hour is an origin failing a measurable share of requests. A counter that
   never resets cannot tell those apart, and on a watch this long it would eventually reach
   the threshold on a healthy day — which is the crying wolf this whole file exists to avoid,
   rebuilt one level up. */
const blips = [];

console.log(`watching production every ${EVERY_S}s for ${MINUTES} min `
  + `(a failure is re-tested after ${CONFIRM_S}s before it counts; `
  + `${FLAP_ALERT} blips within ${FLAP_WINDOW_MIN} min is itself an alert)`);

for (;;) {
  sweeps += 1;
  const first = await sweep();

  if (first.code === 0) {
    if (sweeps === 1) process.stdout.write(first.out);
    else console.log(`  ✓ ${stamp()} sweep ${sweeps} — production is healthy`);
  } else {
    console.log(`\n  ! ${stamp()} sweep ${sweeps} FAILED — re-testing in ${CONFIRM_S}s before calling it an outage`);
    process.stdout.write(withoutVerdict(first.out));
    await sleep(CONFIRM_S * 1000);

    const second = await sweep();
    if (second.code !== 0) {
      console.log(`\n  ✗ ${stamp()} STILL FAILING ${CONFIRM_S}s later — this is not a blip:\n`);
      process.stdout.write(second.out);
      console.log(`\n✗ KAMO IS BROKEN IN PRODUCTION — confirmed twice, ${CONFIRM_S}s apart`);
      process.exit(1);
    }

    const now = Date.now();
    blips.push(now);
    while (blips.length && now - blips[0] > FLAP_WINDOW_MIN * 60_000) blips.shift();
    console.log(`  · ${stamp()} the second look was clean — transient blip `
      + `${blips.length}/${FLAP_ALERT} in the last ${FLAP_WINDOW_MIN} min, not alerting`);
    if (blips.length >= FLAP_ALERT) {
      console.log(`\n✗ ${blips.length} TRANSIENT FAILURES within ${FLAP_WINDOW_MIN} min — `
        + 'an origin that fails this often is down for that share of users.\n'
        + '    Each one recovered within seconds, which is why no single sweep is red. Look at the\n'
        + '    sweeps above: if they name one origin, that CDN or Worker is degraded, not flaky.');
      process.exit(1);
    }
  }

  if (Date.now() + EVERY_S * 1000 >= deadline) break;
  await sleep(EVERY_S * 1000);
}

/* Exit 0 at the deadline. This is a handover, not an all-clear for the hours that follow:
   the next scheduled fire — or the one already waiting in the concurrency group — takes over,
   and if none ever comes, the gap is the thing the cron line is there to close. */
console.log(`\n✓ watched for ${Math.round((Date.now() - started) / 60_000)} min · ${sweeps} sweeps · `
  + `${blips.length} transient blip(s) in the final window · production healthy at handover`);
process.exit(0);
