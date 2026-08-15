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
async function run({ nativeInvite, share, clipboardOk = true, chId = 'abc123', settings = {}, handle = '', score = 40, slotId = 'dddddddddddddddd', replyTo = '', replyName = '' }) {
  const calls = { native: 0, webShare: 0, clipboard: 0, events: [], text: null, markedSent: 0, waited: 0, sheetClosed: 0, hints: [] };
  /* classList and textContent are real here because the reply path is the one send whose ONLY
     visible result is on this button — no sheet opens and no screen moves, so the label and
     the state classes are the whole of the feedback. */
  const cls = new Set();
  const btn = { innerHTML: 'Send to a friend', textContent: 'Send to a friend', onclick: null, disabled: false,
    classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c), contains: (c) => cls.has(c) } };

  const env = {
    haptic: () => {},
    currentScore: score,
    /* THE REPLY BRANCH IS THE FIRST THING THE HANDLER READS, so it has to exist in this
       sandbox or every case below dies on a ReferenceError before reaching the path it is
       about. Empty by default: these cases are ordinary sends. A reply never touches
       navigator.share or postNative at all — it is delivered by being published — so it has
       its own case at the bottom rather than a flag threaded through these. */
    chReplyTo: replyTo,
    chReplyName: replyName,
    /* The handler reads chId directly now (the reply branch stamps without waiting when the
       publish already landed), so the sandbox has to carry it the way the module does. */
    chId,
    /* The publish floor and its escape hatch — the handler refuses to wait for an upload
       that chUpload() will never run, closes the sheet and routes to the brush. */
    CH_MIN_COVERAGE: 30,
    closeShareSheet: () => { calls.sheetClosed++; },
    roundSeconds: () => 12,
    shareMode: 'ba',
    track: (n, p) => calls.events.push([n, p]),
    trackCarried: () => {},
    nativeCaps: nativeInvite ? { invite: true } : {},
    postNative: (o) => { calls.native++; calls.text = o.message; return true; },
    chEffective: () => ({ limit: settings.limit || 20, taps: settings.taps || 5, custom: false }),
    chLink: () => (chId ? 'https://anthonyhdd.github.io/kamo/?h=' + chId : ''),
    /* The one-per-hide "One moment" deferral. A parameter rather than a closure variable
       because the handler ASSIGNS to it, and `new Function` parameters are assignable — a
       const in this object would throw the moment the fallback fired. */
    chInviteNudged: false,
    /* The id the client minted at chSlot(), available before create_hide answers. Distinct
       from chLink() on purpose: these tests need to prove WHICH of the two a given branch
       reached for, and a shared stub could not tell them apart. */
    chSlotLink: () => (slotId ? 'https://playkamo.com/h/' + slotId : ''),
    /* The upload wait. Counted, not silently stubbed: which path is allowed to await is the
       whole point of it. The native sheet goes through postNative and carries no
       user-activation debt, so it CAN hold for the id. navigator.share cannot — the first
       await spends the activation the tap granted and WebKit refuses the sheet. A version
       of this that waited on the web path would kill the share for everyone on 1.0.2. */
    chAwaitId: async () => { calls.waited++; return chId; },
    inviteUrl: () => 'https://anthonyhdd.github.io/kamo/?i=1',
    chCopy: async (t) => { calls.clipboard++; calls.text = t; return clipboardOk; },
    /* Stamps the hide as actually sent. Counted rather than stubbed silently: it runs on the
       send path, so a version of it that threw would take the share down with it. */
    chMarkSent: () => { calls.markedSent++; },
    /* The handle signs the invite. Stubbed rather than reading localStorage so the two cases
       that matter — signed and unsigned — are both reachable in one process. */
    getHandle: () => handle,
    showHint: (t) => { calls.hints.push(t); },
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

/* UNDER THE PUBLISH FLOOR THE SEND STILL GOES OUT — IT JUST DOES NOT WAIT.
 *
 * THIS BLOCK ASSERTED THE OPPOSITE UNTIL 2026-08-13, and it was wrong about the rule rather
 * than about the code. The floor refused the send outright: no share, no stamp, sheet closed,
 * back to the brush. It fired on over a third of everyone who finished a round, and the
 * founder's standing rule is that there is never a mandatory paint percentage to share.
 *
 * What was RIGHT in the old block is kept: nothing may wait. chUpload() still refuses to
 * publish an unpainted hide — the challenge link's og:image would spoil the answer in the
 * thread — so no id is ever coming, and an 8s "Preparing your challenge…" would burn in full
 * before sending the invite anyway. That wait is the real defect the refusal was papering
 * over, and removing the door without removing the wait would ship the worse of both.
 *
 * So the shape under the floor is: send immediately, as the invite, waiting for nothing. */
console.log('\nBELOW THE PUBLISH FLOOR, THE SEND GOES OUT — IMMEDIATELY, AS THE INVITE');
{
  const { calls } = await run({ nativeInvite: true, share: 'ok', score: 0 });
  calls.native === 1 && calls.markedSent === 1
    ? ok(`unpainted hide still sends (${label(calls)} sent:${calls.markedSent})`)
    : bad(`an unpainted hide did not send — ${label(calls)} sent:${calls.markedSent}.\n`
      + '    That is a mandatory paint percentage to share, which is ruled out.');
  calls.waited === 0
    ? ok('...and waits for nothing — no challenge id is coming')
    : bad(`the send waited ${calls.waited} time(s) for an id chUpload() will never create — the\n`
      + '    button holds at "Preparing your challenge…" for 8s and then sends the invite anyway');
  /* THE MESSAGE IS WHERE HONESTY LIVES NOW. Under the floor there is no puzzle, so the text
     must not announce one — otherwise the friend taps a link and finds nothing hidden, which
     is the failure the floor was really guarding against. */
  !/hid a body|hid a kamo|body hidden|kamo hidden|One tap to find/.test(calls.text || '')
    ? ok('...and the text promises no puzzle, because there is not one')
    : bad(`an unpainted hide announced a body in the photo: ${JSON.stringify(calls.text)}`);
}
{
  /* The web path has its own way of failing this: a nudge that spends the tap asking for a
     second one once the link lands. Under the floor no link ever lands, so that nudge is the
     old dead end wearing a politer sentence. */
  const { calls } = await run({ nativeInvite: false, share: 'ok', score: 0 });
  calls.webShare === 1 || calls.clipboard === 1
    ? ok('the web path sends on the first tap too, rather than nudging for a link that is not coming')
    : bad(`the web path sent nothing on an unpainted hide — ${label(calls)}`);
}
{
  /* And the floor is a FLOOR, not a switch that broke sending: at 30 everything works. */
  const { calls } = await run({ nativeInvite: true, share: null, score: 30 });
  calls.native === 1
    ? ok('at the floor exactly, the share goes out')
    : bad(`score 30 blocked — ${label(calls)}`);
}

console.log('\nTHE MESSAGE MATCHES THE ROUND THE RECEIVER WILL PLAY');
{
  /* One tap on no clock is the ONLY deal the seeker runs, so the message states it and
     quotes no numbers — a quoted "35 sec and 3 taps" would promise a round that no longer
     exists, which is the exact class of bug the old assertions were written against. */
  const { calls } = await run({ nativeInvite: true, share: null });
  const t = calls.text || '';
  t.includes('One tap')
    ? ok('the message states the one-tap deal')
    : bad(`the one-tap deal is missing from the message: ${JSON.stringify(t)}`);
  !/\d+\s*sec/.test(t) && !/\d+\s*taps?/.test(t)
    ? ok('and it quotes no seconds or taps — those knobs no longer exist')
    : bad(`the message still quotes a clock or a tap budget: ${JSON.stringify(t)}`);
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

/* ONLY THE NATIVE PATH MAY WAIT FOR THE UPLOAD.
   chUpload() is fire-and-forget and takes seconds on a phone network. That was invisible
   while the sheet only opened on a tap; since it presents itself on the reveal, a fast
   tapper reached the send before chId existed and the message fell through to the ?i=1
   invite — a link with no game in it. Nothing recorded it, because the upload never failed.
   The fix waits for the id, but it MUST NOT wait on the web path: navigator.share needs the
   user activation this tap granted and the first await spends it. Both halves are pinned
   here, because getting either one wrong is silent in production. */
console.log('\nONLY THE NATIVE PATH WAITS FOR THE UPLOAD');
{
  const { calls } = await run({ nativeInvite: true, share: 'ok' });
  calls.waited === 1
    ? ok('native path waits for chId before building the message')
    : bad(`native path did not wait (waited:${calls.waited}) — fast taps will send ?i=1 again`);
}
{
  const { calls } = await run({ nativeInvite: false, share: 'ok' });
  calls.waited === 0
    ? ok('web path does NOT wait — the activation navigator.share needs survives')
    : bad(`web path awaited (waited:${calls.waited}) — this spends the user activation and WebKit refuses the sheet`);
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

/* THE CHALLENGE IS SIGNED, AND ONLY WHEN THERE IS A NAME.
   This is the whole reason the handle is not decoration: a field that only ever shows itself
   back to the person who filled it is the flaw that got the three stat tiles deleted. And the
   unsigned case has to keep working exactly as it always did — most people will never set a
   handle, and a placeholder like "someone" in their message would be a regression they never
   asked for. */
console.log('\nTHE INVITE CARRIES THE HANDLE');
{
  const { calls } = await run({ nativeInvite: true, share: null, handle: 'tony' });
  /@tony hid a kamo in this pic/.test(calls.text || '')
    ? ok('a set handle signs the challenge')
    : bad(`the handle did not reach the message: ${JSON.stringify(calls.text)}`);
  !/@@|@undefined|@null/.test(calls.text || '')
    ? ok('and the @ is not doubled')
    : bad(`the @ prefix is duplicated or the value leaked: ${JSON.stringify(calls.text)}`);
}
{
  const { calls } = await run({ nativeInvite: true, share: null, handle: '' });
  /Someone hid a kamo in this pic/.test(calls.text || '') && !/@/.test((calls.text || '').split('\n')[0])
    ? ok('no handle → the line that has always shipped, with no placeholder')
    : bad(`the unsigned invite changed: ${JSON.stringify(calls.text)}`);
}
{
  /* Still the stake and still the link — signing must not have displaced either. */
  const { calls } = await run({ nativeInvite: true, share: null, handle: 'tony' });
  /One tap/.test(calls.text || '') && /\?h=abc123/.test(calls.text || '')
    ? ok('the stake and the link survive the signature')
    : bad(`signing displaced the stake or the link: ${JSON.stringify(calls.text)}`);
}

/* ---- THE RACE THE WEB BRANCH CANNOT ENTER -------------------------------------------------
   `invite_shared` with link=false ran 13 times on 2026-08-12 and 7 on 08-13, and those are
   NOT the deliberate under-the-floor sends — share_target_tapped with bare=true was zero on
   both days. They are this: the thumb landing inside the 3-6s create_hide takes, on the one
   branch that cannot wait for it, because navigator.share needs the user activation the first
   await spends.
   chSlot() now mints the id up front, so the link is knowable with no round trip.
   WHICH BRANCH MAY USE IT IS THE WHOLE DESIGN, and it is what these four cases pin down.
   create_hide fails on ~2.7% of publishes and the guessed link 404s on exactly those, so it
   is only ever the right call where the alternative is the generic invite going out this
   instant with no game in it. The native branch has already waited 8s and must never touch
   it. */
console.log('\nTHE WEB SHARE STOPS LOSING THE RACE TO create_hide');
{
  const { calls } = await run({ nativeInvite: false, share: 'ok', chId: '', handle: 'tony' });
  /playkamo\.com\/h\/dddddddddddddddd/.test(calls.text || '')
    ? ok('no id yet, web branch → sends the minted link instead of the generic invite')
    : bad(`the web branch still sent a link-less invite: ${JSON.stringify(calls.text)}`);
  /hid a kamo in this pic/.test(calls.text || '')
    ? ok('...and promises the puzzle, because there really is one coming')
    : bad(`the message did not describe a challenge: ${JSON.stringify(calls.text)}`);
  const ev = calls.events.find((e) => e[0] === 'invite_shared');
  ev && ev[1].link === true && ev[1].optimistic === true
    ? ok('...and reports it as optimistic, so a guessed link stays separable from a real one')
    : bad(`invite_shared did not mark the guess: ${JSON.stringify(ev && ev[1])}`);
}
{
  /* THE NATIVE BRANCH MUST NOT. It waited 8s for the real id; reaching for a guess here would
     trade a link that is certainly right for one that is 97% right, for nothing. */
  const { calls } = await run({ nativeInvite: true, share: null, chId: '', handle: 'tony' });
  !/playkamo\.com\/h\//.test(calls.text || '')
    ? ok('the native branch never guesses — it waited for the real id and takes the invite')
    : bad(`the native path used the optimistic link: ${JSON.stringify(calls.text)}`);
}
{
  /* A REAL LINK ALWAYS WINS. The guess exists to fill a hole, not to replace the answer. */
  const { calls } = await run({ nativeInvite: false, share: 'ok', chId: 'abc123', handle: 'tony' });
  /\?h=abc123/.test(calls.text || '') && !/playkamo\.com\/h\//.test(calls.text || '')
    ? ok('once the id has landed the published link wins over the guess')
    : bad(`the guess displaced a real link: ${JSON.stringify(calls.text)}`);
  const ev = calls.events.find((e) => e[0] === 'invite_shared');
  ev && ev[1].optimistic === false
    ? ok('...and is reported as not optimistic')
    : bad(`a real link was marked optimistic: ${JSON.stringify(ev && ev[1])}`);
}
{
  /* UNDER THE FLOOR, NOTHING IS COMING. chSlot() returns null below CH_MIN_COVERAGE, so there
     is no id to guess with — and a bare hide must still go out as the honest invite rather
     than promising a puzzle that was never published. */
  const { calls } = await run({ nativeInvite: false, share: 'ok', chId: '', slotId: '', score: 10 });
  !/playkamo\.com\/h\//.test(calls.text || '') && /paint yourself into the background/.test(calls.text || '')
    ? ok('a bare hide still sends the honest invite — no link is guessed under the floor')
    : bad(`a bare hide promised a puzzle: ${JSON.stringify(calls.text)}`);
}

/* A REPLY DELIVERS ITSELF, AND MUST NOT OPEN A PICKER.
   create_hide carries p_reply_to and the original creator reads it back through my_replies —
   the address is already known, so handing the user iOS's sheet asks them to choose a
   recipient the app has had all along, and every tap in that sheet is a chance to back out of
   a message that was already addressed. Founder's report, 2026-08-15. */
{
  const r = await run({ nativeInvite: true, share: 'ok', replyTo: 'hide-42', replyName: 'tony' });
  r.calls.native === 0 && r.calls.webShare === 0
    ? ok('a reply opens no share sheet at all — neither native nor navigator.share')
    : bad(`a reply reached for a picker: native=${r.calls.native} webShare=${r.calls.webShare}`);
  r.calls.markedSent === 1
    ? ok('and it is stamped as sent, which is what puts it in front of the creator')
    : bad(`chMarkSent ran ${r.calls.markedSent} times on a reply`);
  r.calls.events.some((e) => (Array.isArray(e) ? e[0] : e) === 'reply_sent')
    ? ok('and reported as reply_sent, so replies stop being counted as ordinary shares')
    : bad(`a reply fired ${JSON.stringify(r.calls.events)}`);
  /* THE BUTTON IS ITS OWN RECEIPT. Nothing else on screen changes — no sheet opens, no screen
     pushes — so if the label does not answer, the send is indistinguishable from a dead tap. */
  /tony/.test(String(r.btn.textContent || ''))
    ? ok(`and the button says who it went to ("${r.btn.textContent}")`)
    : bad(`the button reads ${JSON.stringify(r.btn.textContent)} — a silent send on a screen `
        + 'that does not move reads as a button that did nothing');
}

console.log(failed ? `\n✗ ${failed} failure(s)` : '\n✓ share paths behave');
process.exit(failed ? 1 : 0);
