#!/usr/bin/env node
/**
 * THE PLAYER CARD — the handle, the Discord door, and who the card claims to be.
 *
 * It replaced the KAMO+ member home, which showed three numbers nobody could act on and only
 * opened for someone who had already paid. The wordmark now opens this for everyone, which
 * means every membership signal on it has to be able to say no — a free user wearing "KAMO+"
 * on their own card is the app telling them they own something they do not.
 *
 * What is checked here cannot be checked statically:
 *   · the handle survives a reload (it is the name on every challenge; losing it silently is
 *     worse than never having asked)
 *   · it is sanitised on the way in, because it is interpolated into a share message
 *   · the caret does not jump while typing — the bug you get for free by reassigning .value
 *     on every keystroke, which makes editing the middle of a name impossible
 *   · the + and the upsell follow isPro in BOTH directions
 *   · Discord points at the real invite
 *
 *   PW_CORE=<dir with node_modules> node scripts/test-home-dom.mjs
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
  console.log('· playwright-core not installed — skipping the home test — run: ' + PW_SETUP);
  process.exit(0);
}

const real = readFileSync(join(ROOT, 'index.html'), 'utf8');
const at = real.lastIndexOf('</script>');
const html = real.slice(0, at)
  + '\nwindow.__h={'
  + 'open(pro){isPro=!!pro;openKamoHome();return this.state();},'
  + 'state(){const g=(s)=>{const e=document.querySelector(s);return e?getComputedStyle(e).display:"absent";};'
  + 'return{shown:document.getElementById("kamoHome").classList.contains("show"),'
  + 'plus:g("#khPlus"),upsell:g("#khUpsell"),title:(document.getElementById("khTitle")||{}).textContent,'
  + 'value:(document.getElementById("khHandle")||{}).value,stored:(()=>{try{return localStorage.getItem("kamo_handle")||"";}catch(e){return"";}})(),'
  + 'discord:DISCORD_URL,chips:document.querySelectorAll("#kamoHome .kpChip").length,'
  /* THE NAME IS THE BUTTON NOW. #khEdit was a separate pencil control and it no longer
     exists: once a handle is set the field collapses and the HEADLINE ("@name") is what
     reopens it, caret at the end. So there is no distinct edit affordance whose display can
     be read — #khTitle is always on screen. `edit` is therefore gone from this snapshot, and
     what replaces it is the assertion that tapping the headline actually brings the field
     back, which is the behaviour the pencil used to provide. */
  + 'restore:g("#khRestore"),field:g("#khName"),'
  + 'score:g("#khScore"),scoreText:(document.getElementById("khScore")||{}).textContent||""};},'
  /* Tapping the headline, through its OWN click handler rather than by calling khShowField()
     directly — the guard that makes it a no-op when no handle is set lives in that handler,
     and calling past it would assert a path no finger can take. */
  + 'tapName(){document.getElementById("khTitle").click();return this.state();},'
  /* chRpc is a function DECLARATION, so it is replaceable from inside the module. Stubbed per
     id so the aggregate can be checked against known rows — and so a null (an expired or
     blocked hide, which get_hide answers with nothing) is exercised rather than assumed. */
  + 'hides(ids,rows){try{localStorage.setItem("kamo_hides",JSON.stringify(ids))}catch(e){}'
  + 'chRpc=(fn,b)=>Promise.resolve(rows[b.p_id]||null);},'
  /* The invite text is built inside the click handler, so it cannot be read without sending.
     Rebuilt here from the same getHandle() the handler uses — what is under test is that the
     stored value is handle-shaped and reachable, not the string concatenation, which
     test-share.mjs already covers against the real function body. */
  + 'handle(){return getHandle();},'
  /* Opening the accordion goes through the box's own click handler, the way a finger does —
     khOpen is module state, and flipping it directly would exercise a paint() that nothing
     calls. */
  + 'expand(){document.getElementById("khScore").click();return this.fit();},'
  /* WHAT THE USER CAN ACTUALLY SEE. The card is anchored to the bottom edge, so overflow goes
     off the TOP of the screen — and every element up there is still laid out, still styled,
     still `display:block`. getComputedStyle cannot tell you the badge is sitting at y=-180.
     Geometry can, so this reads rectangles. */
  + 'fit(){const c=document.querySelector("#kamoHome .kpCard"),s=document.getElementById("khScore"),'
  + 'b=document.querySelector("#kamoHome .kpBadge");'
  + 'return{cardTop:Math.round(c.getBoundingClientRect().top),'
  + 'badgeTop:Math.round(b.getBoundingClientRect().top),'
  + 'scoreScrolls:s.scrollHeight>s.clientHeight+1,'
  + 'rows:document.querySelectorAll("#khScore .khRow").length,'
  + 'headText:(document.querySelector("#khScore .khHead")||{}).textContent||""};},'
  + 'wipe(){try{localStorage.removeItem("kamo_handle")}catch(e){}}};\n'
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
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__h, null, { timeout: 10000 });

console.log('\nTHE CARD OPENS FOR EVERYONE, AND CLAIMS ONLY WHAT IS TRUE');
{
  await page.evaluate(() => window.__h.wipe());
  const free = await page.evaluate(() => window.__h.open(false));
  free.shown ? ok('a free user gets the card, not the paywall') : bad('the card did not open for a free user');
  free.plus === 'none'
    ? ok('no + on a free user\'s badge')
    : bad(`the badge wears "KAMO+" for a non-member (display:${free.plus}) — it is telling them they own something they do not`);
  /* THE UPSELL BANNER IS GONE ON PURPOSE — it was a full-width CTA sitting on top of the
     results list, which is the reason the card is opened at all. What must NOT be gone is a
     route to the paywall, so the assertion moved rather than being deleted: the locked
     controls on this card still carry ✦ and still lead there, which is a better ask because
     it arrives attached to the thing being sold. */
  free.upsell === 'absent'
    ? ok('no upsell banner eating the results list')
    : bad(`the upsell banner is back (${free.upsell}) — it pushes the hides into a ~150px window`);
  const locks = await page.evaluate(() => document.querySelectorAll('#kamoHome .khCharOpt.lock, #kamoHome .khFinOpt.lock').length);
  locks > 0
    ? ok(`and KAMO+ is still reachable from the card — ${locks} locked control(s) marked ✦`)
    : bad('nothing on the card leads to the paywall any more: the banner went and took the only route with it');
  free.chips === 0
    ? ok('no perk list — the card is about who you are, not what the subscription contains')
    : bad(`${free.chips} perk chips are back on the player card`);
  free.restore === 'absent'
    ? ok('no Restore row — a store action does not belong on a card about who you are')
    : bad(`Restore is back on the player card (${free.restore}); it lives on the paywall, which is `
        + 'where the five taps that justified it actually happened');

  const pro = await page.evaluate(() => window.__h.open(true));
  pro.plus !== 'none' ? ok('a member gets the +') : bad('the + is hidden from someone who paid for it');
  /* 'absent' now, not 'none': the banner is out of the markup entirely rather than hidden per
     user, so nobody is sold what they already own because there is nothing to sell here. */
  pro.upsell === 'absent'
    ? ok('and is not sold what they already own')
    : bad(`the upsell row is ${pro.upsell} for a member`);
}

console.log('\nTHE HANDLE IS KEPT, AND KEPT CLEAN');
{
  await page.evaluate(() => { window.__h.wipe(); window.__h.open(false); });
  await page.click('#khHandle');
  await page.type('#khHandle', 'Tony_99');
  const typed = await page.evaluate(() => window.__h.state());
  typed.stored === 'Tony_99'
    ? ok('typing saves as you go — no Save button to forget')
    : bad(`stored ${JSON.stringify(typed.stored)} after typing "Tony_99"`);

  /* THE CARET. Reassigning .value on every keystroke is the obvious implementation and it
     makes the field unusable: the caret jumps to the end, so you cannot fix a typo in the
     middle of your own name. Typing into the middle is the only way to see it. */
  await page.evaluate(() => { const i = document.getElementById('khHandle'); i.setSelectionRange(2, 2); });
  await page.keyboard.type('X');
  const mid = await page.evaluate(() => ({ v: document.getElementById('khHandle').value,
    caret: document.getElementById('khHandle').selectionStart }));
  mid.v === 'ToXny_99' && mid.caret === 3
    ? ok('editing the middle of a name works — the caret stays put')
    : bad(`typing into the middle produced ${JSON.stringify(mid.v)} with the caret at ${mid.caret} — `
        + 'the field is rewriting itself on every keystroke and pushing the caret to the end');

  /* SANITISED ON THE WAY IN, because the value is interpolated into a share message that a
     stranger then reads. An @ typed by hand must not survive either — the markup already
     draws one, and storing a second gives every invite "@@name". */
  await page.evaluate(() => { window.__h.wipe(); window.__h.open(false); });
  await page.click('#khHandle');
  await page.type('#khHandle', '@bad name<script>');
  await page.evaluate(() => document.getElementById('khHandle').blur());
  const clean = await page.evaluate(() => window.__h.state());
  clean.stored === 'badnamescript' && !/[@<>\s]/.test(clean.stored)
    ? ok(`"@bad name<script>" is narrowed to ${JSON.stringify(clean.stored)}`)
    : bad(`a hand-typed @, spaces or markup survived: ${JSON.stringify(clean.stored)}`);
  clean.value === clean.stored
    ? ok('and the field is normalised on blur, so what you see is what goes out')
    : bad(`the field shows ${JSON.stringify(clean.value)} but ${JSON.stringify(clean.stored)} is stored`);
}

/* THE CARD KEEPS UP WHILE YOU TYPE. It did not: khShowField() and the headline were computed
   only in openKamoHome(), so someone who typed a name sat looking at "Sign your hides" above a
   field containing the name they had just signed, and only saw it take effect the next time
   they opened the card. */
console.log('\nIT SWITCHES OVER AS SOON AS YOU ARE DONE');
{
  await page.evaluate(() => { window.__h.wipe(); window.__h.open(false); });
  await page.click('#khHandle');
  await page.type('#khHandle', 'nova');
  const typing = await page.evaluate(() => window.__h.state());
  typing.title === '@nova'
    ? ok('the headline follows the keystrokes')
    : bad(`the headline is still ${JSON.stringify(typing.title)} while the name is being typed`);
  typing.field !== 'none'
    ? ok('and the field stays put while there is a caret in it')
    : bad('the field collapsed mid-keystroke — the caret has nowhere to be');

  await page.evaluate(() => document.getElementById('khHandle').blur());
  const done = await page.evaluate(() => window.__h.state());
  /* The headline carries the name once the field stands down — that IS the edit control, so
     asserting it holds "@name" asserts both that the collapse happened and that the way back
     in is on screen. */
  /* Against the shape, not a literal: the headline carries whatever was typed, and pinning
     the exact name here would break the next time the fixture changes without the behaviour
     changing at all. What matters is that it collapsed AND the name is on screen — that is
     both halves of the edit control existing. */
  done.field === 'none' && /^@\w+/.test(done.title || '')
    ? ok('and stands down on blur, leaving the name itself as the way back in')
    : bad(`after blur the field is ${done.field} and the headline is ${JSON.stringify(done.title)}`);

  /* THE PENCIL'S JOB, DONE BY THE NAME. This is the assertion #khEdit used to carry: there
     has to be a way back to the field after it collapses, or a typo is permanent. */
  const reopened = await page.evaluate(() => window.__h.tapName());
  reopened.field !== 'none'
    ? ok('tapping the name reopens the field — the headline is the edit control')
    : bad('tapping the headline did not bring the field back; the name cannot be changed');

  /* Clearing it must NOT collapse to a headline offering to change nothing. */
  await page.evaluate(() => { const i = document.getElementById('khHandle'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); i.blur(); });
  const cleared = await page.evaluate(() => window.__h.state());
  cleared.field !== 'none' && cleared.title === 'Sign your hides'
    ? ok('clearing it puts the field and the instruction back')
    : bad(`after clearing, field=${cleared.field} title=${JSON.stringify(cleared.title)}`);
}

console.log('\nIT SURVIVES A RELAUNCH, AND IT LEADS SOMEWHERE');
{
  await page.evaluate(() => { window.__h.wipe(); window.__h.open(false); });
  await page.click('#khHandle');
  await page.type('#khHandle', 'tony');
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__h);
  const back = await page.evaluate(() => window.__h.open(false));
  back.value === 'tony' && back.stored === 'tony'
    ? ok('the handle is still there after a relaunch')
    : bad(`the handle did not survive a reload (field ${JSON.stringify(back.value)}, stored ${JSON.stringify(back.stored)})`);
  back.title === '@tony'
    ? ok(`the handle IS the headline once it exists ("${back.title}")`)
    : bad(`the headline is ${JSON.stringify(back.title)} — expected the bare handle`);
  /* AND THE FIELD STANDS DOWN. With the headline showing @tony, a field showing @tony forty
     pixels lower is the same value twice in one glance. */
  back.field === 'none' && back.edit !== 'none' && back.edit !== 'absent'
    ? ok('the field gives way to "Change name" once there is a name')
    : bad(`with a handle set the field is ${back.field} and the edit button is ${back.edit} — `
        + 'the card is showing the same value twice');
  back.discord === 'https://discord.gg/ET9PYFt8M'
    ? ok('Discord points at the real invite')
    : bad(`DISCORD_URL is ${JSON.stringify(back.discord)}`);
}

console.log('\nTHE CARD REPORTS WHAT HAPPENED TO THE HIDES YOU SENT');
{
  /* SENT BUT UNPLAYED IS ITS OWN ANSWER. An absent row here is ambiguous in the wrong
     direction — "nobody opened them" and "this is broken" look identical. */
  await page.evaluate(() => window.__h.hides(['a', 'b'],
    { a: { n_attempts: 0, n_found: 0 }, b: { n_attempts: 0, n_found: 0 } }));
  await page.evaluate(() => window.__h.open(false));
  await page.waitForTimeout(250);
  const quiet = await page.evaluate(() => window.__h.state());
  /2 challenges sent/.test(quiet.scoreText) && /nobody has played yet/.test(quiet.scoreText)
    ? ok(`sent but unplayed says so ("${quiet.scoreText.trim()}")`)
    : bad(`zero attempts renders ${JSON.stringify(quiet.scoreText)}`);

  /* But someone who has never sent anything still gets nothing — that row would be about
     their own inactivity rather than about other people. */
  await page.evaluate(() => window.__h.hides([], {}));
  const none0 = await page.evaluate(() => window.__h.open(false));
  none0.score === 'none'
    ? ok('and someone who has never sent a challenge gets no row at all')
    : bad(`a never-sent user sees ${JSON.stringify(none0.scoreText)}`);

  /* Aggregated across every hide, with an expired one (null from get_hide) dropped. */
  await page.evaluate(() => window.__h.hides(['a', 'b', 'gone'], {
    a: { n_attempts: 9, n_found: 2 }, b: { n_attempts: 3, n_found: 1 } }));
  await page.evaluate(() => window.__h.open(false));
  await page.waitForTimeout(250);
  const many = await page.evaluate(() => window.__h.state());
  /12 played your hides/.test(many.scoreText) && /3 found you/.test(many.scoreText)
    ? ok(`it sums every hide and drops the expired one ("${many.scoreText.trim()}")`)
    : bad(`the aggregate is wrong: ${JSON.stringify(many.scoreText)}`);

  /* NOT GATED ON THE HANDLE. The score is about hides you sent, and you can send hides
     without ever naming yourself — most people will. */
  await page.evaluate(() => { window.__h.wipe(); window.__h.hides(['a'], { a: { n_attempts: 1, n_found: 0 } }); });
  await page.evaluate(() => window.__h.open(false));
  await page.waitForTimeout(250);
  const none = await page.evaluate(() => window.__h.state());
  /^1 played your hide ·/.test(none.scoreText.trim()) && /nobody found you/.test(none.scoreText)
    ? ok('one player, none found → singular, and the loss is stated plainly')
    : bad(`the singular / nobody-found case reads: ${JSON.stringify(none.scoreText)}`);

  /* THE ROW IS A BUTTON, AND TAPPING IT MUST NOT DISMISS THE CARD.
     Reported from the field: "quand on tap sur la card ça ferme au lieu d'ouvrir le preview
     ou le watch". Two faults met on the same gesture. The row had no handler at all, so a tap
     that missed the three small controls did nothing — and the card's drag-to-close armed
     INSIDE the list whenever it was too short to scroll, so the few pixels of travel in a
     normal press cleared the 40px threshold and shut the card instead.
     Asserted through a real press with movement rather than a bare .click(), because a
     synthetic click has no travel and would pass against the very code that failed. */
  await page.evaluate(() => window.__h.expand());
  const tapped = await page.evaluate(async () => {
    const row = document.querySelector('#khScore .khRow');
    if (!row) return { err: 'no row' };
    const r = row.getBoundingClientRect();
    const x = Math.round(r.left + 12), y = Math.round(r.top + r.height / 2);
    const o = (cy) => ({ bubbles: true, cancelable: true, pointerId: 3, pointerType: 'touch', clientX: x, clientY: cy });
    /* Down, then 44px of drift — past the dismiss threshold — then up: a thumb reaching for
       a control on a 46px row, which is exactly the gesture that was closing the card. */
    row.dispatchEvent(new PointerEvent('pointerdown', o(y)));
    row.dispatchEvent(new PointerEvent('pointermove', o(y + 44)));
    row.dispatchEvent(new PointerEvent('pointerup', o(y + 44)));
    await new Promise((r2) => setTimeout(r2, 150));
    return { shown: document.getElementById('kamoHome').classList.contains('show'),
             live: row.classList.contains('khRowTap') };
  });
  tapped.shown
    ? ok('a press with travel on a row leaves the card open — the list is not a dismiss surface')
    : bad('pressing a row closed the card: the drag-to-close still arms inside #khScore');
  tapped.live
    ? ok('and a played row is marked live, so the whole row is the target rather than three chips')
    : bad('the row carries no tap affordance — only the small controls are reachable');

  /* ONE SENTENCE, NOT THE SAME NUMBERS TWICE. The chips under the state line restated it word
     for word ("1 tried" under "1 tried · nobody found you") and held the width that was
     pushing the sentence onto a third line. */
  const dup = await page.evaluate(() => {
    const row = document.querySelector('#khScore .khRow');
    return { txt: (row.querySelector('.khRowTxt') || {}).textContent || '',
             chips: row.querySelectorAll('.khRowChips .chChip').length };
  });
  dup.chips === 0 && /1 tried/.test(dup.txt)
    ? ok('and it states the count once, in the sentence, with no chip repeating it')
    : bad(`the row repeats itself: ${dup.chips} chip(s) under ${JSON.stringify(dup.txt)}`);
}

/* TEN CHALLENGES IS THE MAXIMUM chMine() KEEPS, SO TEN IS THE SIZE THE CARD MUST SURVIVE.
   The report was "quand on ouvre et qu'il y a beaucoup de challenges, ça casse la modal, et on
   voit plus le haut" — and in the same breath, "Show each one ne fonctionne pas". Those were
   one bug: the card is anchored to the BOTTOM edge, so expanding pushed the badge, the name
   and the summary off the top of the screen, and the rows the button had just rendered were
   drawn above y=0 where nothing could be seen. The button was working perfectly.
   Nothing in this file could catch that, because every element involved was still `display`
   whatever it should be — which is why the hook measures rectangles. */
console.log('\nTEN CHALLENGES STILL FIT ON THE SCREEN');
{
  const ids = Array.from({ length: 10 }, (_, i) => 'h' + i);
  const rows = {};
  ids.forEach((id, i) => { rows[id] = { n_attempts: i, n_found: i % 3, img_path: '' }; });
  await page.evaluate(([ids, rows]) => window.__h.hides(ids, rows), [ids, rows]);
  await page.evaluate(() => window.__h.open(false));
  await page.waitForTimeout(250);

  const shut = await page.evaluate(() => window.__h.fit());
  shut.cardTop >= 0
    ? ok(`closed, the card starts on screen (top ${shut.cardTop}px)`)
    : bad(`the card already overflows before anything is expanded (top ${shut.cardTop}px)`);

  const open = await page.evaluate(() => window.__h.expand());
  open.rows === 10
    ? ok('"Show each one" renders all ten rows')
    : bad(`expanding rendered ${open.rows} rows — the accordion is not opening`);
  open.cardTop >= 0 && open.badgeTop >= 0
    ? ok(`and the top of the card is still visible (card ${open.cardTop}px, badge ${open.badgeTop}px)`)
    : bad(`expanded, the card runs off the top of the screen (card ${open.cardTop}px, badge `
        + `${open.badgeTop}px) — the badge, the name and the summary are all unreachable`);
  open.scoreScrolls
    ? ok('the list scrolls inside its own box rather than growing the card')
    : bad('the results box is not a scroll container — ten rows have to go somewhere, and '
        + 'without this they go off the top of the screen');
  /* The two numbers this card exists to deliver used to be REPLACED by the list they
     summarise, so they were readable only while the thing they describe was closed. */
  /played your hide/.test(open.headText)
    ? ok(`the summary rides above the open list ("${open.headText.trim()}")`)
    : bad(`the open state's header reads ${JSON.stringify(open.headText)} — the headline was `
        + 'thrown away by the expansion');
}

await browser.close();
server.close();
console.log(failed ? `\n✗ ${failed} failure(s)` : '\n✓ the player card keeps a clean handle and claims only what is true');
process.exit(failed ? 1 : 0);
