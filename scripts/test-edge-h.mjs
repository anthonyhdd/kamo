#!/usr/bin/env node
/**
 * CHALLENGE-LINK HEAD TEST — extracts the real page() out of infra/edge-h.ts and renders it.
 *
 * Not a copy of the logic: the function body is cut from the source file and evaluated, so
 * this fails if that file changes and the behaviour does not survive. Same contract as
 * test-share.mjs, and for the same reason — edge-h.ts is deployed by hand to Supabase, which
 * is exactly the kind of file that drifts from the repo unnoticed.
 *
 * WHAT IT GUARDS. playkamo.com/h/<id> is the only URL on the ranking domain that the outside
 * world ever links to, and it used to spend that on a `<link rel="canonical">` and an
 * `og:url` pointing at kamo.bliss-coach.com — an origin whose index.html is
 * `noindex,nofollow` — plus a `<meta http-equiv="refresh">` that forwarded crawlers off the
 * domain before they read anything. Naming a forbidden page as the canonical version of a
 * playkamo.com URL is the defect; these assertions are what stops it being reintroduced by
 * someone restoring "the redirect" without knowing why the tags moved.
 *
 * The two things it must NOT break while doing that: the unfurl (every og:/twitter: tag that
 * carries the photo into the thread) and the bounce (a human lands in the game in one frame).
 *
 *   node scripts/test-edge-h.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(ROOT, 'infra', 'edge-h.ts'), 'utf8');

let failed = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { failed++; console.log('  ✗ ' + m); };

/* The origins the function advertises are read from the file too — a test that hardcodes them
   passes when someone points the tags at the wrong host. */
const pick = (name) => {
  const m = src.match(new RegExp(`const ${name} = "([^"]+)"`));
  if (!m) throw new Error(`could not find const ${name} — did it get renamed?`);
  return m[1];
};
const PUBLIC = pick('PUBLIC');
const APP_STORE = pick('APP_STORE');
const SITE = pick('SITE');

/* Cut esc and page out of the source and run them as plain JS. Both carry a TS annotation in
   their signature and nothing else, so the signatures are replaced wholesale and only the
   BODIES are taken from the file — which is the part under test. Brace-matching starts after
   the parameter list, not at the first `{`: page's own parameter type is an object literal,
   and matching from there stops inside the annotation. */
const escSrc = src.slice(src.indexOf('const esc ='), src.indexOf('async function getHide'))
  .replace('(s: unknown)', '(s)');

const pStart = src.indexOf('function page(');
if (pStart < 0) throw new Error('could not find function page( — did it get renamed?');
const bodyStart = src.indexOf(') {', pStart) + 2;
let depth = 0, end = -1;
for (let i = bodyStart; i < src.length; i++) {
  const c = src[i];
  if (c === '{') depth++;
  else if (c === '}') { depth--; if (!depth) { end = i; break; } }
}
if (end < 0) throw new Error('unbalanced braces in page()');
const pageSrc = 'function page(o) ' + src.slice(bodyStart, end + 1);

/* page() closes over the module's origin constants; they are handed in as parameters rather
   than inlined, so the rendered links are whatever edge-h.ts declares them to be. */
const page = new Function('PUBLIC', 'APP_STORE',
  `${escSrc}\n${pageSrc}\nreturn page;`)(PUBLIC, APP_STORE);

/* A hide whose sender typed markup into their handle, because the handle is user input and it
   lands in a title, an alt and an og:title. */
const hostile = '@to"ny <script>alert(1)</script>';
const html = page({
  title: `${hostile} hid a kamo in here`,
  desc: 'One tap to find it.',
  image: 'https://qpztlobbnjyjbxqyuzgg.supabase.co/storage/v1/object/public/hides/abc.jpg',
  to: `${SITE}?h=deadbeef`,
  self: `${PUBLIC}/h/deadbeef`,
});

console.log('\nthe head no longer hands the domain away');
!/http-equiv="refresh"/.test(html)
  ? ok('no meta refresh — /h/ is a page, not a redirect off the ranking domain')
  : bad('a meta refresh is back: every crawl of playkamo.com/h/* forwards off-domain again');
!/rel="canonical"/.test(html)
  ? ok('no canonical — nothing points playkamo.com at a noindex origin')
  : bad('a canonical is back. If it names kamo.bliss-coach.com it consolidates the domain\'s '
      + 'only inbound signal onto a page marked noindex,nofollow');
/<meta name="robots" content="noindex,follow">/.test(html)
  ? ok('noindex,follow — kept out of the index (a hide is deleted at 30 days and would rot '
      + 'into a soft-404), but the links are still followed')
  : bad('robots is not noindex,follow — either these pages get indexed and expire, or they '
      + 'stop passing anything to playkamo.com');
html.includes(`<meta property="og:url" content="${PUBLIC}/h/deadbeef">`)
  ? ok('og:url is the page\'s own playkamo.com address, the one that was actually shared')
  : bad('og:url does not name this page — the unfurled card claims a domain the link does '
      + 'not point at');

console.log('\nthe body feeds the pages that are trying to rank');
html.includes(`href="${PUBLIC}/"`)
  ? ok('a crawlable link to the landing page')
  : bad(`no link to ${PUBLIC}/ — the share surface passes nothing to the site`);
html.includes(`href="${APP_STORE}"`)
  ? ok('a crawlable link to the App Store listing')
  : bad('no App Store link');

console.log('\nthe unfurl and the bounce still work');
for (const tag of ['og:title', 'og:description', 'og:image', 'twitter:card', 'twitter:title',
  'twitter:description', 'twitter:image']) {
  html.includes(`"${tag}"`)
    ? ok(`${tag} present`)
    : bad(`${tag} is missing — this is the 2026-08-12 regression, the photo stops reaching `
        + 'the thread');
}
html.includes(`location.replace("${SITE}?h=deadbeef")`)
  ? ok('the script bounce is intact — a human is in the game in one frame')
  : bad('the bounce is gone: with the meta refresh removed there is nothing left to move a '
      + 'human off this page');
html.includes(`href="${SITE}?h=deadbeef"`)
  ? ok('and without JS the photo carries a link that works, not a black screen')
  : bad('no link to the game in the body — a no-JS visitor is stranded');
(html.match(/<script>/g) || []).length === 1
  ? ok('exactly one script tag')
  : bad('more than one script tag in a page whose only job is to bounce');

console.log('\nuser input cannot escape its attribute');
!html.includes('<script>alert(1)</script>')
  ? ok('a handle carrying markup is escaped everywhere it lands (title, og, alt, h1)')
  : bad('the handle rendered as live markup — esc() is not reaching one of the sinks');

console.log(failed ? `\n✗ ${failed} failure(s)` : '\n✓ the challenge link keeps its domain');
process.exit(failed ? 1 : 0);
