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

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const req = createRequire(import.meta.url);
let chromium = null;
for (const base of [process.env.PW_CORE, ROOT, process.cwd()]) {
  try { ({ chromium } = req(base ? join(base, 'node_modules/playwright-core') : 'playwright-core')); break; } catch {}
}
if (!chromium) {
  console.log('· playwright-core not installed — skipping the home test (set PW_CORE=<dir with node_modules>)');
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
  + 'restore:g("#khRestore"),field:g("#khName"),edit:g("#khEdit"),'
  + 'score:g("#khScore"),scoreText:(document.getElementById("khScore")||{}).textContent||""};},'
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
const exe = (globSync('/opt/pw-browsers/chromium-*/chrome-linux/chrome') || [])[0];
if (!exe) { console.log('· no chromium under /opt/pw-browsers — skipping'); server.close(); process.exit(0); }
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
  free.upsell !== 'none' && free.upsell !== 'absent'
    ? ok('the upsell row is offered')
    : bad(`the upsell is ${free.upsell} for a free user — the wordmark's paywall path is gone with nothing replacing it`);
  free.chips === 0
    ? ok('no perk list — the card is about who you are, not what the subscription contains')
    : bad(`${free.chips} perk chips are back on the player card`);
  free.restore === 'absent'
    ? ok('no Restore row — a store action does not belong on a card about who you are')
    : bad(`Restore is back on the player card (${free.restore}); it lives on the paywall, which is `
        + 'where the five taps that justified it actually happened');

  const pro = await page.evaluate(() => window.__h.open(true));
  pro.plus !== 'none' ? ok('a member gets the +') : bad('the + is hidden from someone who paid for it');
  pro.upsell === 'none'
    ? ok('and is not sold what they already own')
    : bad('the upsell row shows to a member');
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
  done.field === 'none' && done.edit !== 'none'
    ? ok('and stands down on blur, without reopening the card')
    : bad(`after blur the field is ${done.field} and the edit button is ${done.edit}`);

  /* Clearing it must NOT collapse to a button offering to change nothing. */
  await page.evaluate(() => { document.getElementById('khEdit').click(); });
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
  /* Nobody has played anything yet → no row. A "0 people have played" line would greet
     someone with their own inactivity, which is the flaw the stat tiles died of. */
  await page.evaluate(() => window.__h.hides(['a'], { a: { n_attempts: 0, n_found: 0 } }));
  const quiet = await page.evaluate(() => window.__h.open(false));
  quiet.score === 'none'
    ? ok('nothing played yet → no row at all, rather than a row that says nothing happened')
    : bad(`the score row shows with zero attempts: ${JSON.stringify(quiet.scoreText)}`);

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
}

await browser.close();
server.close();
console.log(failed ? `\n✗ ${failed} failure(s)` : '\n✓ the player card keeps a clean handle and claims only what is true');
process.exit(failed ? 1 : 0);
