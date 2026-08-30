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
import { pwBases, chromeExe, PW_SETUP } from './lib/pw.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const req = createRequire(import.meta.url);
let chromium = null;
for (const base of pwBases(ROOT)) {
  try { ({ chromium } = req(base ? join(base, 'node_modules/playwright-core') : 'playwright-core')); break; } catch {}
}
if (!chromium) {
  console.log('· playwright-core not installed — skipping the results-dot test — run: ' + PW_SETUP);
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
  /* THE ROW'S REAL CLICK, through the handler a thumb reaches — the whole change is that the
     summary became a DOOR, and calling chFeed() directly would pass with the handler unwired.
     kfRpc is left alone deliberately: the public feed loading or failing behind the grid is
     not what this asserts, and stubbing it would hide the fact that the grid does not need it. */
  + 'async door(){document.getElementById("khScore").click();await new Promise(r=>setTimeout(r,600));'
  + 'const g=document.getElementById("kfMine");'
  + 'return{home:document.getElementById("kamoHome").classList.contains("show"),'
  + 'feed:!!document.getElementById("kfeed"),'
  + 'grid:!!g&&getComputedStyle(g).display!=="none",'
  + 'cells:document.querySelectorAll("#kfMine .kmCell").length,'
  + 'pill:(document.getElementById("kfScope")||{}).textContent||""};},'
  + 'async openCard(){await khResults();return{dot:this.dot(),'
  + 'seen:(()=>{try{return localStorage.getItem("kamo_seen_tries")}catch(e){return null}})(),'
  + 'text:(document.getElementById("khScore")||{}).textContent||"",'
  + 'shown:(document.getElementById("khScore")||{}).style.display};},'
  + 'dot(){const b=document.querySelector(".brand");return !!b&&b.classList.contains("hasNews");},'
  /* THE STATS ROW CARRIES NO BUTTON, and this reads the row to keep it that way. The sign
     nudge lived here for one day (2026-08-16 → 17) and was removed because it accused people
     who HAD chosen their name — its gate read a flag, not the person. Anything that wants
     this row again has to answer that first. */
  + 'nudge(){const b=document.querySelector("#kfMine .kmStats button");return b?b.textContent:"";},'
  /* chFeed() refuses to open twice (`if(kfState) return`), so a block that runs after another
     one has left the feed up would silently read the PREVIOUS block's grid — door() would
     return, the assertions would run, and they would be about stale DOM. */
  /* The camera door is the tab bar's since 2026-08-29; the old corner circle is gone. */
  + 'closeFeed(){const c=document.querySelector(\'#kNav [data-tab="cam"]\')||document.getElementById("kfClose");if(c)c.click();},'
  /* THE BOX'S CLICK LEAVES THE CARD NOW (2026-08-15) — it opens the My-kamos grid, so a real
     click here would destroy the list this block is about to read. What survives in place is
     the khOpenNext path, which is the one a "somebody found your hide" notification takes
     (window.KAMO.openFound); it is set and consumed by khResults() exactly as below. The rows
     it renders are the same rows, from the same renderer. */
  + 'async expand(){khOpenNext=true;await khResults();const e=document.getElementById("khScore");'
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
const exe = chromeExe();
if (!exe) { console.log('· no Chrome or Chromium found — skipping (set PW_CHROME=<path>)'); server.close(); process.exit(0); }
const browser = await chromium.launch({ executablePath: exe });
const page = await browser.newPage({ locale: 'en-US', viewport: { width: 390, height: 844 } });
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
  /* THE ROW IS A DOOR, NOT A SUMMARY, since 2026-08-15 — the two numbers the dot was raised
     about are chips at the top of the grid it opens. What the card still has to get right is
     that the row EXISTS for somebody with results to read, and that it counts the hides that
     resolved (three ids seeded, one of them expired). Both halves of the dot's meaning are
     still asserted above: it goes out, and `kamo_seen_tries` remembers the 12 it was about. */
  /My kamos \(2\)/.test(card.text)
    ? ok(`the card offers the hides the dot was about ("${card.text.trim()}")`)
    : bad(`the row that should open the grid reads: ${JSON.stringify(card.text)}`);

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
/* THE ROW IS A DOOR NOW, AND A DOOR THAT OPENS ONTO NOTHING IS WORSE THAN A CLOSED ONE.
   It used to expand ten rows in place, inside a card anchored to the bottom edge — a fight
   over vertical room this file has already lost twice (the badge and the name went off the
   top of the screen, and the fix was to make the box its own scroll container). The grid is
   the same data with a screen to render it on.
   THE HANDOFF IS THE FRAGILE PART. Three things have to happen in order and none of them is
   visible in a diff: the card closes, the feed opens, and the feed lands on MY KAMOS rather
   than on strangers' photos. Miss the last one and the row answering "what happened to mine"
   delivers somebody else's hides. */
console.log('\nTHE SUMMARY IS A DOOR ONTO YOUR OWN GRID');
{
  await page.evaluate(() => window.__m.seed(['a', 'b'],
    { a: { n_attempts: 4, n_found: 1, img_path: 'aaa.jpg' }, b: { n_attempts: 2, n_found: 0, img_path: 'bbb.jpg' } }, null));
  await page.evaluate(() => window.__m.openCard());
  const d = await page.evaluate(() => window.__m.door());
  !d.home ? ok('the card closes behind you') : bad('#kamoHome is still open under the feed — two dismissals to get back');
  d.feed ? ok('the feed opens') : bad('no #kfeed after tapping the summary');
  d.grid && /My kamos/.test(d.pill)
    ? ok(`and it lands on your own grid, not on strangers' photos ("${d.pill.trim()}")`)
    : bad(`the feed opened on ${JSON.stringify(d.pill.trim())} with the grid ${d.grid ? 'shown' : 'hidden'} — `
        + 'the row asks "what happened to mine" and answers with everybody else');
  d.cells === 2
    ? ok('with one cell per hide (2)')
    : bad(`the grid drew ${d.cells} cells for 2 hides`);
  await page.evaluate(() => { const f = document.getElementById('kfeed'); if (f) f.remove(); });
}

console.log('\nEACH HIDE SAYS WHAT HAPPENED TO IT, AND OFFERS THE ONE ACTION');
{
  await page.evaluate(() => window.__m.seed(['a', 'b', 'c', 'd', 'e'], {
    /* best_ms is the hide's own record — the fastest anybody has ever found this photo. Only
       `a` carries one, so the same seed proves both halves of the rule: the row that HAS a
       record says it, and the rows that do not stay silent instead of printing a zero. */
    a: { n_attempts: 1, n_found: 1, found_tap: 1, burned: false, name: 'tony', limit_s: 30, max_taps: 5, img_path: 'aaa.jpg', best_ms: 4100 },
    b: { n_attempts: 5, n_found: 0, found_tap: null, burned: true, max_taps: 5, img_path: 'bbb.jpg' },
    c: { n_attempts: 4, n_found: 1, found_tap: 4, burned: false, img_path: 'ccc.jpg' },
    d: { n_attempts: 0, n_found: 0, found_tap: null, burned: false },
    /* UNBEATEN AND NOT YET BURNED — four people have tried this photo and none of them found
       the kamo, but the taps have not run out. `b` above is the same news one rung higher and
       keeps its own stronger line; this is the case that used to read "4 tried · nobody found
       you", a report with a shrug in it, on the ~65 hides a day that qualify. */
    e: { n_attempts: 4, n_found: 0, found_tap: null, burned: false, img_path: 'eee.jpg' },
  }, null));
  await page.evaluate(() => window.__m.openCard());

  const rows = await page.evaluate(() => window.__m.expand());
  rows.length === 5
    ? ok('the summary opens into one row per hide (5)')
    : bad(`expanding gave ${rows.length} rows for 5 hides — the accordion is the feature`);
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
  /* Matched on "played yet", not on the whole sentence. The invariant defended here is that an
     unopened hide SAYS so rather than rendering blank; the exact prose was never the guarantee,
     and pinning it turned a copy edit into a failure. The row shortened to "not played yet"
     when the list grew to ten — the summary above still carries the full sentence, and
     repeating it down every row had made it wallpaper. */
  /played yet/.test(t[3] || '')
    ? ok('and an unopened one still says so, rather than showing nothing')
    : bad(`an unplayed hide reads: ${JSON.stringify(t[3])}`);

  /* THE HIDE'S OWN RECORD, WHERE THERE IS ONE. Every other number on this card is a tally —
     how many played, how many won — and a tally is a fact about a crowd. The fastest find is a
     performance, which is the only kind of number somebody repeats out loud. */
  /fastest 4\.1s/.test(t[0] || '')
    ? ok(`a hide that has been beaten names the time to beat ("${(t[0] || '').trim()}")`)
    : bad(`a hide with best_ms 4100 reads: ${JSON.stringify(t[0])}`);
  /* AND NOWHERE ELSE. `b` burned all five taps: nobody found it, so there is no record, and
     best_ms comes back NULL rather than 0 — printing "fastest 0.0s" on the 44% of played
     hides nobody has cracked would be the one number on this surface that is a lie. */
  !/fastest/.test(t[1] || '') && !/fastest/.test(t[2] || '') && !/fastest/.test(t[3] || '')
    ? ok('and a hide with no record quotes none, rather than a 0.0s')
    : bad(`a recordless row leaked a time: ${JSON.stringify([t[1], t[2], t[3]])}`);

  /* A HIDE NOBODY HAS CRACKED READS AS THE WIN IT IS. The count and the outcome were both
     already on this row; what changes is which of them the sentence is ABOUT. "4 tried ·
     nobody found you" makes the subject the people who tried and the verdict the creator's
     failure to be found — on a card whose every other line reports what was done TO them.
     At three attempts and none found, the true reading is the opposite one. */
  /unbeaten/.test(t[4] || '') && /4 have tried/.test(t[4] || '')
    ? ok(`an uncracked hide reads as a flex ("${(t[4] || '').trim()}")`)
    : bad(`4 tried and none found reads: ${JSON.stringify(t[4])}`);
  /* AND BURNED KEEPS ITS OWN LINE, above this one. It is the stronger claim — nobody found it
     AND the taps ran out — and folding it into the weaker one would lose that. Asserted
     because the new branch sits directly under it and a misordered pair is invisible: both
     sentences are true of `b`, and only one of them is the best thing to say. */
  /burned all 5 taps/.test(t[1] || '') && !/unbeaten/.test(t[1] || '')
    ? ok('and the burned hide keeps the stronger sentence rather than being demoted to it')
    : bad(`the burned row now reads: ${JSON.stringify(t[1])}`);

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

  /* NO ROUND IS QUOTED ANY MORE, AND THAT IS THE PRODUCT, NOT A REGRESSION.
     This block used to require the opposite — a hide carrying limit_s 30 / max_taps 5 had to
     say "30 sec and 5 taps" — and it is why this suite sat quarantined. The settings are
     retired: the seeker plays ONE buzz on no clock regardless of what an old row stores, so
     quoting those numbers would promise a deal the round does not honour. 195 of 197
     published hides carry null for both, and the two that do not are older than the change.
     So the assertion inverts. Neither shape may quote a clock or a tap count, and BOTH must
     state the deal the seeker actually gets. Checked on the row that stores nothing and on
     the row that stores both, because it is the stored one that would leak the dead
     settings back into the message. */
  const bare = await page.evaluate(() => window.__m.send(2));
  const full = await page.evaluate(() => window.__m.send(0));
  for (const [label, msg] of [['a hide with no stored round', bare], ['one storing limit_s 30 / max_taps 5', full]]) {
    !/\d+\s*sec|\d+\s*taps/.test(String(msg || ''))
      ? ok(`${label} quotes no clock and no tap count`)
      : bad(`${label} leaked the retired settings: ${JSON.stringify(msg)}`);
  }
  /One tap to find it/.test(String(full || ''))
    ? ok('and both state the one-buzz deal the seeker is actually offered')
    : bad(`the resend does not state the deal: ${JSON.stringify(full)}`);

  /* AND THE MESSAGE CARRIES THE RECORD OUT WITH IT. This is the difference between an
     invitation and a scoreboard somebody is already on, and it is the only thing a re-send
     has that a stranger's first send does not.
     THE RULE IT DOES NOT BREAK: the block above forbids quoting the round's TERMS, because a
     term is a promise about how the round will run and the retired ones promise a deal that
     no longer exists. These are a REPORT of what other people already did — it cannot come
     untrue, and the recipient cannot be short-changed on it. Both assertions run on the same
     string, which is the point. */
  /1 of 1 have found it/.test(String(full || '')) && /fastest 4\.1s/.test(String(full || ''))
    ? ok('a re-send of a beaten hide reports who beat it and how fast')
    : bad(`the re-send of a hide with a record reads: ${JSON.stringify(full)}`);
  /* `bare` is hide `c`: found on tap 4, but no best_ms on the row. Found without a record is
     the case that would print "— fastest ." with an empty time if the two were not tested
     together. */
  !/fastest/.test(String(bare || ''))
    ? ok('and one with no record falls back to the plain invitation')
    : bad(`a recordless re-send quoted a time: ${JSON.stringify(bare)}`);

  /* AND THE UNBEATEN ONE GOES OUT AS A DARE, which is the whole reason the badge is worth
     having: a flex nobody can send is a private satisfaction. The measured leak this aims at
     is 300-600 publishes a day against 200-300 sends — "nobody has found it" names something
     for the recipient to beat instead of a favour to do the sender. */
  const dare = await page.evaluate(() => window.__m.send(4));
  /4 have tried/.test(String(dare || '')) && /[Nn]obody has found it/.test(String(dare || ''))
    ? ok('re-sending an uncracked hide sends the challenge, not an invitation')
    : bad(`the re-send of an unbeaten hide reads: ${JSON.stringify(dare)}`);
  /* It is still a KAMO message and still states the deal — the dare replaces the boast, not
     the instruction the recipient needs. */
  /One tap to find it/.test(String(dare || '')) && /\?h=e(\s|$)/.test(String(dare || ''))
    ? ok('and still names the deal and carries that hide by id')
    : bad(`the dare lost the deal or the link: ${JSON.stringify(dare)}`);
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

console.log('\nTHE GRID SELLS NOTHING ON TOP OF THE STATS ROW');
{
  /* THE NUDGE IS GONE, AND THIS IS THE GUARD ON ITS ABSENCE. It shipped 2026-08-16 gated on
     `!handleChosen()` and was pulled the next day: that flag is written by one card only, so
     every device that named itself by any other path — or before the flag existed — reads as
     anonymous for ever and got told "make it your name" under a name it had typed. Both cases
     below are people with plays on their own grid; neither may be asked for anything.
     A FRESH PAGE PER CASE, and that is not tidiness. This suite shares one page across every
     block, and by here the feed has been opened, the card closed and #khScore rebound several
     times — a door() on that page silently no-ops and the assertion reads a stale grid, which
     is exactly what the first draft of this block did. The handle is planted before boot, so
     each case is one clean launch with one state. */
  const state = async (handle, chosen) => {
    const p2 = await browser.newPage({ locale: 'en-US', viewport: { width: 390, height: 844 } });
    await p2.addInitScript((a) => {
      localStorage.setItem('kamo_handle', a.handle);
      if (a.chosen) localStorage.setItem('kamo_handle_chosen', '1');
      else localStorage.removeItem('kamo_handle_chosen');
    }, { handle, chosen });
    await p2.goto(url, { waitUntil: 'load' });
    await p2.waitForTimeout(800);
    await p2.evaluate(() => window.__m.seed(['a', 'b'],
      { a: { n_attempts: 4, n_found: 1, img_path: 'aaa.jpg' }, b: { n_attempts: 2, n_found: 0, img_path: 'bbb.jpg' } }, null));
    await p2.evaluate(() => window.__m.openCard());
    await p2.evaluate(() => window.__m.door());
    const out = await p2.evaluate(() => window.__m.nudge());
    await p2.close();
    return out;
  };

  const assigned = await state('MossyOwl', false);
  assigned === ''
    ? ok('a grid signed with a generated name is left alone')
    : bad(`something is being sold on the stats row: ${JSON.stringify(assigned)}`);

  const chosen = await state('tony', true);
  chosen === ''
    ? ok('and so is one signed with a name its owner typed')
    : bad(`the stats row nags a user who chose their name: ${JSON.stringify(chosen)}`);
}

await browser.close();
server.close();
console.log(failed ? `\n✗ ${failed} failure(s)` : '\n✓ the dot only ever means something new');
process.exit(failed ? 1 : 0);
