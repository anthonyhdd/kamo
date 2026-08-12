#!/usr/bin/env node
/**
 * THE SPECTATOR SEAT, DRIVEN.
 *
 * The replay is the payoff of the seeker's recorder: the creator watches the hunt their
 * photo caused. Everything about it is runtime — a viewport rectangle animated from a
 * recorded transform, hesitation marks that appear on their own timestamps, and an ending
 * that must differ by outcome. None of it is visible to a static read.
 *
 * THE ASSERTION THAT MATTERS MOST is the last one: a round that ended in a FIND must end
 * with no buzz marker on screen. get_seek_traces strips the winning coordinates
 * server-side precisely so this screen can never become a cheat sheet, and this test is
 * what stops a well-meaning "why not show where they tapped?" from undoing that.
 *
 *   PW_CORE=<dir with node_modules> node scripts/test-replay-dom.mjs
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
  console.log('· playwright-core not installed — skipping the replay test — run: ' + PW_SETUP);
  process.exit(0);
}
const real = readFileSync(join(ROOT, 'index.html'), 'utf8');
const anchor = 'async function chRpc(fn,body){';
const html = real.replace(anchor, anchor + 'if(window.__rpc) return window.__rpc(fn,body);');

const JPG = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
  'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAADAAIBAREA/8QAHwAAAQUBAQEB' +
  'AQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1Fh' +
  'ByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZ' +
  'WmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXG' +
  'x8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9oACAEBAAA/AL9f/9k=', 'base64');

const server = createServer((rq, rs) => {
  const p = decodeURIComponent(rq.url.split('?')[0]);
  if (p === '/' || p === '/index.html') { rs.writeHead(200, { 'Content-Type': 'text/html' }); return rs.end(html); }
  // Strict MIME checking: the page imports vendor/three.module.js as a MODULE, and a
  // missing Content-Type makes Chrome refuse the whole script — no HIDEY, no app.
  const MIME = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.glb': 'model/gltf-binary',
                 '.woff2': 'font/woff2', '.png': 'image/png', '.json': 'application/json' };
  let b = null; try { b = readFileSync(join(ROOT, p.replace(/^\/+/, ''))); } catch {}
  if (b) { rs.writeHead(200, { 'Content-Type': MIME[p.slice(p.lastIndexOf('.'))] || 'application/octet-stream' }); rs.end(b); }
  else { rs.writeHead(404); rs.end('x'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

const { globSync } = await import('node:fs');
const glob = (p) => { try { return (typeof globSync === 'function' ? globSync(p) : []) || []; } catch { return []; } };
const exe = chromeExe();
if (!exe) { console.log('· no Chrome or Chromium found — skipping (set PW_CHROME=<path>)'); server.close(); process.exit(0); }
const browser = await chromium.launch({ executablePath: exe });
let failed = 0;
const ok = m => console.log('  ✓ ' + m), bad = m => { failed++; console.error('  ✗ ' + m); };

async function open(why) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  page.on('pageerror', e => bad('PAGE ERROR: ' + e.message));
  await page.route('**/storage/v1/object/public/hides/**', r => r.fulfill({ status: 200, contentType: 'image/jpeg', body: JPG }));
  await page.addInitScript((why) => {
    localStorage.setItem('kamo_hides', JSON.stringify(['abc123']));
    localStorage.setItem('kamo_handle', 'tony');
    window.__rpc = (fn) => {
      if (fn === 'get_hide') return Promise.resolve({ img_path: 'x.jpg', secs: 9, n_attempts: 2, n_found: why === 'hit' ? 1 : 0, name: 'tony' });
      if (fn === 'get_seek_traces') return Promise.resolve([{
        created_at: '2026-08-12T16:00:00Z', why, ms: 7400,
        trace: {
          v: 1, vw: 390, vh: 844, img: { w: 390, h: 690 },
          s: [[0,1,0,0],[600,1.4,-30,40],[1400,2.6,-70,120],[2600,3.2,40,-90],[4200,2.1,10,60],[5800,4.0,-120,30],[7200,3.6,-90,10]],
          a: why === 'hit'
            ? [{ d: 2100, u: 2600, c: 0, p: [[2100,0.31,0.44]] }]
            : [{ d: 2100, u: 2600, c: 0, p: [[2100,0.31,0.44]] }, { d: 5100, u: 5400, c: 0, p: [[5100,0.66,0.28]] }],
          end: why === 'hit' ? undefined : { ms: 7400, x: 0.72, y: 0.61 },
        },
      }]);
      return Promise.resolve(null);
    };
  }, why);
  await page.goto(base + '?debug', { waitUntil: 'load' });
  await page.waitForTimeout(700);
  // Headless has no camera, so the start screen sits over the wordmark and swallows the
  // hit test. Enter compose through the debug bridge, exactly like the character shots do.
  await page.evaluate(() => window.HIDEY.setBg('data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="390" height="700"><rect width="100%" height="100%" fill="#888"/></svg>')));
  await page.waitForTimeout(900);
  // The wordmark tap is hit-tested at the document via elementFromPoint, so a synthetic
  // .click() (clientX/Y = 0) misses it entirely — press the real pixels.
  const bb = await page.evaluate(() => { const b = document.querySelector('.brand').getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
  await page.mouse.click(bb.x, bb.y);
  await page.waitForTimeout(700);
  // The rows live behind "Show each one" — the summary is the closed state by design.
  await page.evaluate(() => { const e = document.getElementById('khScore'); if (e && e.onclick) e.onclick(); });
  await page.waitForTimeout(500);
  return page;
}

for (const why of ['miss', 'hit']) {
  console.log('\n' + why.toUpperCase());
  const page = await open(why);
  const hasWatch = await page.evaluate(() => !!document.querySelector('.khWatch'));
  hasWatch ? ok('Watch button on a played hide') : bad('no Watch button');
  if (hasWatch) {
    await page.evaluate(() => document.querySelector('.khWatch').click());
    await page.waitForTimeout(1400);
    const mid = await page.evaluate(() => {
      const v = document.getElementById('khRpView');
      return v ? { w: v.style.width, l: v.style.left } : null;
    });
    mid && mid.w ? ok(`viewport is travelling (w=${mid.w} l=${mid.l})`) : bad('viewport not positioned');
    await page.waitForTimeout(7200);
    const end = await page.evaluate(() => ({
      fx: document.getElementById('khRpFx').className,
      buzz: !!document.querySelector('.khRpAim.buzz'),
      aims: document.querySelectorAll('.khRpAim').length,
    }));
    if (why === 'miss') {
      end.buzz && end.fx.includes('lose') ? ok(`miss ends on the wrong spot (${end.aims} marks)`) : bad('miss end wrong: ' + JSON.stringify(end));
    } else {
      !end.buzz && end.fx.includes('win') ? ok(`find ends green with NO spot leaked (${end.aims} hesitation marks)`) : bad('hit end wrong: ' + JSON.stringify(end));
    }
  }
  await page.close();
}
await browser.close(); server.close();
console.log(failed ? `\n✗ ${failed} failure(s)` : '\n✓ the spectator seat behaves');
process.exit(failed ? 1 : 0);
