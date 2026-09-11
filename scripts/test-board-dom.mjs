#!/usr/bin/env node
/**
 * THE PODIUM ON THE ENDING CARD, AND THE FOUR WAYS IT FAILS WITHOUT LOOKING BROKEN.
 *
 * 1. THE SEEKER NEVER REACHES THE ROW. The whole feature rests on submit_attempt carrying
 *    p_device and p_who — the 7-argument overload. If a refactor drops either key, every
 *    board is a list of "Someone"s and the creator's grid never learns a name, and nothing on
 *    an en-US screen changes. Asserted on the ARGUMENTS of the first submit_attempt call.
 *
 * 2. A HANDLE IS A STRANGER'S STRING. Every row prints a name typed on somebody else's device,
 *    into a card that is otherwise built by innerHTML. Served as markup, required as text —
 *    the same assertion the challenges grid and the seeker headline carry.
 *
 * 3. A BOARD OF ONE IS A MIRROR. The card must print nothing when the only row is the
 *    reader's own — "First one in." is the sentence for that, and it is already there.
 *    And anonymous players are never LISTED: the first shipped version printed six lines of
 *    "Someone" over a stranger's photo (founder, 2026-09-11: "Très moche"). They are counted
 *    in the summary line, and the chip row only exists when somebody on it has a name.
 *
 * 4. THE NAME FIELD IS THE DELIVERY. A seeker with no handle gets the field, and submitting it
 *    must do three things at once: write kamo_handle through setHandle (the one writer), stamp
 *    the row through sign_attempt, and turn "you" into "@name" on the board. A seeker WITH a
 *    handle must never be asked.
 *
 * And the rally: hide_board's `root` must land in kamo_threads on a link round, so the
 * Challenges panel can ask thread_hides about it later.
 *
 *   PW_CORE=<dir with node_modules> node scripts/test-board-dom.mjs
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
if (!chromium) { console.log('· playwright-core not installed — skipping the board test — run: ' + PW_SETUP); process.exit(0); }

const real = readFileSync(join(ROOT, 'index.html'), 'utf8');
/* Both RPC doors, stubbed at their declarations: the round fetches the hide on load and the
   board is fetched off the ending, both long before anything appended to the module runs.
   Every call is recorded — case 1 asserts on submit_attempt's arguments. */
const stub = (src, anchor) => {
  if (!src.includes(anchor)) throw new Error('anchor missing: ' + anchor);
  return src.replace(anchor, anchor +
    '(window.__calls=window.__calls||[]).push([fn,body]);' +
    'if(window.__seed&&Object.prototype.hasOwnProperty.call(window.__seed,fn)) return window.__seed[fn];');
};
let html = stub(real, 'async function chRpc(fn,body){');
html = stub(html, 'async function chRpcRows(fn,body){');
html = html.replace('function track(event,props){',
  'function track(event,props){window.__tr=window.__tr||[];window.__tr.push([event,props]);');

const MIME = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.css': 'text/css' };
const server = createServer((rq, rs) => {
  const p = decodeURIComponent(rq.url.split('?')[0]);
  if (p === '/' || p === '/index.html') { rs.writeHead(200, { 'Content-Type': 'text/html' }); return rs.end(html); }
  try {
    const b = readFileSync(join(ROOT, p.replace(/^\/+/, '')));
    rs.writeHead(200, { 'Content-Type': MIME[p.slice(p.lastIndexOf('.'))] || 'application/octet-stream' });
    rs.end(b);
  } catch { rs.writeHead(404); rs.end('x'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

const exe = chromeExe();
if (!exe) { console.log('· no Chrome or Chromium found — skipping (set PW_CHROME=<path>)'); server.close(); process.exit(0); }
const browser = await chromium.launch({ executablePath: exe });
let failed = 0;
const ok = m => console.log('  ✓ ' + m);
const bad = m => { failed++; console.error('  ✗ ' + m); };

/* One transparent pixel: the round refuses to buzz on a photo that never loaded. */
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const servePhoto = (page) => page.route('**/storage/v1/object/public/hides/**', r => r.fulfill({ status: 200, contentType: 'image/png', body: PIXEL }));

const HIDE = { img_path: 'x.jpg', secs: 9, n_attempts: 2, n_found: 1, limit_s: null, max_taps: null, name: 'tony' };
const WIN = { hit: true, tries: 3, missed: 1, secs: 9, pct: 50, others: 2, scope: 'hide' };
/* The first name is deliberately markup — see 2 above. */
const BOARD = [
  { root: 'abc123', n_players: 3, my_pos: 2, pos: 1, name: '<b>evil</b>', hit: true, ms: 3200, me: false },
  { root: 'abc123', n_players: 3, my_pos: 2, pos: 2, name: null, hit: true, ms: 4000, me: true },
  { root: 'abc123', n_players: 3, my_pos: 2, pos: 3, name: 'tom', hit: false, ms: 2100, me: false },
];
const SOLO = [{ root: 'abc123', n_players: 1, my_pos: 1, pos: 1, name: null, hit: true, ms: 4000, me: true }];

async function round({ board, handle } = {}) {
  const page = await browser.newPage({ locale: 'en-US', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await servePhoto(page);
  await page.addInitScript((a) => {
    if (a.handle) localStorage.setItem('kamo_handle', a.handle);
    window.__seed = { get_hide: a.hide, submit_attempt: a.win, hide_board: a.board,
                      sign_attempt: null, reveal_hide: null, save_seek_trace: null };
  }, { hide: HIDE, win: WIN, board: board || BOARD, handle: handle || '' });
  await page.goto(base + '?h=abc123', { waitUntil: 'load' });
  await page.waitForTimeout(900);
  const live = await page.evaluate(() => {
    const stage = document.getElementById('chStage');
    const img = document.querySelector('.chFrame img');
    if (!stage || !img) return false;
    img.style.width = '300px'; img.style.height = '500px';
    const r = img.getBoundingClientRect();
    const x = r.left + r.width * 0.5, y = r.top + r.height * 0.62;
    const ev = (t) => stage.dispatchEvent(new PointerEvent(t, { bubbles: true, pointerId: 1, pointerType: 'touch', clientX: x, clientY: y }));
    ev('pointerdown'); ev('pointerup');
    return true;
  });
  await page.waitForTimeout(1200);
  return { page, live };
}

const read = (page) => page.evaluate(() => {
  const box = document.querySelector('#chFoot .chCard .chBoard');
  const rows = box ? [...box.querySelectorAll('.chBChip')] : [];
  return {
    board: !!box,
    /* The chip's own <b> is the name's element; a <b> INSIDE it would be served markup. */
    bold: !!(box && box.querySelector('.chBChip b b, .chBSum b')),
    rows: rows.map(r => ({ me: r.classList.contains('me'), who: r.querySelector('b').textContent, ms: r.querySelector('span').textContent })),
    sum: box && box.querySelector('.chBSum') ? box.querySelector('.chBSum').textContent : null,
    sign: !!(box && box.querySelector('.chBSign')),
    ask: !!(box && box.querySelector('.chBName')),
    submit: (window.__calls || []).find(c => c[0] === 'submit_attempt'),
    signs: (window.__calls || []).filter(c => c[0] === 'sign_attempt'),
    handle: localStorage.getItem('kamo_handle'),
    threads: localStorage.getItem('kamo_threads'),
  };
});

console.log('\nTHE SEEKER RIDES THE ATTEMPT');
{
  const { page, live } = await round();
  live ? ok('a live round mounted and the buzz was dispatched') : bad('no live round — the fixture is not driving the seeker');
  const s = await read(page);
  s.submit && s.submit[1] && typeof s.submit[1].p_device === 'string' && s.submit[1].p_device.length > 0 && Object.prototype.hasOwnProperty.call(s.submit[1], 'p_who')
    ? ok('submit_attempt carries p_device and p_who — the 7-argument form, first')
    : bad('submit_attempt went out without the seeker on it: ' + JSON.stringify(s.submit && s.submit[1]));

  console.log('\nTHE PODIUM PRINTS STRANGERS AS TEXT');
  s.board ? ok('a board of three lands on the ending card') : bad('no .chBoard on the card');
  s.rows.length === 3 ? ok('three chips, one per named player and the reader') : bad(`expected 3 chips, got ${s.rows.length}`);
  /* Narrowed to [A-Za-z0-9_.] on the way in, exactly as the server narrows it, so the markup
     is not even text here: it is gone. What must never happen is a <b> in the card. */
  !s.bold && s.rows.some(r => r.who === '@bevilb')
    ? ok('the handle is narrowed and set as text — the served <b> never becomes an element')
    : bad(`the served <b> name rendered as ${s.bold ? 'MARKUP' : JSON.stringify(s.rows.map(r => r.who))}`);
  const me = s.rows.find(r => r.me);
  me && me.who === 'you' && me.ms === '4.0s'
    ? ok('the reader\'s own row says "you" and carries their time')
    : bad(`the me row reads ${JSON.stringify(me)}`);
  s.rows[2] && s.rows[2].ms === '✗' ? ok('a miss prints a cross, not a time') : bad(`the miss row reads ${JSON.stringify(s.rows[2])}`);
  s.sum === '#2 of 3 on this photo' ? ok('the summary names the rank and the field') : bad(`summary was ${JSON.stringify(s.sum)}`);
  s.threads && JSON.parse(s.threads)[0] === 'abc123'
    ? ok('the rally\'s root is remembered for the Challenges panel')
    : bad(`kamo_threads is ${JSON.stringify(s.threads)}`);

  console.log('\nTHE NAME FIELD IS THE DELIVERY');
  s.ask && !s.sign ? ok('a seeker with no handle is offered a link, not a form') : bad(`nameless seeker: link ${s.ask}, form ${s.sign}`);
  await page.evaluate(() => document.querySelector('#chFoot .chBName').click());
  await page.waitForTimeout(150);
  const opened = await read(page);
  opened.sign && !opened.ask ? ok('the tap opens the field in place') : bad(`after the tap: form ${opened.sign}, link ${opened.ask}`);
  await page.evaluate(() => {
    const f = document.querySelector('#chFoot .chBSign');
    f.querySelector('input').value = ' @marie! ';
    f.requestSubmit ? f.requestSubmit() : f.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(300);
  const t = await read(page);
  t.handle === 'marie' ? ok('the name is written through setHandle, cleaned (" @marie! " → marie)') : bad(`kamo_handle is ${JSON.stringify(t.handle)}`);
  t.signs.length === 1 && t.signs[0][1].p_who === 'marie' && t.signs[0][1].p_id === 'abc123' && t.signs[0][1].p_device
    ? ok('sign_attempt stamps the row already filed, keyed on hide + device')
    : bad(`sign_attempt calls: ${JSON.stringify(t.signs)}`);
  const me2 = t.rows.find(r => r.me);
  me2 && me2.who === '@marie' && !t.sign
    ? ok('"you" becomes @marie on the board and the field goes away')
    : bad(`after signing the me row reads ${JSON.stringify(me2)}, field ${t.sign ? 'still there' : 'gone'}`);
  await page.close();
}

console.log('\nA BOARD OF ONE IS A MIRROR');
{
  const { page } = await round({ board: SOLO });
  const s = await read(page);
  !s.board ? ok('a round nobody else has played prints no podium') : bad('a solo board was printed');
  await page.close();
}

console.log('\nANONYMOUS PLAYERS ARE COUNTED, NEVER LISTED');
{
  const ANON = [
    { root: 'abc123', n_players: 11, my_pos: 7, pos: 1, name: null, hit: true, ms: 700, me: false },
    { root: 'abc123', n_players: 11, my_pos: 7, pos: 2, name: null, hit: true, ms: 1100, me: false },
    { root: 'abc123', n_players: 11, my_pos: 7, pos: 7, name: null, hit: true, ms: 2400, me: true },
  ];
  const { page } = await round({ board: ANON, handle: 'tony' });
  const s = await read(page);
  s.board && s.rows.length === 0 ? ok('no chip row when nobody on it has a name') : bad(`chips: ${JSON.stringify(s.rows)}`);
  s.sum === '#7 of 11 on this photo' ? ok('the sentence carries the whole board') : bad(`summary was ${JSON.stringify(s.sum)}`);
  await page.close();
}

console.log('\nA NAMED SEEKER IS NOT ASKED');
{
  const { page } = await round({ handle: 'tony' });
  const s = await read(page);
  s.submit && s.submit[1] && s.submit[1].p_who === 'tony' ? ok('the existing handle rides the attempt') : bad(`p_who was ${JSON.stringify(s.submit && s.submit[1] && s.submit[1].p_who)}`);
  s.board && !s.sign && !s.ask ? ok('the board shows and the name offer does not') : bad(`board ${s.board}, field ${s.sign}, link ${s.ask}`);
  await page.close();
}

await browser.close();
server.close();
console.log(failed ? `\n✗ ${failed} problem(s)` : '\n✓ the podium behaves');
process.exit(failed ? 1 : 0);
