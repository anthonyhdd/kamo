#!/usr/bin/env node
/**
 * THE NAME HAS TO SURVIVE A RELAUNCH, AND NOTHING ANYWHERE CHECKED THAT IT DOES.
 *
 * The founder's report, twice: "d'une session à l'autre on doit toujours entrer le nom",
 * and — the part that killed the obvious explanation — it happens on BOTH the old build and
 * the new one. The old build (1.0.2) runs the WebView with `incognito`, i.e. WebKit's
 * non-persistent data store, so every kamo_* key is wiped when the app closes; that fully
 * explains 1.0.2 and explains nothing about 1.0.9, which does not set the flag.
 *
 * Static reading exonerated the page: getHandle/setHandle are correct, openKamoHome reloads
 * the field from storage, and the only removeItem for this key is guarded on an empty value.
 * All of which is exactly what a passing code review looks like the day before a bug ships.
 *
 * So this stops reading and drives it. Type a name through the REAL listeners, RELOAD the
 * document — same origin, same storage, which is precisely what a relaunch looks like on a
 * persistent store — and ask the card what it knows. That single step is the one nobody had
 * automated, because every other DOM suite here builds one page and stays on it.
 *
 * It discriminates, which is the point:
 *   · survives here  → the page is innocent and the fault is native/environmental
 *   · dies here      → a page bug, live for EVERY version, matching the report exactly
 *
 * Both branches are worth a permanent test. The name is the only identity KAMO has, it is
 * stamped on every challenge a friend receives, and re-typing it on every launch is the kind
 * of papercut that reads as "this app is broken" long before anyone reports it.
 *
 *   PW_CORE=<dir with node_modules> node scripts/test-handle-dom.mjs
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
  console.log('· playwright-core not installed — skipping the handle test — run: ' + PW_SETUP);
  process.exit(0);
}

const real = readFileSync(join(ROOT, 'index.html'), 'utf8');
const at = real.lastIndexOf('</script>');
/* Deliberately thin: the whole question is what the REAL code does across a reload, so the
   harness only opens the card and reports. Anything that reached past the public surface
   would be testing itself. */
const html = real.slice(0, at)
  + '\nwindow.__n={'
  + 'open(){openKamoHome();},'
  + 'stored(){try{return localStorage.getItem("kamo_handle")||"";}catch(e){return"";}},'
  + 'handle(){return getHandle();},'
  + 'field(){return (document.getElementById("khHandle")||{}).value||"";},'
  + 'title(){return (document.getElementById("khTitle")||{}).textContent||"";}};\n'
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
await page.waitForFunction(() => !!window.__n, null, { timeout: 10000 });

console.log('\nA NAME TYPED IN SESSION ONE');
{
  await page.evaluate(() => window.__n.open());
  await page.waitForTimeout(80);
  // Through the real input, so the real 'input' and 'blur' listeners are what store it —
  // setting .value from script would fire neither and would test nothing.
  await page.click('#khHandle');
  await page.type('#khHandle', 'tony');
  await page.evaluate(() => document.getElementById('khHandle').blur());
  await page.waitForTimeout(80);

  const s = await page.evaluate(() => ({ stored: window.__n.stored(), handle: window.__n.handle(), title: window.__n.title() }));
  s.stored === 'tony'
    ? ok(`is written to storage as "${s.stored}"`)
    : bad(`never reached storage (kamo_handle = "${s.stored}") — the write itself is broken`);
  s.title === '@tony'
    ? ok('and the card headline becomes @tony straight away')
    : bad(`the headline says "${s.title}" instead of @tony`);
}

console.log('\nAND IT IS STILL THERE AFTER A RELAUNCH');
{
  /* THE STEP NOTHING ELSE HERE DOES. A reload is a brand-new document against the same
     origin — which is exactly what relaunching the app is, on any WebView that keeps its
     data store. If the name cannot cross this line in a browser, it cannot cross it on a
     phone either, and the build version was never the reason. */
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__n, null, { timeout: 10000 });

  const after = await page.evaluate(() => ({ stored: window.__n.stored(), handle: window.__n.handle() }));
  after.stored === 'tony'
    ? ok('the stored value survives a fresh document')
    : bad(`storage came back "${after.stored}" — something on the boot path is clearing or `
        + 'overwriting kamo_handle, and that would hit every build, old and new');
  after.handle === 'tony'
    ? ok('and getHandle() reads it back')
    : bad(`getHandle() returns "${after.handle}" although storage holds "${after.stored}" — `
        + 'the value is being read through something that rejects it');

  await page.evaluate(() => window.__n.open());
  await page.waitForTimeout(80);
  const card = await page.evaluate(() => ({ field: window.__n.field(), title: window.__n.title() }));
  card.title === '@tony'
    ? ok('and the reopened card greets @tony rather than asking again')
    : bad(`the card says "${card.title}" — the user is being asked for their name a second time, `
        + 'which is the reported bug');
  card.field === 'tony'
    ? ok('with the field pre-filled, so "Change name" edits instead of starting over')
    : bad(`the field came back "${card.field}" instead of "tony"`);
}

console.log('\nAND WHEN THE PAGE STORE COMES UP EMPTY, NATIVE HANDS IT BACK');
{
  /* The case the whole native copy exists for: a launch where localStorage is blank even
     though the user named themselves days ago. Simulated by wiping the key and replaying
     the injection syncWeb performs on every load. */
  await page.evaluate(() => { try { localStorage.removeItem('kamo_handle'); } catch (e) {} });
  await page.evaluate(() => window.KAMO.setStoredHandle('tony'));
  const back = await page.evaluate(() => ({ stored: window.__n.stored(), handle: window.__n.handle() }));
  back.handle === 'tony'
    ? ok('an empty page store is refilled from the native copy')
    : bad(`the name stayed "${back.handle}" — the native fallback does not reach the page, `
        + 'so the user still retypes it');

  await page.evaluate(() => window.__n.open());
  await page.waitForTimeout(80);
  const t = await page.evaluate(() => window.__n.title());
  t === '@tony' ? ok('and the card greets them by name') : bad(`the card says "${t}"`);
}

console.log('\nBUT IT NEVER OVERWRITES A NAME THE USER JUST TYPED');
{
  /* setStoredHandle runs on EVERY sync, including plain reloads, so a stale value off disk
     racing a fresh one from the keyboard would silently rename the user. Fill-only. */
  await page.evaluate(() => { try { localStorage.setItem('kamo_handle', 'freshname'); } catch (e) {} });
  await page.evaluate(() => window.KAMO.setStoredHandle('oldname'));
  const kept = await page.evaluate(() => window.__n.handle());
  kept === 'freshname'
    ? ok('a stale native value loses to the one already on the page')
    : bad(`the page name was replaced with "${kept}" — a name typed a moment ago can be `
        + 'overwritten by whatever was on disk');

  // And a cleared name is not resurrected by an empty injection.
  await page.evaluate(() => { try { localStorage.removeItem('kamo_handle'); } catch (e) {} });
  await page.evaluate(() => window.KAMO.setStoredHandle(''));
  const empty = await page.evaluate(() => window.__n.handle());
  empty === ''
    ? ok('and an empty injection leaves a deliberately cleared name cleared')
    : bad(`clearing the name did not stick (got "${empty}")`);
}

await browser.close();
server.close();
console.log(failed ? `\n✗ ${failed} failure(s)` : '\n✓ the name is typed once and survives the next launch');
process.exit(failed ? 1 : 0);
