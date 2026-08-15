#!/usr/bin/env node
/**
 * THE SHORT SHEET, RENDERED IN A REAL BROWSER.
 *
 * MOST SENDS HAPPEN HERE. The sheet presents itself on the reveal in this state, and the swipe
 * that opens the long one is a gesture almost nobody performs — so anything the peek rule does
 * not exempt is, for practical purposes, not shipped. check.mjs can assert which selectors are
 * NAMED in that rule; it cannot tell you whether the element those selectors point at is on
 * the screen. That gap is the bug this file was written for: `.chPrev` was exempted in CSS
 * while shipping display:none, with nothing on that path ever adding `.on`. Every static check
 * passed. The card was not there.
 *
 * REWRITTEN AGAINST THE SHEET THAT SHIPPED ON 2026-08-15, and the shape of the old suite is
 * why it was quarantined rather than deleted: it was asserting a preview card, a rehearsal
 * overlay and an Instagram slab, all three of which are gone, while the questions underneath
 * them — is it displayed, is it in the right order, is it still short — are the same questions
 * about the controls that replaced them. What is checked now:
 *
 *   · the whole ask survives the peek: headline, the notification line, the visibility row,
 *     the send, and "See it live"
 *   · they are in that order, and both buttons are full width
 *   · the send is the only white slab and the only thing moving
 *   · the destinations are still behind the swipe
 *
 * The confetti assertions did not move here from nowhere — they went the other way, to
 * test-buzz-dom, which drives the surviving confettiBurst() caller (the real find on the
 * seeker screen). They were reachable from this file only through the rehearsal overlay.
 *
 *   node scripts/test-peek-dom.mjs
 */
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { pwBases, chromeExe, PW_SETUP } from './lib/pw.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
/* playwright-core is not a dependency of this repo — the app ships one HTML file and adding a
   browser to its lockfile for one test is not worth it. Resolved from wherever it happens to
   be installed; if it is not, this test skips loudly rather than failing the push. */
const req = createRequire(import.meta.url);
let chromium;
for (const base of pwBases(ROOT)) {
  try { ({ chromium } = req(base ? join(base, 'node_modules/playwright-core') : 'playwright-core')); break; } catch {}
}
if (!chromium) {
  console.log('· playwright-core not installed — skipping the DOM test — run: ' + PW_SETUP);
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
  /* ONLY THE CONSTANTS THE ASSERTIONS BELOW ACTUALLY USE, and that is a rule this hook learned
     the hard way. It used to read CH_LIMIT_MIN / CH_LIMIT_MAX as well, and when the round
     settings were deleted the ReferenceError inside page.evaluate turned the whole suite from
     FAILING into CRASHING — check.mjs printed "IS BROKEN" with no detail and every real failure
     underneath it was invisible. FREE_SIZES and CH_TAPS went the same way for the same reason:
     nothing here asserts a size count (the size pitch deliberately quotes no figure) and the
     tap budget left the paywall with the gear. Every name in this expression is a hostage. */
  + 'facts:{paint:PAINT_SECONDS,shades:FREE_SHADES}};},'
  /* A real tap on the wordmark, dispatched at the document the way a finger arrives — the
     handler is a capture-phase hit test on the mark's rect, not a listener on the element,
     so calling openKamoHome() directly would prove nothing about whether a tap reaches it. */
  + 'tapBrand(dx,ms){const b=document.querySelector(".brand");const r=b.getBoundingClientRect();'
  + 'const x=r.left+r.width/2,y=r.top+r.height/2;'
  + 'document.dispatchEvent(new PointerEvent("pointerdown",{clientX:x,clientY:y,bubbles:true}));'
  + 'const go=()=>document.dispatchEvent(new PointerEvent("pointerup",{clientX:x+(dx||0),clientY:y,bubbles:true}));'
  + 'if(ms){return new Promise(r2=>setTimeout(()=>{go();r2(this.cardState());},ms));}'
  + 'go();return Promise.resolve(this.cardState());},'
  + 'cardState(){return{card:document.getElementById("kamoHome").classList.contains("show"),'
  + 'sheet:shareSheetEl.className,state:ssState};},'
  + 'closeCard(){closeKamoHome();return this.cardState();},'
  + 'row(){const b=(s)=>{const e=document.querySelector(s);if(!e)return null;const r=e.getBoundingClientRect();'
  + 'return{d:getComputedStyle(e).display,x:r.left,y:r.top,w:r.width,h:r.height};};'
  /* Every infinite animation inside the card, pseudo-elements included — that is where the
     sheens live, and "how many things are moving" is the invariant, not any one selector. */
  /* BUTTONS ONLY. The headline carries its own pwShimmer and always has — that is type, not a
     sheen competing for the tap, and sweeping it in would make this check ask for the title
     treatment to be deleted. The invariant is about the row of actions. */
  + 'const spin=(document.getAnimations?document.getAnimations():[]).filter(a=>a.effect&&a.effect.target'
  + '&&a.effect.target.closest&&a.effect.target.closest("#shareSheet .ssBtn")'
  + '&&a.effect.getTiming().iterations===Infinity)'
  + '.map(a=>(a.effect.target.id||a.effect.target.className||"?")+(a.effect.pseudoElement||"")+":"+(a.animationName||"anim"));'
  + 'return{more:b(".ssBtn.ssMore"),plus:b("#ssPlus"),spin:spin};},'
  + 'grab(){document.getElementById("ssGrab").click();return this.snap();},'
  + 'fold(){stepSheet(-1);return new Promise(r=>setTimeout(()=>r(this.snap()),420));},'
  /* A REAL DRAG ON THE REAL HANDLE, in steps, because what has to be measured is what a thumb
     does: the card tracking the finger, and where it lands when the finger lifts. Calling
     stepSheet() would prove nothing about either — that is the API the drag was rewritten to
     stop going through. */
  + 'drag(dy,steps){const g=document.getElementById("ssGrab");'
  + 'const r=g.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;'
  + 'const ev=(t,cy)=>g.dispatchEvent(new PointerEvent(t,{pointerId:1,clientX:x,clientY:cy,bubbles:true}));'
  + 'const c=shareSheetEl.querySelector(".ssCard");'
  + 'ev("pointerdown",y);const seen=[];const n=steps||6;'
  + 'for(let i=1;i<=n;i++){ev("pointermove",y+dy*i/n);seen.push(Math.round(c.getBoundingClientRect().height));}'
  + 'ev("pointerup",y+dy);'
  + 'return new Promise(r2=>setTimeout(()=>r2(Object.assign({seen:seen},this.snap())),520));},'
  + 'visible(sel){const e=shareSheetEl.querySelector(sel);return e?getComputedStyle(e).display:"absent";},'
  + 'backdrop(){shareSheetEl.click();return this.snap();},'
  + 'snap(){const c=shareSheetEl.querySelector(".ssCard");return{state:ssState,'
  + 'cls:shareSheetEl.className,h:c.getBoundingClientRect().height,inline:c.style.height,'
  + 'gap:Math.round(innerHeight-c.getBoundingClientRect().bottom),'
  + 'resizing:shareSheetEl.classList.contains("ssResizing"),'
  + 'pe:getComputedStyle(shareSheetEl).pointerEvents};}};\n'
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
const exe = chromeExe();
if (!exe) { console.log('· no Chrome or Chromium found — skipping (set PW_CHROME=<path>)'); server.close(); process.exit(0); }
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
    cta: box('#ssInvite'),
    /* THE FOUR THINGS THAT REPLACED THE PREVIEW CARD IN THIS STATE. The headline makes a claim
       ("Your challenge is now live!"), #ssSub is the sentence the notification permission
       prompt depends on, #ssVis is the control that decides whether the headline is even true,
       and #ssSeeLive is the proof. Every one of them is exempted by name in the peek rule, and
       every one of them is a `:not()` somebody could drop without anything else objecting. */
    title: box('#shareSheet .pwTitle'),
    sub: box('#ssSub'),
    sign: box('#ssSign'),
    vis: box('#ssVis'),
    live: box('#ssSeeLive'),
    tabs: box('#ssMode'),
    instagram: box('#shareSheet .ssBtn.ig'),
    more: box('#shareSheet .ssBtn.ssMore'),
    liveColor: (() => {
      const e = document.querySelector('#ssSeeLive');
      return e ? { bg: getComputedStyle(e).backgroundColor, w: e.getBoundingClientRect().width } : null;
    })(),
    ctaColor: (() => {
      const s = getComputedStyle(document.querySelector('#ssInvite'));
      const r = getComputedStyle(document.querySelector('#ssInvite'), '::before');
      /* The shimmer lives on the ::before, and getAnimations() reports pseudo-element
         animations with `pseudoElement` set — the only way to see it from the outside. */
      const shimmer = (document.getAnimations ? document.getAnimations() : [])
        .filter((a) => a.effect && a.effect.target === document.querySelector('#ssInvite')
          && a.effect.pseudoElement === '::before')
        .map((a) => ({ name: a.animationName || 'anim', iter: a.effect.getTiming().iterations }));
      return { bg: s.backgroundColor, fg: s.color, shimmer, ring: r.padding, ringBg: r.backgroundImage };
    })(),
  };
});

console.log('\nTHE SHORT SHEET CARRIES THE WHOLE ASK');
seen.state === 'peek' ? ok('the sheet is in the short state') : bad(`state is ${seen.state}, not peek`);
seen.sheet && seen.sheet.display !== 'none' ? ok('the sheet is on screen') : bad('the sheet is not displayed at all');

/* Named individually rather than swept, because each one fails for its own reason and the
   fix is different every time — a missing `:not()` in the peek rule, an element that ships
   display:none and is never un-hidden, or a row that got nested inside another one and so
   stopped being a direct child of .ssCard at all. A sweep would say "something is missing". */
const shows = (key, what, why) => {
  const b = seen[key];
  b && b.display !== 'none' && b.h > 0
    ? ok(`${what} is on the short sheet (${Math.round(b.h)}px tall)`)
    : bad(`${what} is NOT on the short sheet — display:${b && b.display}. ${why}`);
};
shows('title', 'the headline', 'It is the sentence that says the hide is live, and this is the '
  + 'state most people meet it in.');
shows('sub', 'the notification line', 'It is the only context iOS ever gets before '
  + 'armResultsPing() asks for permission, and iOS asks exactly once. Without it the ask is '
  + 'refused and the app loses its only way to tell a creator somebody played their hide.');
shows('sign', 'the signature row', 'It shows the name the challenge goes out under. Hidden, a '
  + 'creator meets their own pseudonym for the first time in the feed, on somebody else\'s '
  + 'screen — which is exactly how it was reported.');
shows('vis', 'the visibility row', 'The headline directly above it claims the hide is public. '
  + 'Hiding the control that decides that leaves the claim unanswerable, and publishes a hide '
  + 'for the 23% who would have turned it off.');
shows('cta', 'the send', 'updateInviteBtn() did not un-hide it — the sheet has no action left.');
shows('live', '"See it live"', 'The sheet announces the hide is live and then hides the button '
  + 'that proves it, which is asking for trust it does not have to ask for.');

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

/* READ TOP TO BOTTOM IT HAS TO BE ONE SENTENCE: this is what happened, this is who can see
   it, send it, look at it. Get the order wrong and the sheet answers a question before it has
   been asked — a visibility control UNDER the send is a choice offered after the choice was
   made, and "See it live" above the send leads with the detour. */
console.log('\nIT READS TOP TO BOTTOM, AND BOTH BUTTONS ARE FULL WIDTH');
const below = (a, b, what) => {
  const x = seen[a], y = seen[b];
  x && y && y.top >= x.bottom - 1
    ? ok(what)
    : bad(`${b} is not under ${a} (${a} bottom ${x && Math.round(x.bottom)}, ${b} top `
        + `${y && Math.round(y.top)}) — overlapping boxes mean one is nested INSIDE the other's `
        + 'flex row rather than being its sibling in the card');
};
below('title', 'sub', 'the grey line sits under the headline, as its second half');
below('sub', 'sign', 'the signature row comes next — whose challenge this is');
below('sign', 'vis', 'then who can see it — the answer the headline depends on');
below('vis', 'cta', 'then the send: decide who can see it, then send it');
below('cta', 'live', '"See it live" follows the send rather than leading it');

/* The regression that shipped once: a button nested in another row became a cell in a flex
   row, so it was no taller than the row and far from full width. A 390px viewport with 20px
   padding either side makes a full-width button ~350px. Both are checked — the second one is
   newer, which is exactly why it is the one nobody would notice going wrong. */
const widths = await page.evaluate(() => ({
  cta: (document.querySelector('#ssInvite') || { getBoundingClientRect: () => ({ width: 0 }) }).getBoundingClientRect().width,
  live: (document.querySelector('#ssSeeLive') || { getBoundingClientRect: () => ({ width: 0 }) }).getBoundingClientRect().width,
}));
widths.cta > 300 && widths.live > 300
  ? ok(`both are full width (${Math.round(widths.cta)}px and ${Math.round(widths.live)}px of a 390px viewport)`)
  : bad(`the send is ${Math.round(widths.cta)}px and "See it live" ${Math.round(widths.live)}px — `
      + 'anything well under 350px is being laid out as a cell, not a button');

/* ONE PRIMARY, AND IT IS THE SEND. The white slab used to be defending itself against a
   full-saturation Instagram gradient below it; that button is gone, and what sits there now is
   a second full-width button one row down. Two white slabs stacked is two primaries, which is
   no primary at all — so the pair is asserted together: the send filled, "See it live" a
   ghost. A colour change is one token, and nothing else in the file would object to it. */
console.log('\nTHE PRIMARY LOOKS PRIMARY');
{
  const bg = (seen.ctaColor.bg || '').replace(/\s/g, '');
  bg === 'rgb(255,255,255)'
    ? ok(`the CTA is a white slab (text ${seen.ctaColor.fg})`)
    : bad(`the CTA background is ${seen.ctaColor.bg} — it is tinted again, and the sheet exists `
        + 'to produce sends');
  /* Measured as "not the send's fill" rather than against a literal rgba: the ghost's exact
     tint is a design decision that can move, and pinning it here would fail the next time
     somebody warms it by two percent. What must never happen is the two matching. */
  const liveBg = ((seen.liveColor && seen.liveColor.bg) || '').replace(/\s/g, '');
  liveBg && liveBg !== 'rgb(255,255,255)'
    ? ok(`and "See it live" is the ghost underneath it (${seen.liveColor.bg})`)
    : bad(`"See it live" is filled ${seen.liveColor && seen.liveColor.bg} — two white slabs `
        + 'stacked is two primaries, and the send stops being the obvious one');
  /* THE RING MUST STILL MOVE. Making the fill opaque did not delete this animation, it hid it:
     the gradient used to show through a 14%-alpha face, and afterwards only a 1px rim was left
     of it. Nothing in the CSS broke, so nothing failed — it was reported by eye. Checked here
     because "the animation is gone" is not a thing a diff can show. */
  const sh = seen.ctaColor.shimmer || [];
  sh.some((a) => a.iter === Infinity)
    ? ok(`the border still shimmers (${sh.map((a) => a.name).join(', ')}, infinite)`)
    : bad('no infinite animation on #ssInvite::before — the travelling border is dead');
  /* And it has to be thick enough to see. At 1px, against a dark card, the gradient's troughs
     are indistinguishable from no border at all for most of the 3.4s cycle. */
  parseFloat(seen.ctaColor.ring) >= 2
    ? ok(`the ring is ${seen.ctaColor.ring} wide`)
    : bad(`the ring is only ${seen.ctaColor.ring} — too thin for the motion to register on a phone`);
  /rgba?\(/.test(seen.ctaColor.ringBg || '') && /255,\s*255,\s*255/.test(seen.ctaColor.ringBg || '')
    ? ok('it uses the high-contrast ring (white peak), the one meant for edges against a dark ground')
    : bad(`the ring gradient is ${seen.ctaColor.ringBg} — --ring's 20% troughs vanish against the card`);
}

console.log('\nTHE SHORT SHEET IS STILL SHORT');
/* THE TABS ARE NOT HIDDEN, THEY ARE DELETED. #ssMode is no longer in the markup at all — the
   Challenge / Before-After switch went with the tab removal, and only its CSS survives as an
   orphan rule. The old assertion asked whether the element was display:none, so an element
   that does not exist read as "the tabs are showing", which is the exact opposite of the
   truth and sent the next reader looking for a peek-state CSS bug that was never there.
   What is worth asserting is that they have not come back: a share sheet that regrows a mode
   switch in the peek state is the design this whole state was built to replace. */
seen.tabs === null
  ? ok('the Challenge / Before-After tabs are gone from the sheet entirely')
  : bad(`#ssMode is back in the DOM (display ${seen.tabs && seen.tabs.display}) — the peek state does not have a mode switch`);
/* INSTAGRAM IS DELETED, NOT HIDDEN — same shape as the tabs above, and the same trap: an
   element that does not exist reads as display:"" to a check written against `display: none`,
   so the old assertion ("it must be reachable without swiping") would have gone GREEN on a
   sheet that no longer has the button at all.
   It was put in the short state on the strength of 7 taps in 7 days, which said the
   destinations were unreachable rather than unwanted. Once they were reachable the answer came
   back: over the 7 days to 2026-08-15, invite 2804 (86.6%) against instagram 221 (6.8%). A
   full-width gradient slab is what you spend on the thing people do. It lives in `more` now,
   which opens the system sheet — still the only route to a stranger this app has. */
seen.instagram === null
  ? ok('Instagram is out of the sheet entirely — 6.8% of taps does not buy a full-width slab')
  : bad(`the Instagram button is back in the DOM (display ${seen.instagram.display}) — it took a `
      + 'full-width gradient row for 6.8% of destination taps, directly under the send');
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
   quirk, not the design. What IS checked above is the thing that decides the height: which
   elements are displayed, and which are not. */
ok(`short-state content: grabber + headline (${Math.round(seen.title.h)}px) + line `
  + `(${Math.round(seen.sub.h)}px) + signature (${Math.round(seen.sign.h)}px) + visibility `
  + `(${Math.round(seen.vis.h)}px) + send (${Math.round(seen.cta.h)}px) + See it live `
  + `(${Math.round(seen.live.h)}px), nothing else`);

/* THE HANDLE WALKS DOWN, AND THE FLOOR LEADS BACK UP.
   It used to only ever step UP, so once the sheet was open the handle was an affordance that
   did nothing and the third detent was reachable by drag alone. The founder's call on
   2026-08-12 made taps walk DOWN — grand, petit, à peine vu — and wrap from the floor straight
   back to the full sheet, so every state is one tap from the next and the handle is never a
   dead end. This suite was still asserting the old toggle, which is most of why it was
   quarantined: peek → mini read as "a tap left it at mini" and the 25px folded bar was then
   measured as the LONG state.
   Driven through the real click handlers rather than by calling stepSheet, so the wiring is
   under test and not just the function. */
console.log('\nTHE HANDLE WALKS DOWN, AND THE FLOOR LEADS BACK UP');
{
  const settle = () => page.waitForTimeout(520);
  await page.evaluate(() => window.__t.present());
  const short = await page.evaluate(() => window.__t.snap());

  const small = await page.evaluate(() => window.__t.grab());
  small.state === 'mini'
    ? ok('a tap on the handle steps DOWN, peek → mini')
    : bad(`a tap on the peek left it at "${small.state}" — taps walk down, so the next one below `
        + 'the short sheet is the folded bar');
  await settle();

  const up = await page.evaluate(() => window.__t.grab());
  up.state === 'open'
    ? ok('and from the floor the next tap wraps back to the full sheet — no dead end')
    : bad(`a tap on the folded bar left it at "${up.state}" — the floor is where a walk-down `
        + 'handle strands people if it does not wrap');
  up.resizing && up.inline
    ? ok(`the growth is animated (playing to ${up.inline})`)
    : bad('the card jumped straight to the long state — no height transition was set up');

  await settle();
  const open = await page.evaluate(() => window.__t.snap());
  /* THE TARGET HAS TO BE THE HEIGHT IT ACTUALLY ENDS AT. It was not: openShareSheet() resized
     first and un-hid the upsell row afterwards, so the transition played to a height 38px short
     and the card snapped the rest of the way when the inline height was released. Silent — the
     animation ran, it just ended in the wrong place. */
  Math.abs(parseFloat(up.inline) - open.h) < 2
    ? ok(`and it plays to the height it settles at (${Math.round(open.h)}px)`)
    : bad(`it animates to ${up.inline} but settles at ${Math.round(open.h)}px — the content is `
        + 'still changing after the target was measured, so the card jumps at the end');
  open.inline === '' && !open.resizing
    ? ok('it lets go of the height when the transition ends')
    : bad(`the card is still pinned at ${JSON.stringify(open.inline)} (resizing=${open.resizing}) — `
        + 'it is stuck at a size the stylesheet no longer agrees with');
  open.h > short.h
    ? ok(`long is taller than short (${Math.round(short.h)}px → ${Math.round(open.h)}px)`)
    : bad(`the long state is ${Math.round(open.h)}px against a short state of ${Math.round(short.h)}px`);
  open.pe === 'auto'
    ? ok('the long state takes the backdrop, so a tap outside can reach it')
    : bad(`#shareSheet is pointer-events:${open.pe} while open — the tap-outside handler cannot fire`);

  /* THE UPSELL IS HALF A ROW, NOT A ROW. It was a borderless mint text link on its own line
     below everything, in the position people scroll past on the way to Cancel. Sharing the More
     line makes it a real target for no extra height — Save is dead on native, so More had the
     line to itself. Geometry, not classes: "side by side" is a claim about where they land. */
  console.log('\nMORE AND THE UPSELL SHARE ONE LINE');
  const row = await page.evaluate(() => window.__t.row());
  if (!row.more || !row.plus || row.plus.d === 'none') {
    bad(`the row is not both buttons — More=${!!row.more}, Remove mark=${row.plus && row.plus.d}`);
  } else {
    Math.abs(row.more.y - row.plus.y) < 2 && Math.abs(row.more.h - row.plus.h) < 2
      ? ok('they sit on the same line, at the same height')
      : bad(`they are on different lines (More at y=${Math.round(row.more.y)}h${Math.round(row.more.h)}, `
          + `Remove mark at y=${Math.round(row.plus.y)}h${Math.round(row.plus.h)})`);
    row.more.x < row.plus.x
      ? ok('More is on the left, the upsell on the right')
      : bad('the upsell is to the LEFT of More — the offer is leading the row');
    Math.abs(row.more.w - row.plus.w) < 2
      ? ok(`they split the line evenly (${Math.round(row.more.w)}px each)`)
      : bad(`the cells are ${Math.round(row.more.w)}px and ${Math.round(row.plus.w)}px — one is `
          + 'being squeezed, which is what happens when the flex share is not shared');
  }

  /* ONE MOVING THING ON THIS CARD. Instagram carried the paywall CTA's sheen, so the brightest
     animation on the sheet was on the button we do NOT want tapped first, right beside the
     ring on the one we do. Counted rather than grepped: a second sheen added under any other
     selector is the same mistake with a different name. */
  const spin = (row.spin || []).filter((s) => !/pwGlow/.test(s));
  spin.length === 1 && /ssInvite/.test(spin[0])
    ? ok(`exactly one button animates, and it is the right one (${spin[0]})`)
    : bad(`${spin.length} button animation(s): ${spin.join(', ') || 'none'} — the ring on `
        + '"Challenge a friend" is supposed to be the only one, and it is supposed to be there');

  /* Going DOWN, the long content must still be on screen while the box closes over it.
     Committing the short state up front animates an empty pocket instead. */
  const down = await page.evaluate(() => window.__t.grab());
  down.state === 'peek'
    ? ok('and one more tap closes the cycle, open → peek — three states, three taps')
    : bad(`a tap on the open sheet left it at "${down.state}" — the handle is inert once open`);
  /show/.test(down.cls) && down.resizing
    ? ok('the long content is held in place while the box closes over it')
    : bad(`the sheet is already "${down.cls}" at the start of the close — the destinations blink `
        + 'out and what animates is an empty green pocket');

  await settle();
  const back = await page.evaluate(() => window.__t.snap());
  /peek/.test(back.cls) && back.inline === '' && !back.resizing
    ? ok('and it commits to the short state once closed')
    : bad(`after the close the sheet is "${back.cls}" with height ${JSON.stringify(back.inline)}`);

  /* THE BACKDROP ONLY EXISTS ON THE LONG SHEET — #shareSheet is pointer-events:none in every
     other state, on purpose (the reveal's wipe handle is behind it), so this needs the full
     sheet under it. Two taps to get there, which is the walk-down cycle doing its job. */
  await page.evaluate(() => window.__t.grab());        // peek -> mini
  await settle();
  await page.evaluate(() => window.__t.grab());        // mini -> open
  await settle();
  const out = await page.evaluate(() => window.__t.backdrop());
  out.state === 'peek'
    ? ok('a tap outside the card puts the long sheet back to short')
    : bad(`a tap outside left it at "${out.state}" — dismissShareSheet is still unreachable`);
  await settle();
}

/* The name chip and its sign-from-the-sheet dialog were removed 2026-08-11 (founder's call:
   three chips read as clutter). Signing lives on the player card, whose blur handler owns the
   republish — covered by test-home-dom, not here. */
/* THE WORDMARK IS THE WAY INTO THE CARD FROM THE REVEAL, AND THE SHEET MUST SURVIVE IT.
   On the reveal the share sheet is the only route to a share — the Share button was removed
   when the sheet started presenting itself — so opening the card over that screen and closing
   it must not strand someone on a reveal with no way to send. */
/* THE THIRD DETENT — folded to the handle so the painting can be seen whole. A "mini" state
   existed before and was removed for a rendering bug (it swapped classes outside
   setSheetSize()), so what has to hold is that it goes through the same door as the others,
   that it hides the card without hiding the way back, and that the sheet never ARRIVES in it:
   the send is the flattest number in this app and starting folded costs a gesture. */
console.log('\nIT FOLDS TO THE HANDLE, AND COMES BACK');
{
  await page.evaluate(() => window.__t.present());
  const arrived = await page.evaluate(() => window.__t.snap());
  arrived.state === 'peek'
    ? ok('the sheet still ARRIVES in the peek, never folded')
    : bad(`the sheet arrived in "${arrived.state}" — folding by default puts the send a gesture further away`);

  const folded = await page.evaluate(() => window.__t.fold());
  folded.state === 'mini' && /\bssMini\b/.test(folded.cls)
    ? ok('a downward step folds it to the handle')
    : bad(`stepping down gave state=${folded.state} cls=${JSON.stringify(folded.cls)}`);
  /* A CEILING, NOT JUST "SHORTER". The first version stacked two safe-area insets — the
     card's and the grabber's — and left ~90px of empty green under the bar while still
     passing a "shorter than the peek" test. Halving that was still reported as "trop de
     hauteur": the state is meant to be a handle, its breathing room, and nothing else, so the
     assertion is absolute. 24px here is measured with NO safe-area inset (headless reports
     none); on a device the grabber adds ~20px more to clear the home pill. */
  folded.h < arrived.h && folded.h <= 62
    ? ok(`and the card is a bar, not a box (${Math.round(folded.h)}px, peek is ${Math.round(arrived.h)}px)`)
    : bad(`folded height ${Math.round(folded.h)}px — must be under 62px (peek: ${Math.round(arrived.h)}px). `
        + 'Check for a doubled var(--safe-b) between .ssCard and .ssGrab.');
  /* AND IT IS AGAINST THE EDGE. "Pas collé au bas de l'écran" is a different defect from
     "too tall" — a bar of the right height floating above the bottom edge looks like a bug in
     a way that a tall one does not — and nothing measured the gap, so only one of the two was
     ever being caught. */
  folded.gap === 0
    ? ok('and it sits flush on the bottom edge, with nothing under it')
    : bad(`there are ${folded.gap}px between the folded card and the bottom of the screen`);
  (await page.evaluate(() => window.__t.visible('.ssInvite'))) === 'none'
    ? ok('the CTA is put away with the rest of the card')
    : bad('the folded sheet still shows its buttons — it is not folded, it is just shorter');
  (await page.evaluate(() => window.__t.visible('.ssGrab'))) !== 'none'
    ? ok('but the handle stays, so there is a way back')
    : bad('the handle is gone in the folded state — the sheet is now unreachable');

  /* AND THE FLOOR IS NOT A TRAP. Taps walk down, so from here the only way the handle can go
     is back to the top — one tap to the full sheet. Asserting "it returns to the peek" was the
     old toggle's contract and it is what made this look like a bug: the state it actually
     lands on is `open`, which is the whole point of wrapping. */
  const back = await page.evaluate(() => window.__t.grab());
  await page.waitForTimeout(420);
  (await page.evaluate(() => window.__t.snap())).state === 'open'
    ? ok('and one tap from the floor brings the whole sheet back')
    : bad(`tapping the handle from mini gave "${back.state}" — the floor has to lead somewhere, `
        + 'or folding the sheet is how you lose the send');
}

/* THE CARD FOLLOWS THE FINGER, AND ONE GESTURE CAN CROSS TWO DETENTS.
   It used to do neither: 24px past a threshold fired one stepSheet() and then locked the
   gesture out until the finger came up. So the sheet never tracked the hand — a drag felt
   like a button misfiring — and pulling the open sheet down to the handle was impossible in
   one movement, which is exactly what was reported. Both halves are asserted, because fixing
   only the second would leave the gesture feeling just as dead. */
console.log('\nDRAGGING THE HANDLE MOVES THE CARD, NOT JUST ITS STATE');
{
  await page.evaluate(() => window.__t.present());
  await page.evaluate(() => window.__t.grab());              // peek -> mini
  await page.waitForTimeout(420);
  await page.evaluate(() => window.__t.grab());              // mini -> open (the wrap)
  await page.waitForTimeout(420);
  const open = await page.evaluate(() => window.__t.snap());
  open.state === 'open'
    ? ok('starting from the full sheet')
    : bad(`could not reach the open state to drag from (got "${open.state}")`);

  const d = await page.evaluate(() => window.__t.drag(520, 8));
  const shrinking = d.seen.every((h, i) => i === 0 || h <= d.seen[i - 1]);
  const moved = d.seen[0] - d.seen[d.seen.length - 1];
  shrinking && moved > 80
    ? ok(`the card tracks the finger down (${d.seen[0]}px → ${d.seen[d.seen.length - 1]}px across the drag)`)
    : bad(`the card did not follow: heights were ${JSON.stringify(d.seen)} — a drag that only `
        + 'fires a state change at a threshold reads as a button that misfired');
  d.state === 'mini'
    ? ok('and one long drag crosses BOTH detents, open → mini, as the finger asked')
    : bad(`a 520px drag from open landed on "${d.state}" — one gesture must be able to reach `
        + 'the smallest position, not step exactly one detent per touch');
  d.inline === ''
    ? ok('and the inline height is handed back to the stylesheet on settle')
    : bad(`the card is pinned at inline height ${JSON.stringify(d.inline)} — a stuck height on `
        + 'the reveal is a dead end, since the sheet is the only route to a send');

  const up = await page.evaluate(() => window.__t.drag(-520, 8));
  up.state === 'open'
    ? ok('and dragging back up returns the full sheet in one gesture')
    : bad(`dragging up 520px from mini landed on "${up.state}"`);
}

console.log('\nTAPPING THE WORDMARK OPENS THE CARD, AND CLOSING IT GIVES THE SHEET BACK');
{
  await page.evaluate(() => window.__t.present());
  const opened = await page.evaluate(() => window.__t.tapBrand(0, 0));
  opened.card
    ? ok('a tap on the wordmark opens the player card')
    : bad('the wordmark did not open the card — the tap is hit-tested at the document, so a '
        + 'listener bound to the element would not fire here at all');

  const closed = await page.evaluate(() => window.__t.closeCard());
  !closed.card && /peek/.test(closed.sheet) && closed.state === 'peek'
    ? ok('closing it brings the share sheet back, short')
    : bad(`after closing the card the sheet is "${closed.sheet}" (${closed.state}) — on the reveal `
        + 'that is a screen with no way to share');

  /* From the LONG sheet it must come back short, not as it was: coming out of an unrelated
     detour into a wall of destinations is not where anyone left off. */
  await page.evaluate(() => window.__t.grab());
  await page.waitForTimeout(520);
  await page.evaluate(() => window.__t.tapBrand(0, 0));
  const back = await page.evaluate(() => window.__t.closeCard());
  back.state === 'peek'
    ? ok('and it comes back short even when it was long')
    : bad(`the sheet came back as "${back.state}" — the long sheet covers the reveal`);

  /* A drag across the mark is a brush stroke, not a tap. */
  const dragged = await page.evaluate(() => window.__t.tapBrand(40, 0));
  !dragged.card
    ? ok('a drag across it is not a tap')
    : bad('dragging over the wordmark opened the card — a brush stroke crossing it would too');
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
/* THE GENERIC LINE MUST QUOTE NOTHING AT ALL. It is the fallback for every source with no
   pitch of its own, so it cannot promise a figure it has no context to be right about — and
   since KAMO+ lost its clocks on 2026-08-11 there is no figure left in it to quote. The old
   version of this also demanded the words "no clock"; the line has since been rewritten as
   the three-item bundle it sells now, and requiring one particular phrase from a summary is
   asking the copy never to change. The invariant is the digit. */
const genericLine = (all.find(([k]) => k === 'generic') || [])[1] || '';
!/\d/.test(genericLine)
  ? ok(`"generic" sells the bundle without quoting a figure ("${genericLine}")`)
  : bad(`the generic pitch quotes a number: ${JSON.stringify(genericLine)}`);

/* IT IS A KAMO, NEVER A BODY — the founder's copy rule, and this is the one place it can be
   enforced across every paywall line at once. It caught three live strings the day it was
   written: pwGenericSub said "Every body and every finish" while PW_PITCH.char said "Every
   kamo and every finish" on the same paywall, the member card wore an "Every body" chip, and
   the seeker's wrong-figure ending was headlined "Wrong body." Two names for the same object
   is the product failing to know what it sells, and every one of them read as correct in its
   own diff. */
{
  const wrong = all.filter(([, v]) => /\bbod(y|ies)\b/i.test(v)).map(([k, v]) => `${k}: ${JSON.stringify(v)}`);
  wrong.length === 0
    ? ok('no paywall line calls the figurine a "body"')
    : bad(`${wrong.join(' · ')} — the figurine is a kamo everywhere a user can read it, and the `
        + 'rest of this paywall already says so');
}
says('time', [`${f.paint} seconds`, 'no clock']);
/* The size pitch is the one that states NO figure, on purpose: "Free paints at 3 fixed sizes"
   was cut because it sells the limitation instead of the range. So it is asserted the other way
   round — it must not quote a count — which still catches a hardcoded number creeping back in,
   the thing this block exists to prevent. */
const sizeLine = (all.find(([k]) => k === 'size') || [])[1] || '';
/\d/.test(sizeLine)
  ? bad(`the "size" pitch quotes a figure again — it reads: ${JSON.stringify(sizeLine)}`)
  : ok('"size" sells the range without quoting a count');
says('color', [`${f.shades} shades`]);
/* THE "chset" PITCH IS GONE, and asserting it was costing two failures for one deletion: no
   such line, and `${f.lo}-${f.hi}s` interpolating two constants that had already been removed
   from the hook. It sold the gear that set the seeker's clock and tap budget; the round is one
   buzz on no clock now, so there is nothing to set. What replaces it is the rule the whole
   block exists for, stated positively — every pitch that DOES quote a figure is named above,
   and any new one has to be added here rather than shipping unchecked. */
{
  const quoted = all.filter(([k, v]) => /\d/.test(v) && !['generic', 'size'].includes(k)).map(([k]) => k);
  const covered = new Set(['time', 'color']);
  const loose = quoted.filter((k) => !covered.has(k));
  loose.length === 0
    ? ok(`every pitch that quotes a figure is checked against its constant (${[...covered].join(', ')})`)
    : bad(`${loose.join(', ')} quote(s) a number that nothing above verifies — a template can `
        + 'interpolate the wrong constant and still look perfect in the source');
}

await browser.close();
server.close();
console.log(failed ? `\n✗ ${failed} failure(s)`
  : '\n✓ the short sheet carries the whole ask, in order, and the handle is never a dead end');
process.exit(failed ? 1 : 0);
