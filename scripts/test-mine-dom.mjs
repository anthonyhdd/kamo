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
  + 'dot(){const b=document.querySelector(".brand");return !!b&&b.classList.contains("hasNews");}};\n'
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

await browser.close();
server.close();
console.log(failed ? `\n✗ ${failed} failure(s)` : '\n✓ the dot only ever means something new');
process.exit(failed ? 1 : 0);
