#!/usr/bin/env node
/**
 * HUNT-ONLY MODE, DRIVEN — a device with no WebGL must get a smaller app, not a black screen.
 *
 * initThree() runs at module top level; before 2026-08-15 a device that could not create a
 * WebGL context died right there — no seeker, no feed, no tracking, a black screen the
 * beacon finally made visible (17 of them in its first 12 hours). The contract now:
 * the module SURVIVES, the hero's primary becomes the feed, the photo path is hidden,
 * and webgl_dead is tracked. This drives the exact failure: getContext() returning null
 * for every webgl flavour, which is what a low-end phone actually does.
 *
 *   PW_CORE=<dir with node_modules> node scripts/test-webgl-dead.mjs
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
  console.log('· playwright-core not installed — skipping the webgl-dead test — run: ' + PW_SETUP);
  process.exit(0);
}
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');

const server = createServer((rq, rs) => {
  const p = decodeURIComponent(rq.url.split('?')[0]);
  if (p === '/' || p === '/index.html') { rs.writeHead(200, { 'Content-Type': 'text/html' }); return rs.end(html); }
  const MIME = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.glb': 'model/gltf-binary',
                 '.woff2': 'font/woff2', '.png': 'image/png', '.json': 'application/json' };
  let b = null; try { b = readFileSync(join(ROOT, p.replace(/^\/+/, ''))); } catch {}
  if (b) { rs.writeHead(200, { 'Content-Type': MIME[p.slice(p.lastIndexOf('.'))] || 'application/octet-stream' }); rs.end(b); }
  else { rs.writeHead(404); rs.end('x'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

const exe = chromeExe();
if (!exe) { console.log('· no Chrome or Chromium found — skipping (set PW_CHROME=<path>)'); server.close(); process.exit(0); }
const browser = await chromium.launch({ executablePath: exe });
let failed = 0;
const ok = m => console.log('  ✓ ' + m), bad = m => { failed++; console.error('  ✗ ' + m); };

const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
// The beacon and chWebTrack both post straight to Amplitude — capture instead of sending.
const tracked = [];
await page.route('**/api.eu.amplitude.com/**', async (route) => {
  try { const b = JSON.parse(route.request().postData() || '{}'); (b.events || []).forEach(e => tracked.push(e.event_type)); } catch {}
  route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
});
await page.addInitScript(() => {
  // What a GL-less phone actually does: every webgl flavour comes back null. 2d stays real —
  // the painter's canvases still construct, they are just never reached in hunt-only mode.
  const orig = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (kind, opts) {
    if (/webgl/i.test(String(kind))) return null;
    return orig.call(this, kind, opts);
  };
});
await page.goto(base, { waitUntil: 'load' });
await page.waitForTimeout(2500);

const st = await page.evaluate(() => ({
  heroVisible: !!document.getElementById('start'),
  startLabel: (document.getElementById('heroStart') || {}).textContent || '',
  pickHidden: (document.getElementById('heroPick') || {}).style?.display === 'none',
  // The module survived if things defined AFTER initThree() exist.
  moduleAlive: typeof window.KAMOFEED === 'object' && !!window.KAMOFEED.open,
}));
st.moduleAlive ? ok('the module survives a dead WebGL context') : bad('module died — everything after initThree() is gone: ' + JSON.stringify(st));
st.heroVisible ? ok('the hero is on screen, not a black void') : bad('no hero');
/^Hunt kamos/.test(st.startLabel.trim()) ? ok(`the primary sells the hunt ("${st.startLabel.trim()}")`) : bad('primary still says: ' + st.startLabel);
st.pickHidden ? ok('the photo path is hidden rather than left to die downstream') : bad('#heroPick still visible');
tracked.includes('webgl_dead') ? ok('webgl_dead reached the wire') : bad('webgl_dead never tracked: ' + tracked.join(','));

await page.evaluate(() => document.getElementById('heroStart').click());
await page.waitForTimeout(1200);
const feed = await page.evaluate(() => !!document.getElementById('kfeed'));
feed ? ok('tapping it opens the feed — the 2D half of the toy still plays') : bad('feed did not open from the hunt-only hero');

await browser.close(); server.close();
console.log(failed ? `\n✗ ${failed} failure(s)` : '\n✓ a GL-less phone gets a smaller app, not a dead one');
process.exit(failed ? 1 : 0);
