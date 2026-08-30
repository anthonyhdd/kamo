#!/usr/bin/env node
/**
 * THE INSTALL IS THE CONSEQUENCE OF THE SEND, NOT ITS ALTERNATIVE.
 *
 * 1141 people a month reach the reveal of somebody's hide in a plain browser. 353 of them
 * send one back; 109 tap Get KAMO. The install pitch loses to the thing standing next to it,
 * three to one — and it deserves to, because at that moment nobody wants to install anything,
 * they want to answer. So the app is offered one step LATER: after the answer has actually
 * gone out, when the sender has something out there with their name on it and exactly one
 * open question — did they find it. That is the only question the app can answer and a
 * browser tab cannot.
 *
 * WHAT THIS SUITE EXISTS TO STOP, in order of how bad it would be:
 *
 *  1. OFFERING THE APP TO SOMEBODY HOLDING IT. #ssGet must never appear inside the wrapper.
 *     Getting this wrong puts a Get-the-app button in the app, on the sheet, after every
 *     single send — the most-seen surface in the product. Asserted here from the browser side
 *     and from the wrapper side in test-share-dom.mjs.
 *  2. OFFERING IT BEFORE ANYTHING WAS SENT. The button is the payoff of a send; on a sheet
 *     nobody has used it is an advert. Asserted as a TRANSITION — hidden, act, visible —
 *     because a button that is visible the whole time also passes an "is it visible" check.
 *  3. THE TAP REPORTING NOTHING. sent_cta_tapped is WEB_ONLY by construction: the button
 *     cannot exist inside the wrapper, so postNative() is never reached. If it were dropped
 *     from that set the whole feature would read as zero taps forever.
 *
 * Asserted against the WIRE — what actually reached Amplitude — rather than against a spy on
 * track(). A spy proves the call was made; the wire proves it left, which is the failure this
 * product has already had once, silently, for every web event ever fired.
 *
 *   PW_CORE=<dir with node_modules> node scripts/test-sentcta-dom.mjs
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
for (const b of pwBases(ROOT)) {
  try { ({ chromium } = req(b ? join(b, 'node_modules/playwright-core') : 'playwright-core')); break; } catch {}
}
if (!chromium) { console.log('· playwright-core not installed — skipping the sent-CTA test — run: ' + PW_SETUP); process.exit(0); }

const MIME = { '.js': 'text/javascript', '.glb': 'model/gltf-binary', '.woff2': 'font/woff2', '.png': 'image/png' };
const real = readFileSync(join(ROOT, 'index.html'), 'utf8');
/* Only the RPC door is stubbed. Everything else — the sheet, the publish floor, chMarkSent,
   the reveal — runs exactly as it ships, because the thing under test is WHEN the offer
   appears and that is decided by the real send path. */
const html = real.replace('async function chRpc(fn,body){', 'async function chRpc(fn,body){ if(window.__rpc) return window.__rpc(fn,body);');

const server = createServer((rq, rs) => {
  const p = decodeURIComponent(rq.url.split('?')[0]);
  if (p === '/' || p === '/index.html') { rs.writeHead(200, { 'Content-Type': 'text/html' }); return rs.end(html); }
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
const ok = m => console.log('  ✓ ' + m);
const bad = m => { failed++; console.error('  ✗ ' + m); };

const page = await browser.newPage({ locale: 'en-US', viewport: { width: 390, height: 844 } });
page.on('pageerror', e => bad('PAGE ERROR: ' + e.message));

/* THE WIRE. Every event this page sends goes through one POST, so recording it records
   everything — and fulfilling it keeps the assertion off the real project. */
const sent = [];
await page.route('**/api.eu.amplitude.com/**', async r => {
  try { (JSON.parse(r.request().postData() || '{}').events || []).forEach(e => sent.push(e)); } catch {}
  await r.fulfill({ status: 200, contentType: 'application/json', body: '{"code":200}' });
});
await page.route('**/storage/v1/object/hides/**', r => r.fulfill({ status: 200, body: '{}' }));
/* The store, stubbed: the button navigates, and a real cross-origin load would end the page
   before the last assertion could read anything off it. */
await page.route('https://kamo.onelink.me/**', r => r.fulfill({ status: 200, contentType: 'text/html', body: '<h1>store</h1>' }));
await page.route('https://apps.apple.com/**', r => r.fulfill({ status: 200, contentType: 'text/html', body: '<h1>store</h1>' }));

await page.addInitScript(() => {
  /* Guarded because this file drives the onelink CTA. Playwright re-runs an init script on EVERY
     document, and the one created for a cross-origin store navigation denies localStorage — see
     the long note in test-feedwall-dom.mjs, where that threw and read as an app bug for a cycle.
     A seed that silently fails is still loud: the assertions depending on it fail. */
  try { localStorage.setItem('kamo_handle', 'tony'); } catch (e) {}
  let n = 0;
  window.__rpc = (fn) => Promise.resolve(fn === 'create_hide' ? 'hide' + (++n) : null);
  /* A BROWSER, and the absence is the point: no window.ReactNativeWebView at all, which is
     the exact condition ssOfferApp() reads. */
  navigator.share = () => Promise.resolve();
});
await page.goto(base + "?debug", { waitUntil: "load" });
await page.waitForTimeout(600);

const vis = () => page.evaluate(() => {
  const g = document.getElementById('ssGet');
  return !!(g && getComputedStyle(g).display !== 'none');
});

console.log('\nTHE OFFER DOES NOT EXIST UNTIL SOMETHING HAS BEEN SENT');
await page.evaluate(() => window.HIDEY.setBg('data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="390" height="700"><rect width="100%" height="100%" fill="#8a9299"/></svg>')));
await page.waitForTimeout(900);
await page.evaluate(() => window.HIDEY.capture());
await page.waitForTimeout(400);
await page.evaluate(() => {
  const b = document.getElementById('board'), r = b.getBoundingClientRect();
  const ev = (t, x, y) => b.dispatchEvent(new PointerEvent(t, { clientX: x, clientY: y, bubbles: true, pointerId: 1, buttons: 1, pressure: .5 }));
  for (let y = r.top + r.height * 0.25; y < r.top + r.height * 0.62; y += 6) {
    ev('pointerdown', r.left + r.width / 2 - 40, y);
    for (let x = r.left + r.width / 2 - 40; x < r.left + r.width / 2 + 40; x += 8) ev('pointermove', x, y);
    ev('pointerup', r.left + r.width / 2 + 40, y);
  }
});
await page.waitForTimeout(300);
await page.evaluate(() => document.getElementById('btnDone').click());
await page.waitForTimeout(600);
await page.evaluate(() => { const c = document.querySelector('#shareSheet .ssCard'); c.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 2 })); });
await page.waitForTimeout(400);

(await vis()) === false ? ok('the share sheet is open and the offer is not on it') : bad('#ssGet is visible before anything was sent');

console.log('\nAND IT APPEARS THE MOMENT ONE IS');
await page.evaluate(() => document.getElementById('ssInvite').click());
/* Waited for, not slept on: chMarkSent runs on the send path and the reveal is what decides
   when that path is reachable. */
await page.waitForFunction(() => {
  const g = document.getElementById('ssGet');
  return !!(g && getComputedStyle(g).display !== 'none');
}, null, { timeout: 15000 }).catch(() => {});

(await vis()) === true ? ok('sending reveals the offer') : bad('#ssGet never appeared after a send');
sent.some(e => e.event_type === 'hide_sent') ? ok('and hide_sent reached Amplitude on the same user') : bad('hide_sent never left the page');

const copy = await page.evaluate(() => {
  const g = document.getElementById('ssGet');
  return g ? (g.textContent || '').replace(/\s+/g, ' ').trim() : '';
});
/notif/i.test(copy) && /find you/i.test(copy)
  ? ok('it promises the one thing the app has: ' + JSON.stringify(copy))
  : bad('the offer says ' + JSON.stringify(copy));

console.log('\nAND THE TAP REPORTS, ON THE PATH THAT CANNOT USE THE BRIDGE');
/* Guarded, because a missing #ssGet is a FAILURE and not a crash. Without this the suite
   throws an uncaught TypeError on exactly the code this test was written to catch, and
   check.mjs — which filters a failed run's output for ✗ lines — reports it as an empty
   problem. A test whose failure message is blank is a test nobody can act on. */
const there = await page.evaluate(() => !!document.getElementById('ssGet'));
if (!there) bad('#ssGet does not exist in the sheet at all — nothing to tap');
else await page.evaluate(() => document.getElementById('ssGet').click());
await page.waitForFunction(() => true);
await page.waitForTimeout(800);
const cta = sent.find(e => e.event_type === 'sent_cta_tapped');
cta ? ok('sent_cta_tapped reached Amplitude directly (tier=' + (cta.event_properties || {}).tier + ')')
    : bad('sent_cta_tapped never left the page — is it missing from WEB_ONLY?');
cta && (cta.event_properties || {}).host === 'browser'
  ? ok('and it is stamped host=browser, so it is separable from anything the app sends')
  : bad('sent_cta_tapped carries host=' + (cta && (cta.event_properties || {}).host));

await browser.close();
server.close();
console.log(failed ? `\n✗ ${failed} problem(s)\n` : '\n✓ the app is offered after the send, and only in a browser\n');
process.exit(failed ? 1 : 0);
