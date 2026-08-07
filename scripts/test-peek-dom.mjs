#!/usr/bin/env node
/**
 * THE SHORT SHEET, RENDERED IN A REAL BROWSER.
 *
 * check.mjs can only assert that peekShareSheet() *calls* chPrevRender(). It cannot tell you
 * what the user sees, and the bug it missed was exactly that gap: the peek CSS exempted
 * .chPrev from its hide-everything rule, so the card was declared part of the short state —
 * while .chPrev shipped display:none and nothing in that path ever added `.on`. Every static
 * check passed. The card was not on the screen.
 *
 * So this drives the real state machine in real Chromium and reads computed styles: is the
 * card displayed in the short sheet, is the CTA displayed, and is the card ABOVE it. Three
 * questions a regex cannot answer.
 *
 *   node scripts/test-peek-dom.mjs
 */
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
/* playwright-core is not a dependency of this repo — the app ships one HTML file and adding a
   browser to its lockfile for one test is not worth it. Resolved from wherever it happens to
   be installed; if it is not, this test skips loudly rather than failing the push. */
const req = createRequire(import.meta.url);
let chromium;
for (const base of [process.env.PW_CORE || '', ROOT, process.cwd()]) {
  try { ({ chromium } = req(base ? join(base, 'node_modules/playwright-core') : 'playwright-core')); break; } catch {}
}
if (!chromium) {
  console.log('· playwright-core not installed — skipping the DOM test (set PW_CORE=<dir with node_modules>)');
  process.exit(0);
}

/* The app is a <script type="module">, so peekShareSheet() and `finished` are module-scoped
   and unreachable from page.evaluate. Rather than shipping a test hook in the real file, the
   SERVED copy gets one line appended inside that module. The code under test is byte-identical
   to what users load; only the door is added, and only here. */
const real = readFileSync(join(ROOT, 'index.html'), 'utf8');
const at = real.lastIndexOf('</script>');
if (at < 0) { console.error('no </script> in index.html'); process.exit(1); }
const html = real.slice(0, at)
  + '\nwindow.__t={present(){finished=true;ssState="hidden";peekShareSheet();return ssState;},'
  + 'copy(){return{generic:pwGenericSub(),'
  + 'pitch:Object.fromEntries(Object.entries(PW_PITCH).map(([k,v])=>[k,pwText(v.t)+" | "+pwText(v.s)])),'
  + 'hint:Object.fromEntries(Object.entries(PW_LOCK_HINT).map(([k,v])=>[k,pwText(v)])),'
  + 'facts:{paint:PAINT_SECONDS,pro:PRO_PAINT_SECONDS,sizes:FREE_SIZES.length,shades:FREE_SHADES,taps:CH_TAPS,lo:CH_LIMIT_MIN,hi:CH_LIMIT_MAX}};},'
  + 'thumb(w,h){board.width=w;board.height=h;'
  + 'const x=board.getContext("2d");x.fillStyle="#ff00ff";x.fillRect(0,0,w,h);'
  + 'chPrevRender();'
  + 'const c=document.querySelector("#chPrevShot canvas");if(!c)return null;'
  /* clientWidth/Height, not the bounding rect: .chPrevShot carries a 1px rim by design, and a
     border-box measurement would report the canvas as 2px short of a box it is in fact
     filling — a permanently-red check that asks for the rim to be removed. */
  + 'const s=document.getElementById("chPrevShot"),r=c.getBoundingClientRect();'
  + 'return{iw:c.width,ih:c.height,rw:r.width,rh:r.height,bw:s.clientWidth,bh:s.clientHeight};}};\n'
  + real.slice(at);
/* Everything OTHER than the page is served off disk with a real MIME type. The module does
   `import * as THREE from './vendor/three.module.js'`, and a server that answers every path
   with text/html makes the browser refuse the import — the whole module then never runs, which
   looks exactly like the app being broken. */
const MIME = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.css': 'text/css' };
const server = createServer((req, res) => {
  const path = decodeURIComponent(req.url.split('?')[0]);
  if (path === '/' || path === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(html);
  }
  try {
    const ext = path.slice(path.lastIndexOf('.'));
    const body = readFileSync(join(ROOT, path.replace(/^\/+/, '')));
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end('not found'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;

let failed = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { failed++; console.error('  ✗ ' + m); };

/* The browser is pre-installed under a versioned directory (chromium-1194/...), and the
   version moves. Found rather than hardcoded, so a bumped image does not silently skip. */
const { globSync } = await import('node:fs');
const exe = (globSync('/opt/pw-browsers/chromium-*/chrome-linux/chrome') || [])[0];
if (!exe) { console.log('· no chromium under /opt/pw-browsers — skipping'); server.close(); process.exit(0); }
const browser = await chromium.launch({ executablePath: exe });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__t, null, { timeout: 10000 }).catch(() => {
  console.error('  ✗ the module never finished executing — it threw on load:\n    ' + pageErrors.join('\n    '));
  process.exit(1);
});

/* Drive it the way enterFinished() does: mark the round finished, then present. Nothing is
   stubbed — this is peekShareSheet() itself, with the real CSS attached. */
const seen = await page.evaluate(() => {
  const state = window.__t.present();
  const box = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { display: getComputedStyle(el).display, cls: el.className, top: r.top, bottom: r.bottom, h: r.height };
  };
  /* THE CARD MUST RISE ONCE. It rose twice: .ssCard inherits `animation:pwUp` from .pwCard,
     and a `.rise` class added a second, more specific `animation:ssRise`. The specific one won
     while the class was on; when JS removed it 420ms later, pwUp became the winning declaration
     and played again. Nothing in the JS looked like a second trigger. getAnimations() on the
     element is the only place that shows both. */
  const cardEl = document.querySelector('#shareSheet .ssCard');
  /* ENTRANCE animations only. .pwCard also carries pwGlow — an infinite breathing mint glow —
     and counting that would make this permanently red for a reason that has nothing to do with
     the sheet sliding up. An entrance is finite and moves the element: transform, run once. */
  const entrances = (a) => {
    const t = a.effect.getTiming();
    if (t.iterations === Infinity) return false;
    return (a.effect.getKeyframes() || []).some((k) => 'transform' in k);
  };
  const anims = (document.getAnimations ? document.getAnimations() : [])
    .filter((a) => a.effect && a.effect.target === cardEl && entrances(a))
    .map((a) => a.animationName || 'anim');
  return {
    state,
    anims,
    animName: getComputedStyle(cardEl).animationName,
    sheet: box('#shareSheet'),
    card: box('#chPrev'),
    cta: box('#ssInvite'),
    title: box('#shareSheet .pwTitle'),
    tabs: box('#ssMode'),
    instagram: box('#shareSheet .ssBtn.ig'),
    more: box('#shareSheet .ssBtn.ssMore'),
    ctaColor: (() => {
      const s = getComputedStyle(document.querySelector('#ssInvite'));
      return { bg: s.backgroundColor, fg: s.color };
    })(),
  };
});

console.log('\nTHE SHORT SHEET SHOWS THE CARD');
seen.state === 'peek' ? ok('the sheet is in the short state') : bad(`state is ${seen.state}, not peek`);
seen.sheet && seen.sheet.display !== 'none' ? ok('the sheet is on screen') : bad('the sheet is not displayed at all');

seen.card && seen.card.display !== 'none' && seen.card.h > 0
  ? ok(`the challenge card is rendered (${seen.card.display}, ${Math.round(seen.card.h)}px tall, class "${seen.card.cls}")`)
  : bad(`THE CARD IS NOT VISIBLE IN THE SHORT SHEET — display:${seen.card && seen.card.display}, `
      + `class "${seen.card && seen.card.cls}". .chPrev needs the "on" class from chPrevRender().`);

seen.cta && seen.cta.display !== 'none' && seen.cta.h > 0
  ? ok(`"Challenge a friend" is rendered (${Math.round(seen.cta.h)}px tall)`)
  : bad('the CTA is not visible in the short sheet — updateInviteBtn() did not un-hide it');

console.log('\nIT RISES ONCE');
seen.anims.length <= 1
  ? ok(`one animation on the card on arrival (${seen.animName})`)
  : bad(`${seen.anims.length} animations are running on the card at once (${seen.anims.join(', ')}) — `
      + 'it will play the open twice, back to back');
/* AND NOTHING MAY RE-ENTER IT ON A RESIZE. Collapsing from the full sheet used to replay the
   rise, which reads as a bounce rather than a transition.
   The entrance has to be allowed to FINISH first, or this measures the arrival still playing
   and calls it a restart — which is what the first version of this check did. 600ms is well
   past the .34s rise; the settled state is asserted before the toggle so a failure says which
   of the two it was. */
await page.waitForTimeout(600);
const running = () => page.evaluate(() => {
  const cardEl = document.querySelector('#shareSheet .ssCard');
  return (document.getAnimations ? document.getAnimations() : [])
    .filter((a) => a.effect && a.effect.target === cardEl && a.playState === 'running'
      && a.effect.getTiming().iterations !== Infinity
      && (a.effect.getKeyframes() || []).some((k) => 'transform' in k))
    .map((a) => a.animationName || 'anim');
});
const settled = await running();
settled.length === 0
  ? ok('the rise finishes and stays finished')
  : bad(`still animating 600ms after arrival (${settled.join(', ')}) — something is replaying it`);

await page.evaluate(() => {
  const sheet = document.querySelector('#shareSheet');
  sheet.classList.remove('peek'); sheet.classList.add('show');       // long
  sheet.classList.remove('show'); sheet.classList.add('peek');       // back to short
});
const onCollapse = await running();
onCollapse.length === 0
  ? ok('long → short restarts nothing — it is a resize, not a re-entry')
  : bad(`${onCollapse.join(', ')} restarted on collapse — the sheet bounces when it gets smaller`);

console.log('\nTHE CARD IS ABOVE THE CTA, AND IT IS FULL WIDTH');
seen.card && seen.cta && seen.card.bottom <= seen.cta.top + 1
  ? ok('the card sits above the button — see what goes out, then send it')
  : bad(`the card is not above the CTA (card bottom ${seen.card && Math.round(seen.card.bottom)}, `
      + `CTA top ${seen.cta && Math.round(seen.cta.top)}) — if they overlap the button is INSIDE the card's flex row`);

/* The regression that shipped: the button nested in .chPrev became a cell in a flex row, so
   it was no taller than the row and far from full width. A 390px viewport with 20px padding
   either side makes a full-width CTA ~350px. */
const w = await page.evaluate(() => {
  const b = document.querySelector('#ssInvite');
  return b ? b.getBoundingClientRect().width : 0;
});
w > 300
  ? ok(`the CTA is full width (${Math.round(w)}px of a 390px viewport)`)
  : bad(`the CTA is only ${Math.round(w)}px wide — it is being laid out as a cell, not a button`);

/* THE CTA HAS TO WIN THE CARD. It is white on a green card precisely because the button below
   it is a full-saturation Instagram gradient; a tinted CTA lost that contest, and the sheet
   exists to produce challenge sends. Asserted rather than eyeballed because a colour change is
   one token and nothing else in the file would object to it. */
console.log('\nTHE PRIMARY LOOKS PRIMARY');
{
  const bg = (seen.ctaColor.bg || '').replace(/\s/g, '');
  bg === 'rgb(255,255,255)'
    ? ok(`the CTA is a white slab (text ${seen.ctaColor.fg})`)
    : bad(`the CTA background is ${seen.ctaColor.bg} — it is tinted again, and it sits above a `
        + 'full-brand Instagram gradient that will out-shout it');
}

console.log('\nTHE SHORT SHEET IS STILL SHORT');
seen.tabs && seen.tabs.display === 'none' ? ok('the Challenge / Before-After tabs are hidden') : bad('the tabs are showing — this is not the short state');
/* Instagram is DELIBERATELY in the short state — 7 taps in 7 days told us the destinations were
   unreachable, not unwanted. What must stay true is that it is second: below the CTA, never
   above it. If that order ever flips, the loudest thing on the sheet becomes the share that
   carries no link and recruits nobody. */
seen.instagram && seen.instagram.display !== 'none' && seen.instagram.h > 0
  ? ok(`Instagram is reachable without swiping (${Math.round(seen.instagram.h)}px tall)`)
  : bad('Instagram is hidden in the short sheet again — it is then only reachable by a swipe '
      + 'almost nobody performs, which is the state that produced 7 taps in a week');
seen.instagram && seen.cta && seen.instagram.top >= seen.cta.bottom - 1
  ? ok('it sits UNDER "Challenge a friend" — recruitment first, reach second')
  : bad('Instagram is above the CTA — the share that carries no link is leading the sheet');
/* Measured by HEIGHT, not by computed display. More lives inside .ssRow2, and the peek rule
   hides the ROW — the button's own computed display stays `flex` while it occupies nothing.
   Asking for display:none here would fail forever on a sheet that is behaving correctly. */
seen.more && seen.more.h === 0
  ? ok('More / Save are still behind the swipe')
  : bad(`More is taking up ${seen.more && Math.round(seen.more.h)}px — the short sheet is turning `
      + 'back into the full one');
/* NO ASSERTION ON HOW FAR UP THE SCREEN IT REACHES. That is the invariant I care about most —
   the reveal has to stay visible behind the short sheet — and this harness cannot answer it
   honestly: there is no camera here, so the app frame never gets its real height and the sheet
   lands outside the viewport box entirely. A threshold tuned until it passed would assert the
   quirk, not the design. What IS checked above is the thing that decides the height: only the
   grabber, kicker, headline, card and CTA are displayed, and every destination is not. */
ok(`short-state content: grabber + kicker + headline + card (${Math.round(seen.card.h)}px) `
  + `+ CTA (${Math.round(seen.cta.h)}px), nothing else`);

/* THE THUMBNAIL FILLS ITS BOX. It did not, and it shipped: `board` is the whole screen
   (~9:19.5) and .chPrevShot is 46x60 (~3:4), so a fit-by-longest-side put a 28px-wide frame in
   a 46px box, flush left, with the box's near-black background filling the rest. On a phone
   that does not read as a small preview, it reads as an image that failed to load — which is
   exactly how it was reported. A real phone aspect is used rather than the 300x150 default
   canvas, because the default is WIDER than the box and would have passed the broken code. */
console.log('\nTHE PREVIEW THUMBNAIL FILLS ITS BOX');
const th = await page.evaluate(() => window.__t.thumb(1080, 2337));
if (!th) {
  bad('chPrevRender() drew no canvas into #chPrevShot at all');
} else {
  const near = (a, b) => Math.abs(a - b) <= 0.75;
  near(th.rw, th.bw) && near(th.rh, th.bh)
    ? ok(`the frame covers the whole ${Math.round(th.bw)}x${Math.round(th.bh)} box`)
    : bad(`the frame is ${th.rw.toFixed(1)}x${th.rh.toFixed(1)} inside a ${th.bw.toFixed(1)}x${th.bh.toFixed(1)} box `
        + `— ${Math.round(th.bw - th.rw)}px of dead background shows down the side, which reads as a broken image`);
  /* The backing store must be the BOX's shape, not the board's. If it still matches 1080:2337
     the crop never happened and the fill above is only CSS stretching a letterbox — same black
     band, now smeared. */
  const boxAR = th.bw / th.bh, imgAR = th.iw / th.ih;
  Math.abs(imgAR - boxAR) < 0.03
    ? ok(`it is cropped to the box (canvas ${th.iw}x${th.ih}, ratio ${imgAR.toFixed(2)} vs box ${boxAR.toFixed(2)})`)
    : bad(`the canvas is ${th.iw}x${th.ih} (ratio ${imgAR.toFixed(2)}) but the box is ${boxAR.toFixed(2)} `
        + '— the board is being fitted, not cover-cropped');
  /* And it has to be a retina backing store. 46x60 CSS pixels at 1x is visibly mushy next to
     everything else on this card, and "soft" is the failure this size of thumbnail dies of. */
  th.iw >= th.bw * 2
    ? ok(`drawn at ${(th.iw / th.bw).toFixed(1)}x device pixels, not 1x`)
    : bad(`the canvas is only ${(th.iw / th.bw).toFixed(1)}x the box in device pixels — it will look soft`);
}

/* THE PAYWALL'S PROMISES, RENDERED. check.mjs proves no number is TYPED into the copy; this
   proves the templates actually resolve to the values the app runs on. A template that
   interpolates the wrong constant is still a false claim, and it looks perfect in the source. */
console.log('\nTHE PAYWALL QUOTES THE APP IT IS SELLING');
const copy = await page.evaluate(() => window.__t.copy());
const f = copy.facts;
const all = [['generic', copy.generic], ...Object.entries(copy.pitch), ...Object.entries(copy.hint)]
  .map(([k, v]) => [k, String(v)]);
const undef = all.filter(([, v]) => /undefined|NaN/.test(v));
undef.length
  ? bad(`copy renders a missing value: ${undef.map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(' · ')}`)
  : ok(`${all.length} paywall lines render with no undefined`);

/* Each claim against the constant it is about. Named individually rather than swept, because a
   sweep that only greps for "any of these numbers appears somewhere" would pass a line that
   swapped the free and pro clocks — which reads as a bargain in the wrong direction. */
const says = (key, needles) => {
  const line = (all.find(([k]) => k === key) || [])[1];
  if (!line) return bad(`no paywall line for "${key}"`);
  const miss = needles.filter((n) => !line.includes(n));
  miss.length
    ? bad(`the "${key}" pitch does not state ${miss.join(', ')} — it reads: ${JSON.stringify(line)}`)
    : ok(`"${key}" states ${needles.join(', ')}`);
};
says('generic', [`${f.pro}s`, `${f.paint}s`]);
says('time', [`${f.pro} seconds`, `instead of ${f.paint}`]);
says('size', [`${f.sizes} fixed sizes`]);
says('color', [`${f.shades} shades`]);
says('chset', [`${f.taps} taps`, `${f.lo}-${f.hi}s`]);

await browser.close();
server.close();
console.log(failed ? `\n✗ ${failed} failure(s)` : '\n✓ the short sheet shows the card, above a full-width CTA, without covering the reveal');
process.exit(failed ? 1 : 0);
