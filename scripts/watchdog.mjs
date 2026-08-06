#!/usr/bin/env node
/**
 * WATCHDOG — checks what is actually being SERVED, not what is in the repo.
 *
 * check.mjs guards the file before it is pushed. This guards the thing users load, which is
 * a different question and the one that went wrong: on 2026-08-06 the repo was fine for four
 * hours while every installed app showed an error, because a custom domain attached to the
 * Pages site turned this URL into a 301 to *http*://kamo.bliss-coach.com and App Transport
 * Security refuses the cleartext hop inside WKWebView. Nothing in the repo was broken.
 * Nothing in CI was red. The app was dead.
 *
 * WHY NOT AMPLITUDE. Analytics can only report that usage fell, minutes later, and cannot
 * separate "the app is broken" from "it is 4am". These checks name the failure and see it
 * within one poll. Amplitude remains the right sensor for the slower question — a feature
 * that stopped being used — which is a different alert with a different cadence.
 *
 * Exits non-zero on any failure, which is what turns it into an email from GitHub Actions.
 *
 *   node scripts/watchdog.mjs
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/* Both origins are checked. The app loads the first; every share link points at the second.
   Either being down is a real outage, and they fail independently — the mirror has already
   had a failed deploy while github.io was fine. */
/* Overridable so scripts/test-watchdog.mjs can point this at a local server and prove the
   checks actually fire. Never set in CI — the default IS the production contract. */
const ORIGINS = process.env.KAMO_WATCH_ORIGINS
  ? JSON.parse(process.env.KAMO_WATCH_ORIGINS)
  : [
    { name: 'app origin', url: 'https://anthonyhdd.github.io/kamo/' },
    { name: 'share origin', url: 'https://kamo.bliss-coach.com/' },
  ];

/* Strings that must appear in what is served. Not a checksum — the file changes several
   times a day and a checksum would page on every deploy. These are load-bearing: the title
   is what link previews show, CH_MAKE governs whether challenge links are created at all,
   and KAMO is the wordmark burned into every share. */
const MUST_CONTAIN = [
  ['<title>KAMO — Meccha IRL</title>', 'the page title link previews depend on'],
  ['const CH_MAKE=true', 'challenge publishing — if this flips, no link is ever created'],
];

let failed = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { failed++; console.error('  ✗ ' + m); };

for (const { name, url } of ORIGINS) {
  let res, body;
  try {
    /* redirect: 'manual' is the whole point of this check. Following redirects would have
       reported 200 OK during the outage: the redirect target served fine over https to a
       normal client, and only WKWebView refused the http:// hop. The redirect ITSELF is the
       fault, so it must be seen rather than followed. */
    res = await fetch(url + '?wd=' + Date.now(), { redirect: 'manual' });
    body = await res.text();
  } catch (e) {
    bad(`${name} (${url}) — request failed: ${e.message}`);
    continue;
  }

  if (res.status >= 300 && res.status < 400) {
    const to = res.headers.get('location') || '(no Location header)';
    bad(`${name} REDIRECTS (${res.status}) to ${to}\n`
      + '    This is the 2026-08-06 outage signature. A redirect here — especially to http:// —\n'
      + '    is refused by App Transport Security inside the WebView and the app will not open.\n'
      + '    Check the custom domain on the Pages settings of the repo serving this origin.');
    continue;
  }
  if (!res.ok) { bad(`${name} returned HTTP ${res.status}`); continue; }
  if (body.length < 50000) {
    bad(`${name} served only ${body.length} bytes — that is not the app, it is an error page`);
    continue;
  }
  ok(`${name} serves ${Math.round(body.length / 1024)} KB, HTTP 200, no redirect`);

  for (const [needle, why] of MUST_CONTAIN) {
    body.includes(needle)
      ? ok(`  ${name}: ${why}`)
      : bad(`${name} is missing ${JSON.stringify(needle)} — ${why}`);
  }

  /* THE SERVED JAVASCRIPT MUST PARSE. A syntax error anywhere in the inline script takes the
     whole app down for everyone at once, and it is the one failure that looks identical to a
     working deploy from the outside: 200 OK, right size, right title, dead app. check.mjs
     catches it before a push; this catches a bad deploy, a truncated transfer, or a file that
     reached the CDN half-written. */
  const scripts = [...body.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  if (!scripts.length) { bad(`${name}: no inline script in the served page`); continue; }
  let parsed = true;
  scripts.forEach((src, i) => {
    const tmp = join(tmpdir(), `kamo-wd-${process.pid}-${i}.mjs`);
    writeFileSync(tmp, src);
    try {
      execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' });
    } catch (e) {
      parsed = false;
      bad(`${name}: SERVED SCRIPT HAS A SYNTAX ERROR — the app is dead for every user right now\n`
        + '    ' + (e.stderr || '').toString().split('\n').slice(0, 4).join('\n    '));
    } finally { try { unlinkSync(tmp); } catch {} }
  });
  if (parsed) ok(`  ${name}: served JavaScript parses`);
}

console.log(failed ? `\n✗ ${failed} problem(s) — KAMO IS BROKEN IN PRODUCTION` : '\n✓ production is healthy');
process.exit(failed ? 1 : 0);
