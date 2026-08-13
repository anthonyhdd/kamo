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

/* ---- THE CHALLENGE LINK, WHICH IS A THIRD ORIGIN AND THE ONLY ONE STRANGERS SEE -----------
   The two origins above are where the APP lives. A challenge link lives somewhere else again —
   playkamo.com/h/<id>, a Cloudflare Worker in front of a Supabase edge function — and on
   2026-08-12 it served every human a blank white page for roughly two hours, from the
   SHARE_HOST flip until infra/playkamo-worker.js started stripping the header.

   Nothing saw it, and the reason is worth stating precisely, because it is the reason this
   check is shaped the way it is. Supabase's gateway stamps `content-security-policy:
   default-src 'none'; sandbox` on every HTML response it serves, and the Worker passed the
   header through. The BODY was perfect: 200 OK, right length, og: tags intact. Scrapers were
   happy. Browsers sandboxed the document and ran nothing — no redirect script, no meta
   refresh, not even the inline background colour. So:

     - the existing checks above would have passed it. They read the body.
     - `curl` would have passed it, which is what the deploy note told you to verify with.
       curl does not enforce CSP.

   The header is the only witness. That is what this reads.

   180 unique seekers opened a challenge during those hours — the biggest inbound burst of the
   week — and got a dead page. This check costs one request.

   HOW TO GET THE FULL CHECK. Set the repo variable KAMO_CANARY_HIDE to the id of a hide you
   never delete, and the per-hide og:image assertion turns on too — that is the whole reason
   the Worker exists (344 of the first 504 challenges were never opened, because a static
   <head> gave every link the same picture). Without it this still catches the outage that
   happened, which is the part that was unwatched. */
const CHALLENGE_CANARY = process.env.KAMO_CANARY_HIDE || '';
const CHALLENGE = process.env.KAMO_WATCH_CHALLENGE
  ? JSON.parse(process.env.KAMO_WATCH_CHALLENGE)
  /* Skipped when the origins are overridden without it — that combination is only ever
     scripts/test-watchdog.mjs driving a local server, and reaching out to the real
     playkamo.com from inside a unit test would make it fail on a train. */
  : (process.env.KAMO_WATCH_ORIGINS ? null
    : { name: 'challenge link', url: 'https://playkamo.com/h/' + CHALLENGE_CANARY });

if (CHALLENGE) {
  let res, body;
  try {
    res = await fetch(CHALLENGE.url + '?wd=' + Date.now(), { redirect: 'manual' });
    body = await res.text();
  } catch (e) {
    bad(`${CHALLENGE.name} (${CHALLENGE.url}) — request failed: ${e.message}`);
    res = null;
  }
  if (res) {
    if (res.status >= 300 && res.status < 400) {
      bad(`${CHALLENGE.name} REDIRECTS (${res.status}) to ${res.headers.get('location') || '(none)'}\n`
        + '    Every challenge ever sent points here. A redirect means the Worker route stopped\n'
        + '    matching and Pages is answering /h/* with its 404.');
    } else if (!res.ok) {
      bad(`${CHALLENGE.name} returned HTTP ${res.status} — every challenge link is dead`);
    } else {
      ok(`${CHALLENGE.name} answers HTTP 200`);

      /* THE 2026-08-12 SIGNATURE. Not "a policy we dislike" — ANY policy. CSPs stack
         restrictively in the browser, so a second one cannot loosen the gateway's sandbox;
         the only correct state is the header being absent, which is what the Worker
         enforces by deleting it. Reading it back is how we know the Worker still runs at
         all: if the route stops matching, the header returns with it. */
      for (const h of ['content-security-policy', 'content-security-policy-report-only']) {
        const v = res.headers.get(h);
        if (v) {
          bad(`${CHALLENGE.name} carries ${h}: ${v}\n`
            + '    THIS IS THE 2026-08-12 BLANK-PAGE OUTAGE. The body is fine and every scraper\n'
            + '    is happy; browsers sandbox the document and run none of it, so a human who\n'
            + '    taps the link sees white. Check that the Worker on playkamo.com/h/* is still\n'
            + '    deployed and still deleting this header (infra/playkamo-worker.js).');
        } else ok(`  ${CHALLENGE.name}: no ${h} — the document is not sandboxed`);
      }

      /* The link preview is the entire reason this path is not just GitHub Pages. A <head>
         that lost its og: tags is a silent return to one picture for every challenge. */
      body.includes('og:title')
        ? ok('  challenge link: the per-hide <head> still renders og: tags')
        : bad(`${CHALLENGE.name} served no og:title — link previews are back to the static head,\n`
          + '    which is the state in which 344 of the first 504 challenges were never opened.');

      if (CHALLENGE_CANARY) {
        /(<meta[^>]+og:image[^>]+\.jpg)/i.test(body)
          ? ok('  challenge link: the canary hide still resolves to its own photo')
          : bad(`${CHALLENGE.name} has no per-hide og:image .jpg for canary ${CHALLENGE_CANARY} —\n`
            + '    either the hide was deleted (pick another and update KAMO_CANARY_HIDE) or the\n'
            + '    edge function stopped resolving photos.');
      }
    }
  }
}

console.log(failed ? `\n✗ ${failed} problem(s) — KAMO IS BROKEN IN PRODUCTION` : '\n✓ production is healthy');
process.exit(failed ? 1 : 0);
