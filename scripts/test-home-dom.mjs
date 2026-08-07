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
  + 'discord:DISCORD_URL,chipsOff:document.querySelectorAll("#kamoHome .kpChip.off").length};},'
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
  free.chipsOff === 3
    ? ok('the perk chips read as locked')
    : bad(`${free.chipsOff} of 3 chips are dimmed — a free user is being shown perks as if they had them`);

  const pro = await page.evaluate(() => window.__h.open(true));
  pro.plus !== 'none' ? ok('a member gets the +') : bad('the + is hidden from someone who paid for it');
  pro.upsell === 'none'
    ? ok('and is not sold what they already own')
    : bad('the upsell row shows to a member');
  pro.chipsOff === 0 ? ok('their perks read as theirs') : bad('a member sees their own perks dimmed');
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
  /^You.re @tony$/.test(back.title || '')
    ? ok(`the headline becomes a fact once it is set ("${back.title}")`)
    : bad(`the headline still asks after the handle is set: ${JSON.stringify(back.title)}`);
  back.discord === 'https://discord.gg/ET9PYFt8M'
    ? ok('Discord points at the real invite')
    : bad(`DISCORD_URL is ${JSON.stringify(back.discord)}`);
}

await browser.close();
server.close();
console.log(failed ? `\n✗ ${failed} failure(s)` : '\n✓ the player card keeps a clean handle and claims only what is true');
process.exit(failed ? 1 : 0);
