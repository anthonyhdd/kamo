#!/usr/bin/env node
/**
 * "SOMETHING HAPPENED WHILE YOU WERE AWAY" — the dot, and what clears it.
 *
 * This used to be a chip pinned under the wordmark reading "12 people tried · 3 found you":
 * once per launch, newest hide only, dismissible and then gone until the next cold start. A
 * notification you could only read at the moment it chose to appear, written over the camera.
 * The player card now carries the same numbers for every hide, at any time, so the camera keeps
 * a dot and nothing else — it says there is something to read, and the wordmark it sits on is
 * what you tap to read it.
 *
 * THE INVARIANT IS THE WORD "NEW". The dot is driven by a stored COUNT, not a flag, so it comes
 * back when the next person plays and not before. A flag would either latch on forever or clear
 * itself the first time and never speak again — and both look identical on the day you ship.
 *
 * Three failures here are silent and total: a dot that never appears (the feature is invisible),
 * a dot that never clears (it becomes furniture and stops meaning anything), and a dot that
 * reappears for results already read (it lies, and people stop tapping it).
 *
 *   PW_CORE=<dir with node_modules> node scripts/test-mine-dom.mjs
 */
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const req = createRequire(import.meta.url);
let chromium = null;
for (const base of [process.env.PW_CORE, ROOT, process.cwd()]) {
  try { ({ chromium } = req(base ? join(base, 'node_modules/playwright-core') : 'playwright-core')); break; } catch {}
}
if (!chromium) {
  console.log('· playwright-core not installed — skipping the results-dot test (set PW_CORE=<dir with node_modules>)');
  process.exit(0);
}

const real = readFileSync(join(ROOT, 'index.html'), 'utf8');
const at = real.lastIndexOf('</script>');
const html = real.slice(0, at)
  + '\nwindow.__m={'
  /* chRpc is replaced per id so an expired hide (get_hide answers with nothing) is exercised
     rather than assumed, and so the totals can be checked against known rows. */
  + 'seed(ids,rows,seen){try{localStorage.setItem("kamo_hides",JSON.stringify(ids));'
  + 'seen==null?localStorage.removeItem("kamo_seen_tries"):localStorage.setItem("kamo_seen_tries",String(seen));}catch(e){}'
  + 'chRpc=(fn,b)=>Promise.resolve(rows[b.p_id]||null);},'
  + 'async check(){await chNewsCheck();return this.dot();},'
  + 'async openCard(){await khResults();return{dot:this.dot(),'
  + 'seen:(()=>{try{return localStorage.getItem("kamo_seen_tries")}catch(e){return null}})(),'
  + 'text:(document.getElementById("khScore")||{}).textContent||"",'
  + 'shown:(document.getElementById("khScore")||{}).style.display};},'
  + 'dot(){const b=document.querySelector(".brand");return !!b&&b.classList.contains("hasNews");},'
  /* The accordion is driven through a real click on the box rather than by calling the paint
     function: the whole point of the change is that the summary IS the tap target, and a test
     that calls the renderer directly would pass with the handler unwired. */
  + 'expand(){const e=document.getElementById("khScore");e.click();'
  + 'return[...e.querySelectorAll(".khRow")].map(r=>({txt:(r.querySelector(".khRowTxt")||{}).textContent||"",'
  + 'send:!!r.querySelector(".khSend"),'
  + 'shot:((r.querySelector(".khShot img")||{}).getAttribute?r.querySelector(".khShot img").getAttribute("src"):null)}));},'
  /* navigator.share is undefined in headless Chromium, so this stubs the branch the shipped
     web path actually takes and captures the exact message that would leave the phone. */
  + 'send(i){window.__sent=null;navigator.share=(o)=>{window.__sent=o.text;return Promise.resolve();};'
  + 'const b=document.querySelectorAll("#khScore .khSend")[i];if(!b)return Promise.resolve(null);'
  + 'b.click();return new Promise(r=>setTimeout(()=>r(window.__sent),80));},'
  /* The TEXT rect, not the element's. A block in normal flow is full-width, so its box centre
     lands on the viewport centre whether or not the word inside it does — which is exactly how
     a wordmark pinned to the left edge measured as perfectly centred. */
  + 'mark(news){const b=document.querySelector(".brand");b.classList.toggle("hasNews",!!news);'
  + 'const rg=document.createRange();rg.selectNodeContents(b);const t=rg.getBoundingClientRect();'
  + 'return{pos:getComputedStyle(b).position,cx:Math.round(t.left+t.width/2),'
  + 'boxW:Math.round(b.getBoundingClientRect().width)};},'
  /* The reveal composites across the whole stage, so "is the wordmark above #revealC" is a
     question about z-index in the shared stacking context, not about display. */
  + 'reveal(on){stage.classList.toggle("done",!!on);const b=document.querySelector(".brand");'
  + 'const z=(el)=>parseInt(getComputedStyle(el).zIndex,10)||0;'
  + 'return{brand:z(b),canvas:z(document.getElementById("revealC")),'
  + 'handle:z(document.getElementById("revealHandle")),pe:getComputedStyle(b).pointerEvents};}};\n'
  + real.slice(at);

const MIME = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.css': 'text/css' };
const server = createServer((rq, rs) => {
  const p = decodeURIComponent(rq.url.split('?')[0]);
  if (p === '/' || p === '/index.html') { rs.writeHead(200, { 'Content-Type': 'text/html' }); return rs.end(html); }
  try {
    const body = readFileSync(join(ROOT, p.replace(/^\/+/, '')));
    rs.writeHead(200, { 'Content-Type': MIME[p.slice(p.lastIndexOf('.'))] || 'application/octet-stream' });
    rs.end(body);
  } catch { rs.writeHead(404); rs.end('not found'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;

let failed = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { failed++; console.error('  ✗ ' + m); };

const { globSync } = await import('node:fs');
const exe = (globSync('/opt/pw-browsers/chromium-*/chrome-linux/chrome') || [])[0];
if (!exe) { console.log('· no chromium under /opt/pw-browsers — skipping'); server.close(); process.exit(0); }
const browser = await chromium.launch({ executablePath: exe });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__m, null, { timeout: 10000 });

console.log('\nTHE DOT MEANS SOMETHING NEW');
{
  await page.evaluate(() => window.__m.seed([], {}, null));
  (await page.evaluate(() => window.__m.check())) === false
    ? ok('no hides sent → no dot')
    : bad('the dot shows for someone who has never published a hide');

  await page.evaluate(() => window.__m.seed(['a'], { a: { n_attempts: 0, n_found: 0 } }, null));
  (await page.evaluate(() => window.__m.check())) === false
    ? ok('hides sent but nobody has played → no dot')
    : bad('the dot shows before anyone has played — it would be on permanently from the first hide');

  await page.evaluate(() => window.__m.seed(['a', 'b', 'gone'],
    { a: { n_attempts: 9, n_found: 2 }, b: { n_attempts: 3, n_found: 1 } }, null));
  (await page.evaluate(() => window.__m.check())) === true
    ? ok('someone played → the dot appears')
    : bad('nothing appeared after 12 attempts across two hides');
}

console.log('\nREADING IT CLEARS IT, AND ONLY NEW PLAY BRINGS IT BACK');
{
  const card = await page.evaluate(() => window.__m.openCard());
  card.dot === false
    ? ok('opening the card puts the dot out')
    : bad('the dot survived being read — it becomes furniture and stops meaning anything');
  card.seen === '12'
    ? ok('and the count that was read is remembered (12)')
    : bad(`kamo_seen_tries is ${JSON.stringify(card.seen)} after reading 12 attempts`);
  /12 played your hides/.test(card.text) && /3 found you/.test(card.text)
    ? ok(`the card shows the same total the dot was about ("${card.text.trim()}")`)
    : bad(`the card and the dot disagree: ${JSON.stringify(card.text)}`);

  /* THE ONE THAT WOULD SHIP BROKEN. A flag instead of a count either latches on forever or
     never speaks again; both look fine on day one and wrong on day two. */
  (await page.evaluate(() => window.__m.check())) === false
    ? ok('a relaunch with nothing new stays quiet')
    : bad('the dot came back for results that had already been read — it is lying, and people stop tapping it');

  await page.evaluate(() => window.__m.seed(['a', 'b'],
    { a: { n_attempts: 10, n_found: 2 }, b: { n_attempts: 3, n_found: 1 } }, 12));
  (await page.evaluate(() => window.__m.check())) === true
    ? ok('one more person plays → it comes back')
    : bad('a new attempt did not raise the dot — it only ever fires once');
}

/* EACH HIDE, AND WHAT HAPPENED TO IT.
   The card could only ever say "N played · N found you" — two counters that say something
   happened, not what. found_tap and burned come back from get_hide derived from the ordered
   attempts rows, and this is where the four states are held to their wording: being found on
   the first tap and burning every tap are opposite outcomes and must never render the same
   phrase, because the whole point of the row is which one it was. */
console.log('\nEACH HIDE SAYS WHAT HAPPENED TO IT, AND OFFERS THE ONE ACTION');
{
  await page.evaluate(() => window.__m.seed(['a', 'b', 'c', 'd'], {
    a: { n_attempts: 1, n_found: 1, found_tap: 1, burned: false, name: 'tony', limit_s: 30, max_taps: 5, img_path: 'aaa.jpg' },
    b: { n_attempts: 5, n_found: 0, found_tap: null, burned: true, max_taps: 5, img_path: 'bbb.jpg' },
    c: { n_attempts: 4, n_found: 1, found_tap: 4, burned: false, img_path: 'ccc.jpg' },
    d: { n_attempts: 0, n_found: 0, found_tap: null, burned: false },
  }, null));
  await page.evaluate(() => window.__m.openCard());

  const rows = await page.evaluate(() => window.__m.expand());
  rows.length === 4
    ? ok('the summary opens into one row per hide (4)')
    : bad(`expanding gave ${rows.length} rows for 4 hides — the accordion is the feature`);
  rows.every((r) => r.send)
    ? ok('and every row carries its own send')
    : bad('a row has no send button, so a dead challenge stays dead');

  /* THE PICTURE IS THE ONLY THING THAT TELLS AN AUTHOR WHICH HIDE A ROW IS ABOUT. Asserted per
     row rather than "some img exists": the failure that matters is every row showing the same
     thumbnail, which looks fine in a screenshot and is useless on a phone. */
  const shots = rows.map((r) => r.shot);
  /\/storage\/v1\/object\/public\/hides\/aaa\.jpg$/.test(shots[0] || '')
    && /bbb\.jpg$/.test(shots[1] || '') && /ccc\.jpg$/.test(shots[2] || '')
    ? ok('each row shows its OWN hide, from the public storage URL the seeker screen uses')
    : bad(`the thumbnails are ${JSON.stringify(shots)} — a row must picture the hide it sends`);
  shots[3] === null
    ? ok('and a hide with no stored image degrades to an empty frame rather than a broken one')
    : bad(`a hide with no img_path rendered ${JSON.stringify(shots[3])}`);

  const t = rows.map((r) => r.txt);
  /first tap/.test(t[0] || '')
    ? ok(`found on tap 1 reads as the humiliation it is ("${(t[0] || '').trim()}")`)
    : bad(`a hide found on the first tap reads: ${JSON.stringify(t[0])}`);
  /burned all 5 taps/.test(t[1] || '')
    ? ok(`burning every tap reads as the trophy it is ("${(t[1] || '').trim()}")`)
    : bad(`a hide nobody found in 5 taps reads: ${JSON.stringify(t[1])}`);
  /tap 4/.test(t[2] || '')
    ? ok('a later find names the tap it happened on')
    : bad(`found on tap 4 reads: ${JSON.stringify(t[2])}`);
  /nobody has played yet/.test(t[3] || '')
    ? ok('and an unopened one still says so, rather than showing nothing')
    : bad(`an unplayed hide reads: ${JSON.stringify(t[3])}`);

  /* THE LINK IS THE WHOLE POINT OF THE ROW. These hides landed days ago, so their id is
     known and chLink cannot be empty — the race that produced ?i=1 sends cannot reach here.
     A row that shared the invite URL instead would look identical and send no game. */
  const sent = await page.evaluate(() => window.__m.send(3));
  /\?h=d(\s|$)/.test(String(sent || ''))
    ? ok('sending a row shares THAT hide, by id')
    : bad(`the row sent: ${JSON.stringify(sent)} — it must carry ?h=<that hide>`);
  !/i=1/.test(String(sent || ''))
    ? ok('and never falls through to the empty invite link')
    : bad('the row sent the ?i=1 invite — the friend opens the app and finds no game');

  /* A hide with no stored limit must not invent one: 195 of 197 published hides carry null
     limit_s and max_taps, and the seeker derives them instead. Quoting a number here would
     promise a deal the round does not honour. */
  const bare = await page.evaluate(() => window.__m.send(2));
  !/\d+ sec/.test(String(bare || ''))
    ? ok('a hide with no stored round quotes no clock')
    : bad(`the message invented a round for a hide that has none: ${JSON.stringify(bare)}`);
  const full = await page.evaluate(() => window.__m.send(0));
  /30 sec and 5 taps/.test(String(full || ''))
    ? ok('and one that has both states them exactly')
    : bad(`a hide with limit_s 30 / max_taps 5 sent: ${JSON.stringify(full)}`);
}

/* THE DOT MUST NOT MOVE THE WORDMARK IT SITS ON, and it did.
   Giving the ::after a containing block looked like it needed `position:relative` on .brand.
   It did not — .brand is already position:absolute, which IS one — and that rule came later in
   the file at equal specificity, so it won and dropped the wordmark out of absolute positioning
   entirely. Live, the mark sat at x=43 instead of x=195 and its box went from 86px to the full
   390, taking flow space at the top of the screen. It shipped, because every check in this repo
   asked about behaviour and none about where anything was. */
console.log('\nAND IT DOES NOT MOVE THE WORDMARK');
{
  const half = 195;
  for (const news of [false, true]) {
    const m = await page.evaluate((n) => window.__m.mark(n), news);
    const label = news ? 'with the dot' : 'without it';
    m.pos === 'absolute'
      ? ok(`the wordmark stays absolutely positioned ${label}`)
      : bad(`.brand computes to position:${m.pos} ${label} — something later in the file is `
          + 'overriding it, and top/left/transform stop meaning what they were written to mean');
    Math.abs(m.cx - half) <= 2
      ? ok(`and stays centred ${label} (text centre ${m.cx} of ${half * 2})`)
      : bad(`the wordmark's TEXT sits at x=${m.cx}, not ${half} ${label} — it is out of position `
          + 'on every screen it appears on');
    m.boxW < 200
      ? ok(`and hugs its own text ${label} (${m.boxW}px)`)
      : bad(`.brand is ${m.boxW}px wide ${label} — it is a full-width block in flow, so it also `
          + 'takes layout space it is not supposed to occupy');
  }
}

/* THE REVEAL SCREEN IS WHERE THE DOT MATTERS MOST, and it was the one screen the wordmark
   did not exist on — not hidden, PAINTED OVER: #revealC is inset:0 at z-index 14 and the mark
   was 12. People sit on that screen looking at their hide, and the thing telling them someone
   played was underneath the picture. */
console.log('\nAND IT IS VISIBLE ON THE REVEAL, WITHOUT EATING THE WIPE');
{
  const off = await page.evaluate(() => window.__m.reveal(false));
  off.brand < off.canvas
    ? ok(`on the camera it sits under the reveal canvas (${off.brand} < ${off.canvas}), where that canvas is hidden anyway`)
    : bad(`the wordmark is z-index ${off.brand} on the camera screen`);
  const on = await page.evaluate(() => window.__m.reveal(true));
  on.brand > on.canvas
    ? ok(`on the reveal it rises above it (${on.brand} > ${on.canvas}) instead of being painted over`)
    : bad(`the wordmark is still under the reveal canvas (${on.brand} vs ${on.canvas}) — invisible on the `
        + 'one screen where the dot most needs to be seen');
  on.pe === 'none'
    ? ok('and is inert there, so it cannot eat the start of a wipe drag')
    : bad(`it takes pointer events on the reveal (pointer-events:${on.pe}) — #revealHandle's line runs `
        + 'straight through the wordmark, so a drag started on it would be swallowed');
  await page.evaluate(() => window.__m.reveal(false));
}

await browser.close();
server.close();
console.log(failed ? `\n✗ ${failed} failure(s)` : '\n✓ the dot only ever means something new');
process.exit(failed ? 1 : 0);
