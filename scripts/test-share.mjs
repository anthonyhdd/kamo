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
  const calls = { native: 0, webShare: 0, clipboard: 0, events: [], text: null };
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

console.log(failed ? `\n✗ ${failed} failure(s)` : '\n✓ share paths behave');
process.exit(failed ? 1 : 0);
