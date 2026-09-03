#!/usr/bin/env node
/**
 * THE APP SPEAKS THE READER'S LANGUAGE — and, more importantly, never speaks nothing.
 *
 * The store listing has been in 39 languages since 1.1.4 and the binary declares 36 bundle
 * localizations since 1.1.7. The page underneath was English for all of them. This suite
 * guards the fix and the three ways it could go wrong without throwing anything:
 *
 *   - A MISSING KEY EMPTIES A BUTTON. The dictionary is indexed by the English string
 *     itself, so a key that was never translated resolves to English. If that ever becomes
 *     a lookup that can return undefined, "Send to a friend" renders blank and the send —
 *     the guard metric on every reveal change — dies silently on half the planet.
 *   - AN UNKNOWN LOCALE GETS A HALF-TRANSLATED PAGE. Swahili has no dictionary. It must get
 *     the complete English page, not a mixture.
 *   - THE ENGLISH PATH DRIFTS. Forty-two suites read English copy out of the DOM. If the
 *     translation layer touched en-US at all, they would all be measuring the layer instead
 *     of the app.
 *
 * ⚠️ The reason this file exists at all: on 2026-08-30 the whole suite was found to inherit
 * the MACHINE's locale. Every test-*-dom.mjs called browser.newPage() without pinning one,
 * so on a Mac set to fr-FR the pages came up French while CI's Linux came up English. The
 * suite asserted English copy either way. It was green on CI and would have gone red here
 * for a reason that had nothing to do with the app. Every newPage now pins en-US; this file
 * is the only one allowed to ask for another language, and it asks explicitly.
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
if (!chromium) { console.log('· playwright-core not installed — skipping the i18n test — run: ' + PW_SETUP); process.exit(0); }

const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const MIME = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg' };
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

async function open(locale) {
  const page = await browser.newPage({ locale, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await page.goto(base, { waitUntil: 'load' });
  await page.waitForTimeout(400);
  return page;
}

/* 1. THE READER'S LANGUAGE REACHES THE SCREEN — text node and attribute alike. The aria-label
      is checked because kTr walks attributes in a second pass: a translation that covers only
      text nodes leaves every control unlabelled in the reader's language and nothing looks
      wrong on screen. */
{
  const page = await open('fr-FR');
  const seen = await page.evaluate(() => ({
    hero: (document.querySelector('#start') || {}).textContent || '',
    lang: document.documentElement.lang,
    label: (document.querySelector('[aria-label]') || {}).outerHTML || '',
    labels: [...document.querySelectorAll('[aria-label]')].map(e => e.getAttribute('aria-label')),
  }));
  seen.hero.includes('Cache un kamo si bien')
    ? ok('a French reader gets French copy on the first screen')
    : bad(`the hero stayed English for fr-FR: ${JSON.stringify(seen.hero.slice(0, 90))}`);
  seen.lang === 'fr'
    ? ok('and <html lang> says so, for the screen reader and the browser')
    : bad(`document lang is ${JSON.stringify(seen.lang)}, expected "fr"`);
  seen.labels.some(l => /Changer de caméra|Choisir une photo|Fermer|Lumière/.test(l))
    ? ok('the attribute pass ran too — controls are labelled in French')
    : bad(`no aria-label was translated: ${JSON.stringify(seen.labels.slice(0, 8))}`);
  await page.close();
}

/* 2. THE FALLBACK IS THE ENGLISH SOURCE, NOT UNDEFINED. This is the property the whole design
      rests on, so it is asserted directly rather than inferred from a screen that happens to
      look right. */
{
  const page = await open('fr-FR');
  const r = await page.evaluate(() => ({
    unknown: window.kT('a string nobody ever translated'),
    known: window.kT('Send to a friend'),
    empties: Object.keys(window.KLANG).flatMap(l =>
      Object.entries(window.KLANG[l]).filter(([, v]) => !v || !String(v).trim()).map(([k]) => l + ':' + k)),
    sizes: Object.fromEntries(Object.keys(window.KLANG).map(l => [l, Object.keys(window.KLANG[l]).length])),
  }));
  r.unknown === 'a string nobody ever translated'
    ? ok('an untranslated string comes back as itself, never blank')
    : bad(`kT() returned ${JSON.stringify(r.unknown)} for an unknown key`);
  r.known && r.known !== 'Send to a friend'
    ? ok('and a known one comes back translated')
    : bad(`kT("Send to a friend") returned ${JSON.stringify(r.known)}`);
  r.empties.length === 0
    ? ok('no dictionary entry is an empty string')
    : bad(`${r.empties.length} empty translation(s): ${r.empties.slice(0, 5).join(', ')}`);
  /* Since 2026-09-03 four languages are COMPLETE (every kT call, every static string) and the
     others carry the core set they always did. So: one size among the full four, one size
     among the rest, and the full four strictly larger. check.mjs holds both sets to the source. */
  const FULL = ['ru', 'es', 'pt', 'fr'];
  const full = [...new Set(FULL.map(l => r.sizes[l]))], core = [...new Set(Object.keys(r.sizes).filter(l => !FULL.includes(l)).map(l => r.sizes[l]))];
  full.length === 1 && core.length === 1 && full[0] > core[0]
    ? ok(`ru/es/pt/fr carry ${full[0]} keys each, the ${Object.keys(r.sizes).length - 4} core languages ${core[0]} each`)
    : bad(`dictionaries disagree on size: ${JSON.stringify(r.sizes)}`);
  const tmpl = await page.evaluate(() => ({
    fr: window.kTn('Hint · {n} left', 3),
    en: (window.KLANG.fr['Hint · {n} left'] || '').includes('{n}'),
    miss: window.kTn('Nobody translated this {n} sentence', 7),
  }));
  !tmpl.fr.includes('{n}') && tmpl.fr.includes('3')
    ? ok(`a number is a hole in the sentence, not a concatenation ("${tmpl.fr}")`)
    : bad(`kTn left its placeholder or lost the number: ${JSON.stringify(tmpl.fr)}`);
  tmpl.en
    ? ok('and every template keeps its {n} slot, so word order stays the translator\'s call')
    : bad('a template lost its {n} placeholder in the dictionary');
  tmpl.miss === 'Nobody translated this 7 sentence'
    ? ok('an untranslated template still fills its hole')
    : bad(`kTn fallback broke: ${JSON.stringify(tmpl.miss)}`);
  /* The TAGGED form, for sentences with two holes and more: kT`${a} of ${b} have found it`
     keys as "{0} of {1} have found it" and the translation may put {1} before {0}. */
  const tg = await page.evaluate(() => {
    const key = '\n{0} of {1} have found it — fastest {2}. One tap to find it.';   // the re-send line, newline included
    const fr = (window.KLANG.fr || {})[key] || null;
    return {
      miss: window.kT`${3} of ${7} nobody translated ${'x'}`,
      fr, got: window.kT`\n${3} of ${7} have found it — fastest ${'4.1s'}. One tap to find it.`,
      empty: window.kT`${null} left`,
    };
  });
  tg.miss === '3 of 7 nobody translated x'
    ? ok('an untranslated tagged template substitutes its values in order')
    : bad(`tagged fallback broke: ${JSON.stringify(tg.miss)}`);
  if (tg.fr) {
    const want = tg.fr.replace('{0}', '3').replace('{1}', '7').replace('{2}', '4.1s');
    tg.got === want && !/\{\d\}/.test(tg.got)
      ? ok(`a translated tagged template fills every hole ("${tg.got}")`)
      : bad(`tagged translation gave ${JSON.stringify(tg.got)}, wanted ${JSON.stringify(want)}`);
  } else bad('the sample tagged key has no French entry — the re-send line ships in English');
  tg.empty === ' left' ? ok('a null value becomes nothing, never "null"') : bad(`null substituted as ${JSON.stringify(tg.empty)}`);
  await page.close();
}

/* 2b. NO SCREEN LEAKS A RAW PLACEHOLDER. A translation that names a {n} the call never fed, or
       a call that feeds {0} to a key written with {n}, shows the braces to the user. Scanned on
       the first screen in every full language, and on a Russian seeker card, where the
       report lines carry the most holes. */
for (const L of ['ru', 'es', 'pt', 'fr']) {
  const page = await open({ ru: 'ru-RU', es: 'es-ES', pt: 'pt-BR', fr: 'fr-FR' }[L]);
  const r = await page.evaluate(() => ({
    lang: document.documentElement.lang,
    leak: (document.body.innerText.match(/\{(\d|n)\}/g) || []).length,
    hero: (document.querySelector('#start') || {}).textContent || '',
  }));
  r.lang === L && !r.hero.includes('Hide a kamo so well') && r.leak === 0
    ? ok(`${L}: the first screen is translated and shows no raw placeholder`)
    : bad(`${L}: lang=${r.lang} leak=${r.leak} hero=${JSON.stringify(r.hero.slice(0, 60))}`);
  await page.close();
}
{
  const page = await browser.newPage({ locale: 'ru-RU', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.route('**/api*.amplitude.com/**', r => r.fulfill({ status: 200, body: '{}' }));
  await page.route('**/rest/v1/rpc/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: 'null' }));
  await page.route('**/rest/v1/rpc/get_hide', r => r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ img_path: 'p.jpg', name: 'tony', n_attempts: 4, n_found: 1, best_ms: 4100, created_at: '2026-09-01T12:00:00Z', is_public: true }) }));
  await page.route('**/storage/v1/object/public/hides/**', r => r.fulfill({ status: 200, contentType: 'image/png',
    body: Buffer.from('iVBORw0KGgoAAAABAAAAAQCAYAAAAf8/9hAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64') }));
  await page.goto(base + '?h=abc123', { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  const r = await page.evaluate(() => ({
    leak: (document.body.innerText.match(/\{(\d|n)\}/g) || []).length,
    english: /hid a kamo here|One tap to find|I give up/.test(document.body.innerText),
    text: document.body.innerText.replace(/\s+/g, ' ').slice(0, 300),
  }));
  errors.length === 0 ? ok('a challenge link opens in Russian without a page error') : bad('page error on the Russian seeker: ' + errors.join(' | '));
  r.leak === 0 && !r.english
    ? ok('the seeker card is Russian and shows no raw placeholder')
    : bad(`Russian seeker: leak=${r.leak} english=${r.english} — ${r.text}`);
  await page.close();
}

/* 3. A LANGUAGE WE DO NOT SHIP GETS THE WHOLE ENGLISH PAGE, not a mixture. */
{
  const page = await open('sw-KE');
  const r = await page.evaluate(() => ({
    hero: (document.querySelector('#start') || {}).textContent || '',
    loc: window.kT('Send to a friend'),
  }));
  r.hero.includes('Hide a kamo so well') && r.loc === 'Send to a friend'
    ? ok('a language with no dictionary gets English, whole')
    : bad(`sw-KE was not left in English: ${JSON.stringify(r.hero.slice(0, 80))}`);
  await page.close();
}

/* 4. AND en-US IS BYTE-FOR-BYTE WHAT IT WAS. The other forty-two suites depend on it. */
{
  const page = await open('en-US');
  const r = await page.evaluate(() => ({
    hero: (document.querySelector('#start') || {}).textContent || '',
    lang: document.documentElement.lang,
  }));
  r.hero.includes('Hide a kamo so well your friends can’t spot it') && r.lang === 'en'
    ? ok('English is untouched — the suite still reads what it always read')
    : bad(`en-US drifted: lang=${r.lang} hero=${JSON.stringify(r.hero.slice(0, 80))}`);
  await page.close();
}

await browser.close();
server.close();
if (failed) { console.error(`\n✗ ${failed} i18n check(s) failed`); process.exit(1); }
console.log('\n✓ the app speaks the reader\'s language, and never speaks nothing');
