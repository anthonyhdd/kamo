#!/usr/bin/env node
/**
 * Tests for watchdog-watch.mjs — the supervisor, not the checks.
 *
 * test-watchdog.mjs already proves watchdog.mjs fails on everything it claims to catch. What
 * is untested by it, and what this file exists for, is the layer that decides WHEN to sweep
 * and WHETHER a red sweep is worth an email. That layer has exactly one job and two ways to
 * fail, and both are silent:
 *
 *   · it alerts on a blip  → ~700 sweeps a day means a CDN hiccup pages the founder most
 *     days, the alert gets filtered to a folder, and the watchdog becomes cover rather than
 *     protection. This is the likelier failure, and the worse one, because a filtered alert
 *     still looks like it is working.
 *   · it swallows an outage → the run stays green through a production that is down, which
 *     is the exact hole the watchdog was written to close.
 *
 * Neither is visible from reading the file, and neither can be rehearsed against production.
 * So the sweeps are driven against a local server that is told when to break, including the
 * case that actually happened on 2026-09-18: one HTTP 503 on one origin, gone by the next
 * sweep.
 *
 *   node scripts/test-watchdog-watch.mjs
 */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REAL = readFileSync(join(ROOT, 'index.html'), 'utf8');

/* THE FIXTURE COUNTS REQUESTS, NEVER CLOCK TIME, and one sweep is exactly one request to the
   origin (watchdog.mjs fetches each origin once; the challenge and universal-links checks are
   skipped whenever KAMO_WATCH_ORIGINS is set). So request numbers ARE sweep numbers, and every
   case below is decided rather than raced.
   The first version of this file flipped a flag on a 400ms setInterval and the confirming
   sweep sometimes landed on a broken request — which made a flapping origin look like a dead
   one and passed for the wrong reason.

     breakFor = n   the next n requests fail, the rest are healthy. n=1 is the blip.
     alternate      every ODD request fails: the sweep breaks, the re-test recovers, forever.
                    That is the degraded origin — half of users get an error page and no
                    single sweep is ever red twice in a row. */
let breakFor = 0;
let alternate = false;
let hang = false;
let seen = 0;
const open = new Set();
const server = createServer((req, res) => {
  seen += 1;
  /* ACCEPTED AND NEVER ANSWERED. Not a 503, not a reset — the request simply stays open, which
     is the one failure that returns no status code and therefore has no timeout of its own:
     node's fetch waits forever. Held in a set so server.close() at the end of the file is not
     blocked by a socket this test deliberately left dangling. */
  if (hang) { open.add(res); return; }
  let down = false;
  if (alternate) down = seen % 2 === 1;
  else if (breakFor > 0) { breakFor -= 1; down = true; }
  if (down) {
    res.writeHead(503);
    return res.end('503: Service Unavailable');
  }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(REAL);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;

let failed = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { failed++; console.error('  ✗ ' + m); };

/* Seconds instead of hours. The supervisor's defaults are the production contract (340 min,
   120s, 45s); every one of them is overridable for exactly this reason, and the assertions
   below are about the DECISIONS, which are the same at any scale.
   ⚠️ KAMO_WATCH_ORIGINS is set on every run, which is also what keeps the challenge-link and
   universal-links checks pointed away from the real playkamo.com — see the skip at the foot
   of watchdog.mjs. A unit test must not reach the internet. */
function watch(env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(ROOT, 'scripts', 'watchdog-watch.mjs')], {
      env: {
        ...process.env,
        KAMO_WATCH_ORIGINS: JSON.stringify([{ name: 'test origin', url }]),
        KAMO_WATCH_MINUTES: '0.2',      // 12s
        KAMO_WATCH_EVERY_S: '1',
        KAMO_WATCH_CONFIRM_S: '1',
        KAMO_WATCH_FLAP_ALERT: '3',
        ...env,
      },
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('close', (code) => resolve({ code, out }));
  });
}

console.log('\nIT KEEPS SWEEPING, AND SAYS SO');
{
  breakFor = 0;
  const r = await watch({});
  const sweeps = (r.out.match(/sweep \d+ — production is healthy/g) || []).length;
  r.code === 0
    ? ok('a healthy origin watched to the deadline → exit 0')
    : bad(`a healthy origin failed the watch, so every run would cry wolf:\n${r.out}`);
  sweeps >= 3
    ? ok(`it swept ${sweeps + 1} times in one run — which is the whole point: one fire, many checks`)
    : bad(`only ${sweeps + 1} sweep(s) in the window — the loop is not looping:\n${r.out}`);
  /* The first sweep prints in full and the rest collapse to a line. Without this a six-hour
     run is three thousand lines of ✓ with the one red sweep buried in it. */
  /\n✓ production is healthy/.test(r.out) && /sweep 2 — production is healthy/.test(r.out)
    ? ok('the first sweep prints in full, the rest collapse to one heartbeat line')
    : bad(`the log shape is wrong — a six-hour run has to stay readable:\n${r.out}`);
}

console.log('\nA BLIP DOES NOT WAKE ANYBODY — the 2026-09-18 case');
{
  /* One 503, then healthy. Exactly what GitHub Pages served at 18:32 UTC while the mirror
     answered 200 in the same second. The old workflow turned that into a red run and an
     email; at two-minute resolution it would do so most days. */
  breakFor = 1;
  const r = await watch({});
  r.code === 0
    ? ok('one 503 followed by a clean re-test → the run stays green')
    : bad(`a single transient 503 alerted, which is how an alert gets filtered to a folder:\n${r.out}`);
  /transient blip 1\/3 in the last \d+ min, not alerting/.test(r.out)
    ? ok('and it is named in the log rather than hidden — a blip is data, not nothing')
    : bad(`the blip was not reported at all, so a degrading origin would look perfect:\n${r.out}`);
  /re-testing in 1s before calling it an outage/.test(r.out)
    ? ok('the log says why it waited, so the 1s delay is never mistaken for a hang')
    : bad(`no explanation of the re-test in the log:\n${r.out}`);
}

console.log('\nA REAL OUTAGE STILL GOES RED');
{
  /* Broken for more requests than the run can make: the failure is there on the first sweep
     and still there on the confirming one. */
  breakFor = 999;
  const r = await watch({});
  r.code === 1
    ? ok('an origin that stays down → exit 1, which is the email')
    : bad(`PRODUCTION WAS DOWN AND THE RUN WAS GREEN (exit ${r.code}) — the watchdog is cover, not protection:\n${r.out}`);
  /STILL FAILING 1s later/.test(r.out) && /HTTP 503/.test(r.out)
    ? ok('and the log carries the confirming sweep, so the email names the fault')
    : bad(`the failing output was not printed — an email with no cause is an email nobody acts on:\n${r.out}`);
  /confirmed twice/.test(r.out)
    ? ok('it says the failure was seen twice, so the reader knows it is not a hiccup')
    : bad(`the verdict does not say it was confirmed:\n${r.out}`);
}

console.log('\nA BLIP THAT KEEPS COMING BACK IS NOT A BLIP');
{
  /* THE FAILURE MODE THE RE-TEST CREATES. An origin that fails every other request recovers
     on every confirming sweep, so no single sweep is ever red twice — and a watchdog that
     only re-tests and shrugs would stay green forever while half of users get an error page.
     Three blips inside one watch is itself the alert.
     `alternate` makes every odd request fail, so each cycle is: sweep breaks, re-test
     recovers, blip counted. Deterministic, and the exact shape the re-test would hide. */
  breakFor = 0; seen = 0; alternate = true;
  const r = await watch({ KAMO_WATCH_MINUTES: '1' });
  alternate = false;
  r.code === 1
    ? ok('enough transient failures in one watch → exit 1, naming the count')
    : bad(`an origin failing every other request watched green to the end (exit ${r.code}) — `
      + `the re-test turned a real outage into silence:\n${r.out}`);
  /TRANSIENT FAILURES within \d+ min/.test(r.out)
    ? ok('and the verdict says degraded rather than down, which is a different fix')
    : bad(`the alert does not distinguish a degraded origin from a dead one:\n${r.out}`);
}

console.log('\nAN ORIGIN THAT NEVER ANSWERS IS AN OUTAGE, NOT A STALLED RUNNER');
{
  /* THE BOUND THE OLD FIVE-MINUTE JOB TIMEOUT USED TO PROVIDE, and the reason this run cannot
     inherit it: node's fetch has no default timeout, so one origin that accepts the connection
     and goes quiet would park the watcher for the full six hours and end the log in nothing —
     which the workflow tells the reader to interpret as a dead runner. That would turn a real
     outage into "infrastructure, ignore it", which is the worst failure this file can have. */
  breakFor = 0; alternate = false; hang = true;
  const r = await watch({ KAMO_WATCH_SWEEP_TIMEOUT_S: '1', KAMO_WATCH_MINUTES: '0.5' });
  hang = false;
  for (const res of open) { try { res.destroy(); } catch {} }
  open.clear();
  r.code === 1
    ? ok('a hung origin → exit 1 rather than a watcher parked until the job timeout')
    : bad(`an origin that never answered was watched green (exit ${r.code}) — the run would have\n`
      + `    died on the job timeout hours later, logged as infrastructure:\n${r.out}`);
  /did not answer within 1s/.test(r.out)
    ? ok('and the log names the hang, which no status code ever would')
    : bad(`the timeout is not explained in the log:\n${r.out}`);
  /KAMO IS BROKEN IN PRODUCTION/.test(r.out)
    ? ok('it ends on the verdict the workflow tells the reader to look for')
    : bad(`the run ends without a verdict, which is the signature of a dead runner:\n${r.out}`);
}

console.log('\nAND IT CANNOT PASS BY NOT RUNNING THE CHECKS AT ALL');
{
  /* The bug that would make every assertion above vacuous: a supervisor that mis-spawns the
     child, reads the failure as a 0 and loops happily. `code === 0 ? 0 : 1` in sweep() is one
     keystroke from being wrong, and nothing else in this file would notice. */
  breakFor = 0;
  const r = await watch({ KAMO_WATCH_MINUTES: '0.05' });
  /app origin|test origin/.test(r.out)
    ? ok('the sweeps really ran watchdog.mjs — its output is in the log')
    : bad(`no sweep output at all: the supervisor is looping without checking anything:\n${r.out}`);
}

server.close();
console.log(failed ? `\n✗ ${failed} failure(s)` : '\n✓ the watcher sweeps, tolerates a blip, and still calls an outage an outage');
process.exit(failed ? 1 : 0);
