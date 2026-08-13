#!/usr/bin/env node
/**
 * THE SESSION CLIP'S CLOCK.
 *
 * The Instagram share is now the round played back at the length it actually took — the
 * seconds of framing before the shutter, then the paint, each frame held until the next
 * frame's mark. sessionPayload() is where that timeline is built, and it is the one part of
 * the feature that can be wrong in a way NOTHING reports:
 *
 *   - a frame list and a mark list of different lengths → native falls back to even pacing
 *     and the whole point of the change silently disappears;
 *   - two frames on the same millisecond → a zero-length frame, which is a frame that never
 *     gets drawn, so a stroke vanishes from the replay;
 *   - marks that do not start at zero → the clip opens on a hold of arbitrary length;
 *   - no ceiling → a four-minute round becomes a four-minute video, and Instagram Stories
 *     truncates a segment at 60s, mid-reveal.
 *
 * Every one of those still renders a video. None of them throws. The only witness is someone
 * watching the output and feeling that it is off, which is exactly the class of bug that
 * survives for weeks.
 *
 * WHY A HOOK. The page's script is a module, so its top-level names are unreachable from
 * page.evaluate, and exposing sessionPayload on window would ship a test-only global to every
 * user. The hook below is injected into the TEST COPY of index.html only — the served bytes,
 * never the file — which is the same trick test-reflink-dom and test-seek-dom use for chRpc.
 *
 * It also asserts the thing that keeps everyone else safe: with no `sessionVideo` capability
 * — a browser, or any binary shipped before this one — sessionPayload() returns null and the
 * share collapses to exactly the payload that ships today.
 *
 *   PW_CORE=<dir with node_modules> node scripts/test-session-dom.mjs
 */
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { pwBases, chromeExe, PW_SETUP } from './lib/pw.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const req = createRequire(import.meta.url);
let chromium = null;
for (const base of pwBases(ROOT)) {
  try { ({ chromium } = req(base ? join(base, 'node_modules/playwright-core') : 'playwright-core')); break; } catch {}
}
if (!chromium) {
  console.log('· playwright-core not installed — skipping the session test — run: ' + PW_SETUP);
  process.exit(0);
}

const real = readFileSync(join(ROOT, 'index.html'), 'utf8');
/* Anchored on the constant, not on the function: a function declaration is hoisted, so an
   anchor on one would let the hook be installed above the `let` bindings it writes to and
   every seed would throw on a temporal dead zone. This line sits below all of them. */
const ANCHOR = 'const SESS_MAX_MS=42000;';
if (!real.includes(ANCHOR)) {
  console.error('  ✗ anchor ' + JSON.stringify(ANCHOR) + ' is gone — this test needs updating');
  process.exit(1);
}
const HOOK = ANCHOR + `
window.__sess={
  seed:(preMarks,tlMarks)=>{
    preFrames=preMarks.map(t=>({d:"data:image/jpeg;base64,PRE",t}));
    tlFrames=tlMarks.map((_,i)=>"data:image/jpeg;base64,TL"+i);
    tlTimes=tlMarks.slice();
  },
  payload:()=>sessionPayload(),
  max:SESS_MAX_MS
};`;
const pageHtml = real.replace(ANCHOR, HOOK);

const MIME = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.css': 'text/css', '.woff2': 'font/woff2' };

let failed = 0;
const ok = (m) => console.log('  ✓ ' + m), bad = (m) => { failed++; console.error('  ✗ ' + m); };

const exe = chromeExe();
if (!exe) { console.log('· no Chrome or Chromium found — skipping (set PW_CHROME=<path>)'); process.exit(0); }

/* Real files for everything but the document: the page loads its script as a module, and a
   server that answers text/html to every path makes the browser refuse it under strict MIME
   checking — the whole app then does nothing, which looks exactly like a failing assertion. */
const server = createServer((rq, rs) => {
  const p = decodeURIComponent(rq.url.split('?')[0]);
  if (p === '/' || p === '/index.html') { rs.writeHead(200, { 'Content-Type': 'text/html' }); return rs.end(pageHtml); }
  try {
    const b = readFileSync(join(ROOT, p.replace(/^\/+/, '')));
    rs.writeHead(200, { 'Content-Type': MIME[p.slice(p.lastIndexOf('.'))] || 'application/octet-stream' });
    rs.end(b);
  } catch { rs.writeHead(404); rs.end('x'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch({ executablePath: exe });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: [] });
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error') process.env.KAMO_VERBOSE && console.log('    [page] ' + m.text()); });
await page.goto(base, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__sess, null, { timeout: 15000 });

const T0 = 1_700_000_000_000;   // any fixed epoch — only the differences are read
const call = (caps, pre, tl) => page.evaluate(([c, p, t]) => {
  if (c) window.KAMO.setNativeCaps(c);
  window.__sess.seed(p, t);
  return { out: window.__sess.payload(), max: window.__sess.max };
}, [caps, pre, tl]);

console.log('\nWITHOUT THE CAPABILITY, NOTHING CHANGES');
{
  /* The default caps in a browser: no wrapper at all. A payload here would mean the share
     stopped being the one that ships, for every user who is not on the new binary. */
  const { out } = await call({ revealVideo: true }, [T0], [T0 + 500, T0 + 900]);
  out === null
    ? ok('no sessionVideo → sessionPayload() is null and the share stays exactly as it ships')
    : bad(`a wrapper without the capability got a session payload (${JSON.stringify(out).slice(0, 120)}) —\n`
      + '    it would post `times` to a renderer that cannot read them');
}

console.log('\nWITH IT, THE CLIP IS THE ROUND AT ITS OWN LENGTH');
const CAPS = { revealVideo: true, sessionVideo: true };
{
  // 2.4s of framing, then a 12s round of four strokes.
  const pre = [T0, T0 + 800, T0 + 1600, T0 + 2400];
  const tl = [T0 + 3000, T0 + 6000, T0 + 9000, T0 + 15000];
  const { out } = await call(CAPS, pre, tl);
  if (!out) { bad('no payload with the capability, four pre-roll frames and four paint frames'); }
  else {
    out.frames.length === out.times.length
      ? ok(`frames and marks are the same length (${out.frames.length})`)
      : bad(`${out.frames.length} frames against ${out.times.length} marks — native drops back to even pacing`);
    out.frames.length === 8
      ? ok('the pre-roll is prepended, so the clip opens before the shutter')
      : bad(`expected 8 frames (4 pre-roll + 4 paint), got ${out.frames.length}`);
    out.pre === 4
      ? ok('`pre` tells native where the round starts, so the clock does not run over the framing')
      : bad(`pre reported ${out.pre}, so the timer bar would drain over the aiming footage`);
    out.times[0] === 0
      ? ok('the timeline starts at zero — no opening hold of arbitrary length')
      : bad(`times[0] is ${out.times[0]}, not 0`);
    out.frames[0].includes('PRE') && out.frames[out.frames.length - 1].includes('TL3')
      ? ok('it opens on the camera and ends on the finished hide (which is the frame native asks its question about)')
      : bad('the order is wrong — the last frame is what native holds as "can you spot them?"');
    const span = out.times[out.times.length - 1];
    Math.abs(span - 15000) <= 1
      ? ok(`the whole session is ${(span / 1000).toFixed(1)}s — the length the user actually took`)
      : bad(`span is ${span}ms; a 2.4s framing hunt plus a 12s round is 15000ms`);
  }
}

console.log('\nA MARK IS NEVER SWALLOWED, AND THE CLIP IS NEVER TOO LONG TO POST');
{
  /* Two strokes on the same millisecond: real, on a fast double-tap, and the reason the
     monotonic pass exists. Without it one of them is held for 0ms — i.e. never drawn. */
  const { out } = await call(CAPS, [], [T0, T0, T0 + 4000]);
  if (!out) bad('no payload for a three-frame round');
  else {
    let mono = true;
    for (let i = 1; i < out.times.length; i++) if (out.times[i] <= out.times[i - 1]) mono = false;
    mono
      ? ok('duplicate timestamps are separated — no frame is held for zero milliseconds')
      : bad(`marks are not increasing (${out.times.join(',')}) — a stroke would vanish from the replay`);
  }
}
{
  const { out, max } = await call(CAPS, [], [T0, T0 + 60000, T0 + 180000]);
  if (!out) bad('no payload for a three-minute round');
  else {
    const span = out.times[out.times.length - 1];
    span <= max
      ? ok(`a 3-minute round is scaled to ${(span / 1000).toFixed(0)}s — Stories cuts a segment at 60s`)
      : bad(`span is ${span}ms against a ${max}ms ceiling — Instagram would truncate the clip mid-reveal`);
    /* Scaled, NOT truncated. Truncating would drop the end of the round, which is the half
       worth watching, and it would do it without changing anything a caller could see. */
    span > max * 0.9
      ? ok('...by scaling the whole timeline, not by cutting the end of the round off')
      : bad(`span collapsed to ${span}ms — the ceiling is dropping frames rather than speeding them up`);
  }
}

console.log('\nAND A ROUND WITH NOTHING TO REPLAY TAKES THE OLD PATH');
{
  const { out } = await call(CAPS, [T0, T0 + 400], [T0 + 900]);
  out === null
    ? ok('one paint frame is not a replay — null, and the share falls back to the static card')
    : bad('a single-frame round produced a session payload; native needs at least two');
}

await browser.close();
server.close();
console.log(failed ? `\n✗ ${failed} failure(s)` : '\n✓ the session clip runs at the length of the round it records');
process.exit(failed ? 1 : 0);
