/* WHERE THE DOM TESTS FIND A BROWSER, in one place.
 *
 * Every test-*-dom.mjs used to glob a single hard-coded path,
 * /opt/pw-browsers/chromium-*\/chrome-linux/chrome, which exists only on the Linux CI image.
 * On the machine where all the work actually happens — a Mac — every one of them printed
 * "skipping" and check.mjs still finished with "all checks passed". That is the worst shape
 * a test suite can have: it reports success for a run in which it did nothing. Three PRs
 * shipped in one evening on 2026-08-12 without a single DOM test executing, and the one real
 * bug of the night (chrome and gold rendering black) was caught by looking at a screenshot,
 * not by this suite.
 *
 * Two things were missing, and both are here:
 *   1. a browser — CI's chromium, else whatever Chrome/Chromium/Edge is installed locally
 *   2. playwright-core — which is deliberately NOT a dependency of this repo (it ships one
 *      HTML file and has no package.json), so it is looked up in a cache directory the
 *      developer installs once, instead of an env var they have to remember every time.
 *
 * Set PW_CHROME to force a specific browser binary; set PW_CORE to force a playwright-core
 * install. Both still win over everything below.
 */
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const HOME = process.env.HOME || '';
export const PW_CACHE = HOME ? join(HOME, '.cache/kamo-playwright') : '';
/* Printed by every test that cannot run, so the fix is one copyable line rather than a
   rediscovery. Kept as one string so the message cannot drift between thirteen files. */
export const PW_SETUP = `npm i --prefix ${PW_CACHE || '~/.cache/kamo-playwright'} playwright-core`;

/* The order is the priority: an explicit override, then the repo, then the shell's cwd, then
   the shared cache. ROOT is passed in rather than derived because these scripts live one
   directory down and each already computes it. */
export function pwBases(ROOT) {
  return [process.env.PW_CORE, ROOT, process.cwd(), PW_CACHE].filter(Boolean);
}

/* CI FIRST. On the Linux image the bundled chromium is the browser the suite was written
   against, so it must win over any system Chrome that happens to be on the runner. */
export function chromeExe() {
  if (process.env.PW_CHROME && existsSync(process.env.PW_CHROME)) return process.env.PW_CHROME;
  try {
    for (const e of readdirSync('/opt/pw-browsers')) {
      if (!e.startsWith('chromium-')) continue;
      const p = join('/opt/pw-browsers', e, 'chrome-linux', 'chrome');
      if (existsSync(p)) return p;
    }
  } catch { /* not the CI image */ }
  for (const p of [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium', '/usr/bin/chromium-browser',
  ]) if (existsSync(p)) return p;
  return null;
}
