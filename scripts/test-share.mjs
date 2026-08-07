#!/usr/bin/env node
/**
 * SHARE PATH TEST — extracts the real #ssInvite handler out of index.html and runs it.
 *
 * Not a copy of the logic: the handler body is cut from the shipped file and evaluated, so
 * this fails if the file changes and the behaviour does not survive.
 *
 * What it is guarding is a bug that shipped live: postNative() and navigator.share() and the
 * clipboard all fired on the same tap, so a wrapper that handles `invite` raced the native
 * iOS sheet against WebKit's own. The invariant is EXACTLY ONE share mechanism per tap.
 *
 *   node scripts/test-share.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');

/* Cut the handler out by brace-matching from its assignment to the closing `};`. */
const start = html.indexOf('$("#ssInvite").onclick=async()=>{');
if (start < 0) throw new Error('could not find the #ssInvite handler — did it get renamed?');
const bodyStart = html.indexOf('{', start);
let depth = 0, end = -1;
for (let i = bodyStart; i < html.length; i++) {
  const c = html[i];
  if (c === '{') depth++;
  else if (c === '}') { depth--; if (!depth) { end = i; break; } }
}
if (end < 0) throw new Error('unbalanced braces in the handler');
const body = html.slice(bodyStart + 1, end);

let failed = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { failed++; console.error('  ✗ ' + m); };

/**
 * Run the handler in one simulated environment.
 * `share` describes what navigator.share does: 'ok' | 'abort' | 'throw' | null (absent).
 */
async function run({ nativeInvite, share, clipboardOk = true, chId = 'abc123', settings = {} }) {
  const calls = { native: 0, webShare: 0, clipboard: 0, events: [], text: null, markedSent: 0 };
  const btn = { innerHTML: 'Challenge a friend', onclick: null };

  const env = {
    haptic: () => {},
    currentScore: 40,
    roundSeconds: () => 12,
    shareMode: 'ba',
    track: (n, p) => calls.events.push([n, p]),
    trackCarried: () => {},
    nativeCaps: nativeInvite ? { invite: true } : {},
    postNative: (o) => { calls.native++; calls.text = o.message; return true; },
    chEffective: () => ({ limit: settings.limit || 20, taps: settings.taps || 5, custom: false }),
    chLink: () => (chId ? 'https://anthonyhdd.github.io/kamo/?h=' + chId : ''),
    inviteUrl: () => 'https://anthonyhdd.github.io/kamo/?i=1',
    chCopy: async (t) => { calls.clipboard++; calls.text = t; return clipboardOk; },
    invitePreview: () => {},
    /* Stamps the hide as actually sent. Counted rather than stubbed silently: it runs on the
       send path, so a version of it that threw would take the share down with it. */
    chMarkSent: () => { calls.markedSent++; },
    showHint: () => {},
    $: (sel) => (sel === '#ssInvite' ? btn : null),
    setTimeout: () => 0,
    navigator: {
      share: share
        ? async (payload) => {
            calls.webShare++; calls.text = payload.text;
            if (share === 'abort') { const e = new Error('cancel'); e.name = 'AbortError'; throw e; }
            if (share === 'throw') throw new Error('not allowed');
          }
        : undefined,
    },
  };

  const names = Object.keys(env);
  // eslint-disable-next-line no-new-func
  const fn = new Function(...names, `return (async()=>{${body}})()`);
  await fn(...names.map((n) => env[n]));
  return { calls, btn };
}

const label = (c) => `native:${c.native} webShare:${c.webShare} clipboard:${c.clipboard}`;

console.log('\nEXACTLY ONE share mechanism per tap');
{
  const { calls } = await run({ nativeInvite: true, share: 'ok' });
  calls.native === 1 && calls.webShare === 0 && calls.clipboard === 0
    ? ok(`native build (1.0.4+) → native sheet only (${label(calls)})`)
    : bad(`native build fired more than the native sheet — ${label(calls)}`);
}
{
  const { calls } = await run({ nativeInvite: false, share: 'ok' });
  calls.native === 0 && calls.webShare === 1 && calls.clipboard === 0
    ? ok(`old wrapper / browser, share works → web sheet only (${label(calls)})`)
    : bad(`web share path fired something else — ${label(calls)}`);
}
{
  const { calls } = await run({ nativeInvite: false, share: 'abort' });
  calls.clipboard === 0
    ? ok('user cancels the web sheet → nothing is copied behind their back')
    : bad('cancelling the sheet still wrote to the clipboard');
}
{
  const { calls } = await run({ nativeInvite: false, share: 'throw' });
  calls.webShare === 1 && calls.clipboard === 1
    ? ok(`sheet refuses to open → falls through to the clipboard (${label(calls)})`)
    : bad(`broken web share did not reach the clipboard — ${label(calls)}`);
}
/* THE HIDE IS STAMPED SENT ON EVERY PATH, EXACTLY ONCE.
   `sent_at` is what separates the 62 hides someone actually sent from the 456 that were
   published by touching the sheet and abandoned — the whole reason the column exists. It is
   called before the branch on purpose: a native sheet, a web sheet and a clipboard copy are
   three ways of sending the same link, and iOS never reports back which of them succeeded.
   Guarded because "move it into the branch you are editing" is the natural refactor, and it
   would silently stop counting two thirds of the sends. */
{
  const paths = [
    ['native sheet', { nativeInvite: true, share: 'ok' }],
    ['web sheet', { nativeInvite: false, share: 'ok' }],
    ['web sheet cancelled', { nativeInvite: false, share: 'abort' }],
    ['clipboard fallback', { nativeInvite: false, share: null }],
  ];
  const wrong = [];
  for (const [name, args] of paths) {
    const { calls } = await run(args);
    if (calls.markedSent !== 1) wrong.push(`${name}: ${calls.markedSent}`);
  }
  wrong.length
    ? bad(`the hide is not stamped exactly once on every send path — ${wrong.join(', ')}`)
    : ok(`the hide is stamped sent once on all ${paths.length} send paths`);
}
{
  const { calls } = await run({ nativeInvite: false, share: null });
  calls.webShare === 0 && calls.clipboard === 1
    ? ok(`no navigator.share at all → clipboard only (${label(calls)})`)
    : bad(`no-share environment misbehaved — ${label(calls)}`);
}

console.log('\nTHE MESSAGE MATCHES THE ROUND THE RECEIVER WILL PLAY');
{
  const { calls } = await run({ nativeInvite: true, share: null, settings: { limit: 35, taps: 3 } });
  const t = calls.text || '';
  t.includes('35 sec') && t.includes('3 taps')
    ? ok('custom 35s / 3 taps → quoted in the message')
    : bad(`custom settings not in the message: ${JSON.stringify(t)}`);
}
{
  const { calls } = await run({ nativeInvite: true, share: null, settings: { limit: 30, taps: 1 } });
  (calls.text || '').includes('1 tap') && !(calls.text || '').includes('1 taps')
    ? ok('a single tap is singular, not "1 taps"')
    : bad(`plural bug: ${JSON.stringify(calls.text)}`);
}
{
  const { calls } = await run({ nativeInvite: true, share: null });
  (calls.text || '').includes('?h=abc123')
    ? ok('the published hide is the link')
    : bad(`link missing: ${JSON.stringify(calls.text)}`);
}
{
  // chUpload() is fire-and-forget; a failed upload leaves chId empty.
  const { calls } = await run({ nativeInvite: true, share: null, chId: '' });
  const t = calls.text || '';
  !t.includes('hidden in this photo') && !t.includes('to find it') && t.includes('?i=1')
    ? ok('upload failed → invites instead of promising a puzzle that does not exist')
    : bad(`no-hide message still promises a challenge: ${JSON.stringify(t)}`);
}

console.log('\nTHE LINK IS ALWAYS ON ITS OWN LINE (messaging apps only linkify it there)');
for (const chId of ['abc123', '']) {
  const { calls } = await run({ nativeInvite: true, share: null, chId });
  const lines = (calls.text || '').split('\n');
  const url = lines.findIndex((l) => l.startsWith('https://'));
  url > 0 && lines[url].trim() === lines[url] && lines[url - 1] === ''
    ? ok(`${chId ? 'challenge' : 'invite'} message: url isolated on its own line`)
    : bad(`${chId ? 'challenge' : 'invite'} message url is not isolated: ${JSON.stringify(calls.text)}`);
}

/* ---- chRepublish -------------------------------------------------------------------------
   The gear lives inside the share sheet, but the hide is published when that sheet OPENS.
   So changing the taps or the clock happens after the round behind the link is already
   fixed, and only the sender-visible copy moved: the card and the message promised the new
   numbers while the friend played the old ones. Nothing reported it. */
function extractFn(name) {
  const at = html.indexOf(`function ${name}(`);
  if (at < 0) throw new Error(`${name}() not found`);
  const open = html.indexOf('{', at);
  let d = 0, end = -1;
  for (let i = open; i < html.length; i++) {
    if (html[i] === '{') d++;
    else if (html[i] === '}') { d--; if (!d) { end = i; break; } }
  }
  return html.slice(open + 1, end);
}

async function republish({ chId, uploadSets }) {
  /* chId is a module-level `let` that chRepublish both reads and assigns, and chUpload
     assigns too. Reproduce that exactly: one binding in a closure the real body sees, with
     the body wrapped in its own function so its early `return` does not escape. */
  /* chUpload is declared INSIDE the generated scope so it assigns the same chId binding the
     real one does. Passing it in from outside cannot work: chRepublish calls it
     synchronously, before any handle returned by the factory exists. */
  let uploads = 0;
  const factory = new Function('CH_MAKE', 'initialId', 'uploadSets', 'onUpload', `
    let chId = initialId;
    async function chUpload(){ onUpload(); if (uploadSets !== null) chId = uploadSets; }
    function chRepublish(){ ${extractFn('chRepublish')} }
    chRepublish();
    return () => chId;
  `);
  const read = factory(true, chId, uploadSets, () => { uploads++; });
  await new Promise((r) => setTimeout(r, 10));   // let the republish promise settle
  return { chId: read(), uploads };
}

console.log('\nCHANGING TAPS OR THE CLOCK REPUBLISHES THE HIDE');
{
  const r = await republish({ chId: '', uploadSets: 'new1' });
  r.uploads === 0
    ? ok('nothing published yet → no republish (chUpload will read the new values anyway)')
    : bad(`republished with no hide: ${JSON.stringify(r)}`);
}
{
  const r = await republish({ chId: 'old1', uploadSets: 'new1' });
  r.uploads === 1 && r.chId === 'new1'
    ? ok('already published → republished, and the link points at the new round')
    : bad(`did not republish onto a new id: ${JSON.stringify(r)}`);
}
{
  const r = await republish({ chId: 'old1', uploadSets: null });
  r.chId === 'old1'
    ? ok('republish failed → the previous link is restored rather than lost')
    : bad(`a failed republish left the sender with no link: ${JSON.stringify(r)}`);
}

console.log(failed ? `\n✗ ${failed} failure(s)` : '\n✓ share paths behave');
process.exit(failed ? 1 : 0);
