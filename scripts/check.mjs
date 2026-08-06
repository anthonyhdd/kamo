#!/usr/bin/env node
/**
 * PRE-PUSH CHECK — and it is pre-push on purpose.
 *
 * This repo deploys on push: GitHub Pages serves index.html to every live user within
 * minutes, and the app's WebView refetches it on every launch. A CI job that runs after the
 * push runs after the damage. So the gate has to be here, on the machine doing the pushing,
 * and it has to be run every single time.
 *
 * What it covers is not "everything" — it is the failure modes that are SILENT and TOTAL:
 * a syntax error anywhere in the inline script kills the whole app for everyone at once,
 * and a missing element id kills one screen with no error a user could report usefully.
 *
 *   node scripts/check.mjs
 */
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');

let failed = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { failed++; console.error('  ✗ ' + m); };

/* ---- 1. Every inline script must parse -------------------------------------------------
   The one failure that takes the entire app down at once, for everyone, in two minutes. */
const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
if (!scripts.length) bad('no inline <script> found — did the file structure change?');
scripts.forEach((src, i) => {
  const tmp = join(tmpdir(), `kamo-check-${process.pid}-${i}.mjs`);
  writeFileSync(tmp, src);
  try {
    execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' });
    ok(`script block ${i} parses (${src.length} chars)`);
  } catch (e) {
    bad(`script block ${i} has a SYNTAX ERROR:\n${(e.stderr || '').toString().split('\n').slice(0, 6).join('\n')}`);
  } finally {
    try { unlinkSync(tmp); } catch {}
  }
});

/* ---- 2. Every id the script addresses must exist in the markup -------------------------
   $("#x").onclick = ... on a missing element throws at load and takes the app with it;
   a getElementById that returns null usually just kills one screen in silence. Both are
   worth catching here rather than from a one-star review. */
const declared = new Set([...html.matchAll(/\bid="([A-Za-z0-9_-]+)"/g)].map((m) => m[1]));
/**
 * ONLY UNGUARDED DEREFERENCES COUNT, i.e. `$("#x").something` — a lookup that throws the
 * moment the element is absent.
 *
 * Flagging every mention was the first version and it reported #paintBadge and #autoSw,
 * both of which are elements this app deliberately REMOVED and whose surviving references
 * are all null-guarded (`const el=$("#"+id); if(el)`, `if(!a) return;`). That is correct
 * code, and a check that calls it a failure is a check people learn to skip — which costs
 * more than it ever catches.
 */
const deref = new Set([
  ...[...html.matchAll(/\$\("#([A-Za-z0-9_-]+)"\)\s*\./g)].map((m) => m[1]),
  ...[...html.matchAll(/getElementById\("([A-Za-z0-9_-]+)"\)\s*\./g)].map((m) => m[1]),
]);
// Built by JS at runtime rather than declared in the markup — listed, not guessed.
const RUNTIME_IDS = new Set(['ivPrev', 'chPPh', 'chSetH', 'chSetS', 'chSetT']);
const missing = [...deref].filter((id) => !declared.has(id) && !RUNTIME_IDS.has(id));
missing.length
  ? bad(`script dereferences ids that do not exist, unguarded: ${missing.join(', ')}`)
  : ok(`all ${deref.size} unguarded id dereferences resolve`);

/* ---- 3. notif.json ---------------------------------------------------------------------
   The app parses this at launch. It tolerates a malformed file by design, but a typo that
   silently reverts a correction is exactly the kind of thing this file exists to prevent. */
try {
  const cfg = JSON.parse(readFileSync(join(ROOT, 'notif.json'), 'utf8'));
  if (cfg.enabled === false) bad('notif.json has enabled:false — the daily reminder is OFF for everyone');
  else if (!Array.isArray(cfg.messages) || !cfg.messages.length) bad('notif.json has no messages array');
  else if (cfg.windowStartHour > cfg.windowEndHour) bad('notif.json window start is after its end');
  else ok(`notif.json valid (${cfg.messages.length} messages, ${cfg.windowStartHour}:00-${cfg.windowEndHour}:59)`);
} catch (e) {
  bad('notif.json does not parse: ' + e.message);
}

/* ---- 4. The reveal scrim must stay monotonic and start transparent ---------------------
   This is the seam that shipped twice. The band shrank while the stops stayed put, and the
   ramp got steeper every redesign until it drew a visible edge across the photo. Assert the
   shape rather than trusting the next person to remember the history. */
// Window widened from 600: the stops are now separated by the comment explaining why the
// final one is opaque, and a check that silently stops finding its target is worse than none.
const scrim = html.match(/const bh=Math\.round\(H\*([\d.]+)\);\s*let bg=c\.createLinearGradient[\s\S]{0,2000}?c\.fillRect\(0,H-bh,W,bh\)/);
if (!scrim) bad('could not find the watermark scrim — the check needs updating, or it was removed');
else {
  const stops = [...scrim[0].matchAll(/addColorStop\(([\d.]+),"rgba\(\d+,\d+,\d+,([\d.]+)\)"\)/g)]
    .map((m) => [parseFloat(m[1]), parseFloat(m[2])]);
  const band = parseFloat(scrim[1]);
  const alphaAt = (f) => {
    for (let i = 1; i < stops.length; i++) {
      if (f <= stops[i][0]) {
        const [x0, y0] = stops[i - 1], [x1, y1] = stops[i];
        return y0 + ((f - x0) / (x1 - x0)) * (y1 - y0);
      }
    }
    return stops[stops.length - 1][1];
  };
  if (stops[0][1] !== 0) bad(`scrim starts at alpha ${stops[0][1]} — it must start fully transparent`);
  else if (stops.some((s, i) => i && s[1] < stops[i - 1][1])) bad('scrim alpha is not monotonic — it lightens somewhere');
  else {
    // 120 physical px below the top of the band, on the reported 2622px-tall screenshot.
    // The version that drew the seam measured .359 here.
    const a = alphaAt(120 / (band * 2622));
    if (a > 0.08) {
      bad(`scrim reaches alpha ${a.toFixed(3)} only 120px in — that is the visible seam again (must stay under .08)`);
    } else {
      ok(`scrim onset gentle (alpha ${a.toFixed(3)} at 120px, band ${band}H)`);
      /* THE OTHER END, which is where the seam actually lived. A gentle onset that stops at
         .93 still leaves 7% of the photo in the canvas's last row against a flat #05060a
         page — invisible on a dark photo, a hard line on a bright one. The final stop must
         be fully opaque AND the same colour as --bg. */
      const last = stops[stops.length - 1];
      const bgVar = (html.match(/--bg:\s*#([0-9a-f]{6})/i) || [])[1];
      const lastRgb = (scrim[0].match(/addColorStop\([\d.]+,"rgba\((\d+),(\d+),(\d+),[\d.]+\)"\)(?![\s\S]*addColorStop)/) || []).slice(1, 4);
      const bgRgb = bgVar ? [parseInt(bgVar.slice(0, 2), 16), parseInt(bgVar.slice(2, 4), 16), parseInt(bgVar.slice(4, 6), 16)] : null;
      if (last[1] !== 1) {
        bad(`scrim ends at alpha ${last[1]} — the last row of the photo still shows through against the page, `
          + 'which is the seam on any bright image. It must reach 1.');
      } else if (bgRgb && lastRgb.length === 3 && lastRgb.map(Number).join() !== bgRgb.join()) {
        bad(`scrim ends opaque on rgb(${lastRgb.join(',')}) but --bg is rgb(${bgRgb.join(',')}) — they must match exactly`);
      } else ok(`scrim closes opaque on the page background (rgb(${lastRgb.join(',')}))`);
    }
  }
}

/* ---- 5. Publishing flag ----------------------------------------------------------------
   CH_MAKE governs whether opening the share sheet creates a real, public, playable link. */
const chMake = html.match(/const CH_MAKE=(true|false)/);
chMake ? ok(`CH_MAKE=${chMake[1]}`) : bad('CH_MAKE not found');

/* ---- 5b. The peek sheet ------------------------------------------------------------------
   Static invariants, not behaviour — the state machine is DOM-bound and this repo has no
   browser to run it in. What these guard are the two ways it breaks SILENTLY:

   1. The peek publishing a photo. openShareSheet() calls chUpload() deliberately late,
      because only ~1 finished hide in 6 is ever shared and publishing every round put five
      strangers' rooms on a public URL for nothing. The peek is shown to EVERY finished
      round — so the day someone "tidies up" by moving chUpload() into peekShareSheet(),
      that regression comes straight back, and nothing user-visible changes.
   2. The peek covering the reveal. Its whole argument is that the reveal stays visible; a
      backdrop or a blur on .peek quietly turns it into the modal it was designed not to be. */
{
  const peekFn = html.match(/function peekShareSheet\(\)\{[\s\S]*?\n\}/);
  if (!peekFn) bad('peekShareSheet() not found — the reveal no longer presents the sheet?');
  else if (/chUpload\(/.test(peekFn[0])) {
    bad('peekShareSheet() calls chUpload() — that publishes a photo for EVERY finished round, '
      + 'which is the regression openShareSheet() was written to avoid');
  } else ok('peek does not publish (chUpload stays on the deliberate open)');

  /* The other half of that rule. Not publishing on presentation is right; never publishing
     is what makes "Challenge a friend" — visible in the peek — send the generic invite
     instead of a challenge, because chLink() is "" without a published hide. The upload has
     to start on the first TOUCH of the card. Both halves or neither. */
  /^[\s\S]*$/.test(html) && /ssState==="peek"\)\{\s*try\{\s*chUpload\(\)/.test(html)
    ? ok('first touch on the peek starts the upload, so the link is ready to send')
    : bad('nothing starts chUpload() when the peek is touched — Challenge a friend will send '
        + 'the generic invite instead of a challenge link');

  const peekCss = html.match(/#shareSheet\.peek\{[^}]*\}/);
  if (!peekCss) bad('#shareSheet.peek rule missing — the peek state has no styling');
  else if (!/background:transparent/.test(peekCss[0]) || !/backdrop-filter:none/.test(peekCss[0])) {
    bad(`#shareSheet.peek must clear the backdrop and blur, or it hides the reveal: ${peekCss[0]}`);
  } else if (!/pointer-events:none/.test(peekCss[0])) {
    bad('#shareSheet.peek must not take pointer events on the container — the reveal handle is behind it');
  } else ok('peek leaves the reveal visible and draggable');

  /^[\s\S]*$/.test(html) && /setTimeout\(peekShareSheet/.test(html)
    ? ok('the reveal schedules the peek')
    : bad('nothing schedules peekShareSheet() — the sheet will never present itself');
}

/* ---- 5c. The paint clock is printed on the paywall ---------------------------------------
   PAINT_SECONDS appears in the code once and in PAID COPY twice — #pwSub and PW_PITCH.time.
   Those two lines are the only place the paywall makes a checkable numeric claim, so a
   clock changed in the constant and not in the copy leaves the app advertising a number it
   does not honour. It has already drifted once (22 -> 32). Assert instead of trusting the
   comment that asks people to remember. */
{
  // Lookbehind, or this matches PRO_PAINT_SECONDS first and compares the pro clock to itself.
  const paint = html.match(/(?<!PRO_)PAINT_SECONDS=(\d+)/);
  const pro = html.match(/PRO_PAINT_SECONDS=(\d+)/);
  if (!paint || !pro) bad('PAINT_SECONDS / PRO_PAINT_SECONDS not found');
  else {
    const claims = [...html.matchAll(/(\d+)s? to paint instead of (\d+)|(\d+) seconds to paint instead of (\d+)/g)]
      .map((m) => (m[1] ? [m[1], m[2]] : [m[3], m[4]]));
    if (!claims.length) bad('no "X to paint instead of Y" line found — did the paywall copy move?');
    else {
      const wrong = claims.filter(([p, f]) => p !== pro[1] || f !== paint[1]);
      wrong.length
        ? bad(`paywall copy claims ${JSON.stringify(wrong)} but the code is free=${paint[1]}s pro=${pro[1]}s `
            + '— the paywall is advertising a clock the app does not give')
        : ok(`paint clock consistent (free ${paint[1]}s, pro ${pro[1]}s, ${claims.length} copy sites agree)`);
    }
  }
}

/* ---- 5d. Defined is not wired ------------------------------------------------------------
   Three bugs tonight had the same shape: a function that exists, is correct, and is called
   from nowhere that matters. chPrevRender() only ran after a share had already completed, so
   the permanent challenge card was a receipt. chPrevPlay/chPrevSettings shipped bound to
   nothing. chRepublish() would be the third if the call in the settings handlers were ever
   dropped — silently, because the card and the message would keep showing the new numbers
   while the friend played the old ones.
   Syntax checks and unit tests both pass on all of those. Only the wiring says otherwise. */
{
  /* Brace-matched, NOT an unbounded [\s\S]*? span. The first version of this check used one
     and passed with the call deleted: the lazy span simply ran past the end of the function
     and found the tokens somewhere else in the file. A guard that cannot fail is worse than
     no guard, because it is also reassuring. */
  /* Comments are stripped before the check. Without that, `chPrevRender()` matched the
     COMMENT inside openShareSheet explaining why chPrevRender() has to be called there —
     so deleting the actual call left the guard green. The prose that documents a call is
     not the call. `//` is only treated as a comment when it is not preceded by a colon, so
     the https:// in string literals survives. */
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const bodyOf = (start) => {
    const at = html.indexOf(start);
    if (at < 0) return null;
    const open = html.indexOf('{', at);
    let d = 0;
    for (let i = open; i < html.length; i++) {
      if (html[i] === '{') d++;
      else if (html[i] === '}') { d--; if (!d) return strip(html.slice(open + 1, i)); }
    }
    return null;
  };
  const wiring = [
    ['openShareSheet renders the challenge card', 'function openShareSheet()', 'chPrevRender()',
      'openShareSheet() does not call chPrevRender() — the card is display:none until something '
      + 'adds .on, so it will only appear after a share instead of before one'],
    ['saving challenge settings republishes the hide', 'document.getElementById("chSetOk").onclick=', 'chRepublish()',
      'the settings Done handler does not call chRepublish() — the card and the message will '
      + 'promise the new taps/clock while the published hide keeps the old ones'],
    ['resetting to automatic republishes the hide', 'document.getElementById("chSetReset").onclick=', 'chRepublish()',
      'the settings Reset handler does not call chRepublish() — same mismatch, in reverse'],
  ];
  for (const [label, start, needs, why] of wiring) {
    const body = bodyOf(start);
    if (body === null) bad(`could not locate ${start} — this check needs updating`);
    else if (!body.includes(needs)) bad(why);
    else ok(label);
  }
}

/* ---- 5e. Nothing is declared and never called ---------------------------------------------
 * The general form of 5d. Three bugs in one evening were a function that exists, is correct,
 * and is reached from nowhere — chPrevRender (the challenge card only appeared AFTER a share),
 * chPrevPlay and chPrevSettings (shipped bound to nothing), and chRepublish would have been
 * the fourth. Syntax checks pass on all of them. Unit tests pass on all of them. They are
 * invisible to everything except someone using the feature.
 *
 * 5d names three call sites, which protects those three and nothing else. This protects the
 * shape: any NEW function that nobody calls fails the gate.
 *
 * KNOWN_UNCALLED is deliberately a list of names rather than a switch. Adding to it is a
 * decision someone has to write down.
 */
{
  const scripts2 = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  let code = scripts2.join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/gm, '$1')
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, '``')
    // `...fn()` is a call. Without this the spread's trailing dot trips the "not a property
    // access" lookbehind and camSize/hdHint read as dead when they are called every launch.
    .replace(/\.\.\./g, ' ');

  /* Dead by inspection, not by accident — reported once so the list is a decision rather than
     a silence. None is a correctness bug: blobShadow is a ground shadow for the 3D character,
     captureBurst a ring flash at capture, roundRectFill a canvas helper. captureBurst is the
     one worth a second look — an effect that never fires is the same shape as the bugs above,
     it just costs polish instead of function. */
  const KNOWN_UNCALLED = new Set(['blobShadow', 'captureBurst', 'roundRectFill']);

  const declared = [...code.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]);
  // (function name(){...})() runs itself; the name is only a label for stack traces.
  const iife = new Set([...code.matchAll(/\(\s*function\s+([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]));
  const orphans = [];
  for (const name of new Set(declared)) {
    if (KNOWN_UNCALLED.has(name) || iife.has(name)) continue;
    const refs = (code.match(new RegExp(`(?<![\\w$.])${name.replace(/\$/g, '\\$')}(?![\\w$])`, 'g')) || []).length;
    const decls = (code.match(new RegExp(`\\bfunction\\s+${name.replace(/\$/g, '\\$')}\\s*\\(`, 'g')) || []).length;
    if (refs - decls === 0) orphans.push(name);
  }
  orphans.length
    ? bad(`declared but never called: ${orphans.join(', ')}\n    Every feature bug tonight had this shape. `
        + 'Wire it up, delete it, or add it to KNOWN_UNCALLED with a reason.')
    : ok(`no orphan functions (${new Set(declared).size} declared, ${KNOWN_UNCALLED.size} known-dead allowed)`);
}

/* ---- 5f. Runtime ids belong to the function that builds them -----------------------------
 * The third "wired to the wrong place" bug of the night, and the first two checks were blind
 * to it. chPPsend and chPPx0 are built by chPrevPlay's innerHTML, and their handlers were
 * being assigned inside forceFreeAsk — the founder passphrase prompt, a different overlay
 * entirely. getElementById returned null there, .onclick threw, and the throw landed BEFORE
 * that prompt wired its own OK and Cancel, so both of ITS buttons died too. One misplaced
 * paste, two broken screens, and nothing static could see it: check 2 builds its list of
 * declared ids with an id="..." regex over the whole file, which happily matches ids written
 * inside a JS string — so an element that exists only while one overlay is open reads as
 * "declared" everywhere.
 *
 * The rule that actually holds: an id created inside a script may only be dereferenced from
 * the same top-level function that creates it. Nested helpers are fine — they close over the
 * same DOM — so enclosing scope is resolved to the outermost function, which is why this
 * matches on `^function name(` at column zero.
 */
{
  const firstScript = html.search(/<script(?![^>]*\bsrc=)[^>]*>/);
  const markup = html.slice(0, firstScript < 0 ? html.length : firstScript);
  const staticIds = new Set([...markup.matchAll(/\bid="([A-Za-z0-9_-]+)"/g)].map((m) => m[1]));

  // Offsets of every top-level function, so any position can be resolved to its owner.
  const tops = [...html.matchAll(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm)]
    .map((m) => ({ at: m.index, name: m[1] }));
  const owner = (pos) => {
    let best = null;
    for (const t of tops) { if (t.at <= pos) best = t.name; else break; }
    return best;
  };

  const builtIn = new Map();   // runtime id -> function that writes it
  for (const m of html.matchAll(/\bid="([A-Za-z0-9_-]+)"/g)) {
    if (m.index < (firstScript < 0 ? html.length : firstScript)) continue;  // real markup
    if (staticIds.has(m[1])) continue;                                      // also in markup
    if (!builtIn.has(m[1])) builtIn.set(m[1], owner(m.index));
  }

  const wrong = [];
  for (const m of html.matchAll(/getElementById\("([A-Za-z0-9_-]+)"\)\s*\./g)) {
    const built = builtIn.get(m[1]);
    if (!built) continue;                    // static element, or never created here
    const from = owner(m.index);
    if (from && from !== built) wrong.push(`${m[1]} (built by ${built}, used in ${from})`);
  }
  wrong.length
    ? bad(`element built in one overlay, wired from another: ${wrong.join('; ')}\n    `
        + 'getElementById returns null there and the throw kills every handler assigned after it.')
    : ok(`runtime ids wired inside the function that builds them (${builtIn.size} checked)`);
}

/* ---- 6. The share paths -----------------------------------------------------------------
   Runs the real #ssInvite handler in the three environments it ships into. Chained here so
   there is ONE command to remember before a push — a second script you have to know about is
   a script that gets skipped. */
try {
  execFileSync(process.execPath, [join(ROOT, 'scripts', 'test-share.mjs')], { stdio: 'pipe' });
  ok('share paths behave (node scripts/test-share.mjs for the detail)');
} catch (e) {
  bad('SHARE PATHS BROKEN:\n' + (e.stdout || '').toString().split('\n').filter((l) => l.includes('✗')).join('\n'));
}

console.log(failed ? `\n✗ ${failed} problem(s) — DO NOT PUSH` : '\n✓ all checks passed');
process.exit(failed ? 1 : 0);
