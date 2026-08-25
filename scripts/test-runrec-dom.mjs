#!/usr/bin/env node
/**
 * THE RECORD SPEAKS ON THE BREAK, AND IT DOES NOT LAND ON THE TITLE.
 *
 * `best` has been written to localStorage since the run shipped and read back by nothing, so
 * the first player to see it will see it here — on the loss, where it is the only number left
 * to chase. The suffix costs eight to ten characters on a pill that the file has already
 * measured as living one row away from the headline:
 *
 *     "At 390px: the break overlaps it by 44px, the record by 12-22px depending on the string."
 *
 * That measurement is why the sentence is only affordable in `.dead`, which chRunShow moves
 * into .chTop's centred column (position:static) before it prints. The whole safety argument
 * is therefore a LAYOUT claim, not a copy one, and a layout claim asserted in a comment is a
 * layout claim that stops being true the first time somebody re-styles the pill. So this reads
 * the two rectangles back out of a real browser and intersects them.
 *
 * Both widths, because they fail differently: 390px is where the overlap was photographed, and
 * 320px (iPhone SE) is where a pill that no longer overlaps anything can still outgrow the
 * screen it is centred on — the failure the move to .chTop cannot catch by itself.
 *
 * The equality case is the other half. best >= broke always, and at equality the run that just
 * died IS the record: "Run of 6 broken · best 6" prints one number twice. Asserted as an
 * ABSENCE, because that is the kind of rule a later edit removes by accident.
 *
 *   PW_CORE=<dir with node_modules> node scripts/test-runrec-dom.mjs
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
  console.log('· playwright-core not installed — skipping the run-record test — run: ' + PW_SETUP);
  process.exit(0);
}

const real = readFileSync(join(ROOT, 'index.html'), 'utf8');
/* Same anchor test-seek-dom uses, and for the same reason: the seeker IIFE fetches the hide on
   load, so a hook appended after the module has already missed it. */
const anchor = 'async function chRpc(fn,body){';
const html = real.replace(anchor, anchor +
  'if(window.__seed&&window.__seed[fn]) return window.__seed[fn];');
const PNG = readFileSync(join(ROOT, 'icon.png'));

const MIME = {'.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.css':'text/css'};
const server = createServer((rq, rs) => {
  const p = decodeURIComponent(rq.url.split('?')[0]);
  if (p === '/' || p === '/index.html') { rs.writeHead(200, {'Content-Type':'text/html'}); return rs.end(html); }
  try {
    const b = readFileSync(join(ROOT, p.replace(/^\/+/, '')));
    rs.writeHead(200, {'Content-Type': MIME[p.slice(p.lastIndexOf('.'))] || 'application/octet-stream'});
    rs.end(b);
  } catch { rs.writeHead(404); rs.end('x'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

const exe = chromeExe();
if (!exe) { console.log('· no Chrome or Chromium found — skipping (set PW_CHROME=<path>)'); server.close(); process.exit(0); }
const browser = await chromium.launch({ executablePath: exe });
let failed = 0;
const ok = m => console.log('  ✓ ' + m), bad = m => { failed++; console.error('  ✗ ' + m); };

/* One wrong tap ends the round — the miss branch calls ending() directly, it does not wait for
   max_taps — so the whole fixture is: seed the two numbers, load, tap once, read the pill. */
async function breakRun(run, best, width, life = false) {
  const page = await browser.newPage({ viewport: { width, height: 844 }, deviceScaleFactor: 2 });
  /* The camo photo is an absolute Supabase URL, so it cannot come off the local server. A real
     decoded image matters here and did not in test-seek-dom: an <img> that never loads leaves
     .chFrame at zero height, and a tap on a zero-height frame is a tap on nothing. */
  await page.route('**/storage/v1/object/public/hides/**', r => r.fulfill({ contentType: 'image/png', body: PNG }));
  await page.addInitScript(([r, b, l]) => {
    window.__seed = {
      get_hide: { img_path: 'x.png', secs: 9, n_attempts: 0, n_found: 0, limit_s: 20, max_taps: 5, name: 'tony' },
      submit_attempt: { hit: false, tries: 1, missed: 1, secs: 0, pct: null, others: 0 },
    };
    try {
      localStorage.setItem('kamo_seek_run', String(r)); localStorage.setItem('kamo_seek_best', String(b));
      /* SPENT UNLESS THE CASE SAYS OTHERWISE. A run now survives its first miss, so every
         assertion below about a BREAK is an assertion about a run with no life left — and
         leaving this unseeded would have silently turned each of them into a save test that
         happened to still read a pill. "0" is spent; anything else, missing included, is a
         life in hand. */
      localStorage.setItem('kamo_seek_life', l ? '1' : '0');
    } catch (e) {}
  }, [run, best, life]);
  await page.goto(base + '?h=abc123', { waitUntil: 'load' });
  await page.waitForTimeout(900);
  const frame = await page.locator('#chFrame').boundingBox();
  if (!frame) { await page.close(); return { err: 'the frame never mounted' }; }
  await page.mouse.click(frame.x + frame.width / 2, frame.y + frame.height / 2);
  await page.waitForTimeout(1300);
  const out = await page.evaluate(() => {
    const pill = document.getElementById('chRun'), head = document.getElementById('chHead');
    if (!pill || !head) return { err: 'pill or headline missing' };
    const p = pill.getBoundingClientRect(), h = head.getBoundingClientRect();
    return {
      text: pill.textContent.trim(), cls: pill.className,
      /* WHAT THE RUN IS AFTER THE ROUND, read from storage rather than inferred from the
         pill: a pill that says the right sentence over a number that was silently zeroed is
         the exact failure this rule exists to prevent, and it looks identical on screen. */
      stored: (() => { try { return {
        run: localStorage.getItem('kamo_seek_run'), life: localStorage.getItem('kamo_seek_life'),
      }; } catch (e) { return {}; } })(),
      sub: (document.getElementById('chSub') || {}).textContent || '',
      shown: getComputedStyle(pill).display !== 'none',
      /* The founder's question, answered as geometry: do the two boxes share any area at all. */
      overlap: !(p.right <= h.left || p.left >= h.right || p.bottom <= h.top || p.top >= h.bottom),
      offscreen: p.left < 0 || p.right > innerWidth,
      /* Two lines inside a 999px pill is not an overlap, but it is the same string being too
         long for the same screen — worth failing while the cause is still one commit old.
         MEASURED AGAINST THE PILL'S OWN LINE, not against a constant. This read `> 40`, which
         was the pill's height on the day it was written — an assertion about FONT SIZE wearing
         the clothes of an assertion about wrapping. The docked pill is deliberately larger than
         the one that number was taken from and tripped it at 390px while sitting plainly on one
         line; the honest reading of that failure is that the probe was wrong, not the pill.
         Line-height plus the box's own padding and borders asks the question that was meant, at
         any size this pill is ever given. */
      wrapped: (() => {
        const cs = getComputedStyle(pill);
        const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2;
        const box = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom)
                  + parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
        return p.height > lh * 1.6 + box;
      })(),
      /* WHERE IT ENDED UP, and this is read as STRUCTURE rather than as pixels because the
         failure mode is not a collision — it is a silent disappearance. #chFoot is written with
         innerHTML when the ending card is built, and ending() calls chRunShow ~90 lines before
         that write: a pill docked one line too early is destroyed by the card it was docked in
         front of, and the round simply ends with no run on it. Nothing overlaps, nothing runs
         off screen, every geometric assertion above still passes, and the feature is gone.
         So: still in the document, first child of the foot, and ahead of the flip button that
         used to prepend itself into exactly that slot. */
      docked: pill.parentElement && pill.parentElement.id === 'chFoot',
      first: pill.parentElement && pill.parentElement.firstElementChild === pill,
      aboveCard: (() => { const c = document.querySelector('#chFoot .chCard');
        return !!c && !!(pill.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING); })(),
      aboveFlip: (() => { const f = document.getElementById('chFlipB');
        return !f || !!(pill.compareDocumentPosition(f) & Node.DOCUMENT_POSITION_FOLLOWING); })(),
    };
  });
  await page.close();
  return out;
}


/* ⚠️ AND THE STATE NOBODY EVER SAW, WHICH IS MOST OF THEM. Until 2026-08-20 the pill was hidden
   whenever the run was 0 and `best` was passed only on the break — so it appeared when you were
   winning, vanished when you were not, and showed your record exactly once, in its own epitaph.
   The median best run in the whole base is 3: most people are at 0 most of the time, so the
   centre of this game was invisible to most of them, permanently.
   These read the pill AT MOUNT, with no tap, because that is the state the old fixture could
   not reach — breakRun() taps, and a tap is what produced the only state that was ever tested. */
async function atMount(run, best, width) {
  const page = await browser.newPage({ viewport: { width, height: 844 }, deviceScaleFactor: 2 });
  await page.route('**/storage/v1/object/public/hides/**', r => r.fulfill({ contentType: 'image/png', body: PNG }));
  await page.addInitScript(([r, b]) => {
    window.__seed = {
      get_hide: { img_path: 'x.png', secs: 9, n_attempts: 0, n_found: 0, limit_s: 20, max_taps: 5, name: 'tony' },
      submit_attempt: { hit: false, tries: 1, missed: 1, secs: 0, pct: null, others: 0 },
    };
    try { localStorage.setItem('kamo_seek_run', String(r)); localStorage.setItem('kamo_seek_best', String(b)); } catch (e) {}
  }, [run, best]);
  await page.goto(base + '?h=abc123', { waitUntil: 'load' });
  await page.waitForTimeout(1100);
  const out = await page.evaluate(() => {
    const pill = document.getElementById('chRun'), head = document.getElementById('chHead');
    if (!pill || !head) return { err: 'pill or headline missing' };
    const p = pill.getBoundingClientRect(), h = head.getBoundingClientRect();
    return {
      text: pill.textContent.trim(), cls: pill.className,
      shown: getComputedStyle(pill).display !== 'none',
      overlap: !(p.right <= h.left || p.left >= h.right || p.bottom <= h.top || p.top >= h.bottom),
      offscreen: p.left < 0 || p.right > innerWidth,
      height: Math.round(p.height),
    };
  });
  await page.close();
  return out;
}

console.log('\nAT ZERO IT NAMES THE TARGET INSTEAD OF THE VOID');
{
  const r = await atMount(0, 6, 390);
  r.err ? bad(r.err)
    : r.shown && r.text === 'Best 6'
      ? ok(`a player at 0 with a record is told what there is to beat ("${r.text}")`)
      : bad(`the zero state reads ${JSON.stringify(r.text)} shown=${r.shown}`);
  !r.overlap && !r.offscreen ? ok('and it clears the headline like every other state') : bad('the zero state collides');
  /* Quieter than a live run: it is a target, not a stake. Giving it the same weight would tell
     somebody at 0 that they are in the middle of something. */
  /rest/.test(r.cls || '') ? ok('and it is drawn as the quiet state') : bad(`class is ${JSON.stringify(r.cls)}`);
}
{
  /* NOTHING AT ALL FOR A GENUINELY NEW PLAYER. There is no true sentence yet, and the
     alternative is teaching copy — the two biggest teaching pills on this screen were deleted
     for spending 7.2 seconds of a round on text. */
  const r = await atMount(0, 0, 390);
  r.err ? bad(r.err)
    : r.shown === false ? ok('and a player with no record at all is shown nothing, rather than a 0')
    : bad(`a brand-new player sees ${JSON.stringify(r.text)}`);
}

console.log('\nTHE RECORD IS VISIBLE WHILE THE RUN IS LIVE, NOT ONLY IN ITS EPITAPH');
{
  const r = await atMount(4, 6, 390);
  r.err ? bad(r.err)
    : r.text === '4 · best 6' ? ok(`a live run carries the number it is chasing ("${r.text}")`)
    : bad(`a live run reads ${JSON.stringify(r.text)}`);
  r.height <= 44 ? ok('on one line') : bad(`the live pill is ${r.height}px tall — it wrapped`);
}
{
  /* Same rule the break line already follows: at best <= run the record IS this run, and
     "6 · best 6" prints one number twice and reads like a bug. */
  const r = await atMount(6, 6, 390);
  r.err ? bad(r.err)
    : r.text === '6' ? ok('and says it once when the run has caught the record')
    : bad(`equality reads ${JSON.stringify(r.text)}`);
}

console.log('\nAND IT WEIGHS MORE ONCE THERE IS SOMETHING TO LOSE');
/* p90 of the best run anyone has ever had is 8 and p99 is 18, so a live 7 is rare air: the tap
   is expensive and a hint is worth its price for the first time. That is the moment the pill
   has to stop looking like the one at 1. */
{
  const lo = await atMount(4, 9, 390), hi = await atMount(7, 9, 390);
  !/\bhot\b/.test(lo.cls || '') ? ok('a run of 4 is drawn plainly') : bad('the escalation fires too early');
  /\bhot\b/.test(hi.cls || '') ? ok('a run of 7 is drawn as a stake') : bad(`a run of 7 reads class ${JSON.stringify(hi.cls)}`);
  hi.height <= 52 && !hi.overlap && !hi.offscreen
    ? ok('and the heavier pill still clears the headline and the viewport')
    : bad(`the hot pill is ${hi.height}px, overlap=${hi.overlap} offscreen=${hi.offscreen}`);
}

console.log('\nTHE BROKEN RUN NAMES THE RECORD IT FELL SHORT OF');
for (const width of [390, 320]) {
  const r = await breakRun(4, 6, width);
  if (r.err) { bad(`${width}px: ${r.err}`); continue; }
  r.text === 'Run of 4 broken · best 6'
    ? ok(`${width}px: the break carries the record ("${r.text}")`)
    : bad(`${width}px: the break reads ${JSON.stringify(r.text)}`);
  r.overlap ? bad(`${width}px: the pill lands on the headline — the collision the dock exists to prevent`)
            : ok(`${width}px: pill and headline share no pixels`);
  r.offscreen ? bad(`${width}px: the pill runs off the screen`) : ok(`${width}px: the pill fits its viewport`);
  r.wrapped ? bad(`${width}px: the sentence wrapped inside the pill`) : ok(`${width}px: one line`);
}

console.log('\nAND IT DOCKS WHERE THE EYE ALREADY IS — ABOVE THE CARD, NOT UNDER THE HEADLINE');
/* Founder, 2026-08-18. The round ends at the BOTTOM of the phone: that is where the reveal
   lands the flip button and the card with the two buttons on it. Announcing the run at the far
   end of the screen from where the player is looking is the whole thing this replaces. */
{
  const r = await breakRun(4, 6, 390);
  if (r.err) bad(r.err);
  else {
    r.docked ? ok('the ended run is inside #chFoot') : bad('the ended pill is not in the foot at all — did the card\'s innerHTML eat it?');
    r.first ? ok('as that column\'s first child') : bad('the pill is in the foot but something is above it');
    r.aboveCard ? ok('and ahead of the ending card') : bad('the card comes before the pill');
    r.aboveFlip ? ok('and ahead of the flip button, which used to own that slot') : bad('the flip button prepended itself above the pill');
  }
}

console.log('\nA RUN WORTH LOSING SURVIVES ITS FIRST MISS');
/* The median best run in the whole base is 3, and one miss used to send the number to zero —
   the mechanic shape that teaches a player there is nothing left to come back for. The first
   miss on a run worth losing spends a life instead. */
{
  const r = await breakRun(4, 6, 390, true);
  if (r.err) bad(r.err);
  else {
    r.text === 'Run of 4 held'
      ? ok(`the run is held, and the pill says so ("${r.text}")`)
      : bad(`a first miss on a run of 4 reads ${JSON.stringify(r.text)}`);
    /* The screen and the storage have to agree. A pill saying "held" over a run that was
       zeroed anyway is worse than no save at all. */
    r.stored.run === '4' ? ok('and the run is still 4 in storage') : bad(`storage kept run=${r.stored.run}`);
    r.stored.life === '0' ? ok('and the life is spent') : bad(`life reads ${JSON.stringify(r.stored.life)}`);
    /\bheld\b/.test(r.cls || '') ? ok('and it is drawn as its own state, not as a loss') : bad(`class is ${JSON.stringify(r.cls)}`);
    /one more miss/i.test(r.sub) ? ok(`and the card spends its subtitle on the stake ("${r.sub}")`) : bad(`the subtitle reads ${JSON.stringify(r.sub)}`);
  }
}
{
  /* AND A SECOND MISS ENDS IT EXACTLY AS BEFORE. The life is one, not a shield: if this
     branch ever stops firing the run becomes unloseable and the stake is gone. */
  const r = await breakRun(4, 6, 390, false);
  r.err ? bad(r.err)
    : r.text === 'Run of 4 broken · best 6' ? ok('with no life left, the same miss ends the run')
    : bad(`a miss with no life reads ${JSON.stringify(r.text)}`);
  r.stored && r.stored.run === '0' ? ok('and the run is zero in storage') : bad(`storage kept run=${r.stored && r.stored.run}`);
  /* THE LIFE COMES BACK WITH THE NEXT RUN. Starting a fresh run already spent would carry a
     punishment across the line the player was told was final. */
  r.stored && r.stored.life === '1' ? ok('and the next run starts with its life') : bad(`life after a death reads ${JSON.stringify(r.stored && r.stored.life)}`);
}
{
  /* NOTHING TO SAVE AT 1. "Your run of 1 survives" is a ceremony about nothing, and it is the
     same threshold the break line already refuses to speak below. */
  const r = await breakRun(1, 6, 390, true);
  r.err ? bad(r.err)
    : !/held/.test(r.text) ? ok('a run of 1 is not worth a life')
    : bad(`a run of 1 reads ${JSON.stringify(r.text)}`);
  r.stored && r.stored.life === '1' ? ok('and the life is not spent on it') : bad(`life reads ${JSON.stringify(r.stored && r.stored.life)}`);
}

console.log('\nAND STAYS QUIET WHEN THE RUN THAT DIED WAS THE RECORD');
{
  const r = await breakRun(6, 6, 390);
  if (r.err) bad(r.err);
  else r.text === 'Run of 6 broken'
    ? ok(`equality prints the number once ("${r.text}")`)
    : bad(`equality reads ${JSON.stringify(r.text)}`);
}

await browser.close(); server.close();
console.log(failed ? `\n✗ ${failed} failure(s)` : '\n✓ the record speaks on the break and stays off the title');
process.exit(failed ? 1 : 0);
