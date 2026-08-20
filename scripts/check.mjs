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
/* ⚠️ WHY A SUITE WENT RED, AND NEVER AN EMPTY RED.
   Every block below catches its suite's non-zero exit and prints the ✗ lines out of its
   stdout. That works when an assertion failed and it produces NOTHING when the process died
   some other way — a waitForSelector timeout throwing, a browser that would not launch, a
   syntax error in the suite itself. On 2026-08-20 this printed exactly
   "✗ THE WEB FEED WALL IS IN THE WRONG PLACE:" and then a blank line, on a run whose very
   next attempt was green and whose suite passed three times standing alone.
   A gate that says DO NOT PUSH and cannot say why teaches the reader to run it again until it
   agrees with them, which is the one habit this file exists to prevent. So when there are no
   ✗ lines to show, what the process actually printed goes out instead. */
function why(e) {
  const out = ((e && e.stdout) || '').toString() + '\n' + ((e && e.stderr) || '').toString();
  const hits = out.split('\n').filter((l) => l.includes('\u2717'));
  if (hits.length) return hits.join('\n');
  const tail = out.split('\n').filter((l) => l.trim()).slice(-8).join('\n');
  return tail
    ? '    NO ASSERTION FAILED — THE SUITE DIED. Its last output:\n' + tail
    : '    it printed nothing at all (exit ' + ((e && e.status) != null ? e.status : '?') + ')';
}

/* ===== QUARANTINE, AND WHY THERE IS ONE =====================================================
   Until 2026-08-13 every DOM suite here globbed one hard-coded Linux path for its browser, so
   on the Mac where the work happens they ALL printed "skipping" and this script still ended
   with "all checks passed". A gate that reports success for a run in which it did nothing is
   worse than no gate: three PRs shipped in one evening with none of these executing.
   scripts/lib/pw.mjs fixes the resolution, and switching them on revealed that three suites
   had drifted away from the app while nobody could see them — they assert against controls
   that were deleted days ago (the share-sheet tabs, #khEdit) and against a share message that
   was deliberately rewritten. Those are not regressions; they are tests describing an app
   that no longer exists.
   They are quarantined rather than deleted, because each one covers something real and the
   assertions are worth rewriting, not throwing away. Quarantined means LOUD and NOT FATAL:
   the nine suites that do match today's app become a real gate immediately, instead of the
   whole thing staying red — or, worse, going back to being green by doing nothing.
   ⚠️ Fix one and remove it from this list in the same commit. An entry here is a debt, and an
   entry that outlives the drift it describes is how this file lied in the first place. */
/* THE QUARANTINE, AND IT IS EMPTY ON PURPOSE (2026-08-15). No suite calls stale() right now —
   the last one, test-peek-dom, was rewritten against the sheet that ships and is a hard gate
   again. The machinery stays because the alternative, when a suite genuinely does go stale, is
   that somebody comments it out, and a commented-out suite is indistinguishable from a suite
   that passes.
   THE BAR FOR USING IT: the suite's assertions describe a design that was deliberately changed,
   and you can say WHICH change, in the string. Not "it's red and I'm in a hurry" — a
   quarantine is a promise to rewrite it, and the footer below prints that promise on every
   run until somebody keeps it. */
const staleSuites = [];
const stale = (name, why) => { staleSuites.push(name); console.log(`  ! STALE — ${name}: ${why}`); };
/* ===== AND A SKIP IS STILL A PASS, WHICH IS THE OTHER HALF OF THE SAME HOLE ==================
   scripts/lib/pw.mjs made the browser findable, and `stale` made drift loud. Neither closes
   the original hole: a machine with no playwright-core still prints a `·` line, still exits 0,
   and still ends on "all checks passed" having run nothing. On a laptop that is correct —
   playwright-core is deliberately not a dependency of a repo that ships one HTML file.
   In CI it cannot be: that is the one place the browser is installed on purpose, so "not
   installed" can only mean the setup step broke. KAMO_CI=1 says so, and turns a skip into a
   failure. Unset, behaviour is exactly what it was.
   test-pass-dom is exempt: it skips for want of the live creator-pass phrase, which is a
   secret and not a browser, and no CI setup can conjure it. */
const CI = process.env.KAMO_CI === '1';
const SECRET_GATED = new Set(['test-pass-dom.mjs']);
function skipped(file, label, out) {
  const why = out.trim().split('\n').pop();
  if (CI && !SECRET_GATED.has(file)) {
    bad(`${label} DID NOT RUN — ${why}\n`
      + '    KAMO_CI=1 is set, so the browser was supposed to be there. That makes this a broken\n'
      + '    setup step rather than a skippable test.');
    return;
  }
  console.log(`  · ${label} SKIPPED — ${why}`);
}

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
const RUNTIME_IDS = new Set(['ivPrev', 'chPPh']);
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

   1. The presentation publishing a photo. openShareSheet() calls chUpload() deliberately
      late, because only ~1 finished hide in 6 is ever shared and publishing every round put
      five strangers' rooms on a public URL for nothing. The sheet presents itself on EVERY
      finished round — so the day someone "tidies up" by moving chUpload() into
      peekShareSheet(), or by handing it straight to openShareSheet(), that regression comes
      straight back and nothing user-visible changes. It came back once already, for exactly
      that reason, and was reverted.
   2. The sheet arriving FULL. It arrives short: a wall of destinations over the reveal, at
      the moment the reveal is the thing being looked at, removes the reason to share.
   3. The sheet covering the reveal with a scrim. Same argument, by a different mechanism —
      a backdrop or a blur turns this into the modal it was designed not to be. */
{
  /* COMMENTS STRIPPED FIRST. Third time this trap has been sprung: the body EXPLAINS why it
     must not call openShareSheet(), so a naive test matched its own rationale and went red on
     correct code. Every one of these checks reads code, so none of them may read prose. */
  const peekRaw = html.match(/function peekShareSheet\(\)\{[\s\S]*?\n\}/);
  const peekFn = peekRaw && [peekRaw[0].replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')];
  if (!peekFn) bad('peekShareSheet() not found — the reveal no longer presents the sheet?');
  else if (/chUpload\(/.test(peekFn[0]) || /openShareSheet\(/.test(peekFn[0])) {
    bad('peekShareSheet() publishes (directly, or via openShareSheet) — that puts a photo on a '
      + 'public URL for EVERY finished round, and it presents the full sheet over the reveal. '
      + 'Both are regressions that already shipped once');
  } else if (!/classList\.add\("peek/.test(peekFn[0])) {
    bad('peekShareSheet() does not add .peek — the sheet is no longer arriving short');
  } else if (!/kfRenderVis\(/.test(peekFn[0])) {
    /* THE SHORT SHEET MAKES A CLAIM, SO SOMETHING HAS TO WRITE IT. Since 2026-08-15 the
       headline says "Your challenge is now live!" for a public hide and "Only people you
       send it to" for a private one, and #ssSeeLive is shown or hidden on the same answer.
       All three are painted by kfRenderVis(). Skip it here and the short sheet — which is
       where most sends happen, because almost nobody swipes it open — keeps whatever the
       markup shipped with: the PUBLIC wording, over a toggle that may say Private, next to a
       "See it live" button pointing at a feed the hide is not in.
       This replaces the same assertion about chPrevRender(), which had the same shape: a peek
       whitelist for something nothing ever turned on. */
    bad('peekShareSheet() does not call kfRenderVis() — the short sheet will claim the hide is '
      + 'public whatever the toggle says, and offer "See it live" on a private hide');
  } else ok('the sheet arrives short, states the right visibility, and does not publish');

  /* The other half of that rule. Not publishing on presentation is right; never publishing
     is what makes "Send to a friend" — visible in the short state — send the generic
     invite, because chLink() is "" without a published hide. The upload has to start on the
     first TOUCH of the card. Both halves or neither. */
  /* Structural, not literal. The first version matched the exact expression
     `ssState==="peek"){try{chUpload()`, so widening the condition to cover the open state
     tripped it — a guard that fails on a correct change is a guard people start ignoring.
     What matters is that SOME pointerdown listener publishes: that is the whole invariant. */
  const pointerdowns = [...html.matchAll(/addEventListener\("pointerdown"[\s\S]{0,400}?\}\s*,\s*\{passive/g)]
    .map((m) => m[0]);
  pointerdowns.some((b) => b.includes('chUpload('))
    ? ok('touching the sheet starts the upload, so the link is ready to send')
    : bad('no pointerdown listener calls chUpload() — Send to a friend will send the generic '
        + 'invite instead of a challenge link');

  /* THE SEND AND THE PROOF ARE BOTH DIRECT CHILDREN OF THE CARD, AND THE SEND COMES FIRST.
     Moving one of these lines is the most ordinary edit on this sheet — "put X above the
     button" is a request, not a refactor — and it has already gone wrong once: the CTA landed
     INSIDE a row element that was `display:flex`, so the full-width button turned into a cell
     squeezed beside an icon. Nothing threw, no test noticed, and the diff read exactly like
     the change that was asked for.
     Two things have to hold. (1) Direct children of .ssCard — .ssCard is the column and the
     peek rule is `.ssCard > *`, so a nested button is not governed by it at all, which means
     it vanishes from the state most sends happen in. (2) #ssInvite before #ssSeeLive: the send
     is what the session is for, and "See it live" is what you do while waiting for an answer.
     Depth is counted rather than pattern-matched so this survives the markup around it
     changing. */
  {
    const cardAt = html.indexOf('<div class="ssCard');
    const btnAt = html.indexOf('id="ssInvite"');
    const liveAt = html.indexOf('id="ssSeeLive"');
    if (cardAt < 0 || btnAt < 0 || liveAt < 0) bad('.ssCard / #ssInvite / #ssSeeLive not all found in the sheet markup');
    else {
      const depthTo = (at) => {
        const between = html.slice(html.indexOf('>', cardAt) + 1, at);
        return (between.match(/<div\b/g) || []).length - (between.match(/<\/div>/g) || []).length;
      };
      const dInv = depthTo(btnAt), dLive = depthTo(liveAt);
      dInv === 0 && dLive === 0
        ? ok('#ssInvite and #ssSeeLive are direct children of .ssCard (the peek rule reaches both, full width)')
        : bad(`#ssInvite is nested ${dInv} level(s) deep and #ssSeeLive ${dLive} — anything inside a `
            + 'flex ROW renders as a squeezed cell, and `.ssCard > *` in the peek rule no longer '
            + 'governs it, so it disappears from the short sheet entirely');
      liveAt > btnAt
        ? ok('the send leads and "See it live" follows it')
        : bad('#ssSeeLive appears before #ssInvite — the sheet leads with the detour instead of the send');
      /* NO KICKER, AND NO TERMS ANYWHERE ON THIS SHEET. A kicker above the headline used to
         print "20S · 5 TAPS" while the preview card ~100px below printed the same two numbers
         as chips. Both are gone: the deal is one buzz on no clock for every hide there is, so
         the terms are a constant and the seeker screen is where they are read. The invariant
         survives them because the drift will recur the moment anything is added above the
         title. .pwKick itself stays legitimate on the paywall and on the creator's spectator
         screens, where it labels what is being shown. */
      const sheetAt = html.indexOf('<div id="shareSheet">');
      const sheetEnd = html.indexOf('<div id="confirmSheet">', sheetAt);
      const sheetHtml = sheetAt >= 0 && sheetEnd > sheetAt ? html.slice(sheetAt, sheetEnd) : '';
      !/class="pwKick"/.test(sheetHtml)
        ? ok('the share sheet quotes no terms — the round is one buzz on no clock, everywhere')
        : bad('the share sheet has a .pwKick again — it prints seconds and taps that no round '
            + 'honours any more');
      /* THE HEADLINE AND ITS GREY LINE ARE ONE UNIT, AND BOTH SURVIVE THE PEEK. The line under
         the title is the only context the notification permission prompt ever gets (see #ssSub
         in the markup): armResultsPing() fires seconds later, iOS asks exactly once, and a
         prompt with nothing in front of it gets refused. Losing it to the peek rule would be
         invisible in a diff and would cost the app its only way of telling a creator that
         somebody played their hide. */
      const peekRule = html.match(/^\s*#shareSheet\.peek \.ssCard > \*[^\n]*$/m);
      if (!peekRule) bad('the peek hide-everything rule is gone — the short sheet is no longer short');
      else {
        const named = ['.ssGrab', '.pwTitle', '.ssSub', '.ssSign', '.ssSignIn', '.ssInvite',
          '.ssSeeLive', '.ssVis', '.ssGet'];
        const missing = named.filter((c) => !peekRule[0].includes(`:not(${c})`));
        missing.length === 0
          ? ok('the short sheet keeps the headline, its notification line, the toggle and both buttons')
          : bad(`the peek rule hides ${missing.join(', ')} — anything not exempted here is, for `
              + 'practical purposes, not shipped: the swipe that opens the long sheet is a gesture '
              + 'almost nobody performs');
      }
    }
  }

  /* Checked on the BASE rule, not on .peek. The scrim used to live on the base and be undone
     by .peek; it is now absent from the base, which governs BOTH states — so asserting the
     override would pass a file that had quietly put the dim-and-blur back on .show. The
     invariant is "this sheet never darkens the reveal", and the base rule is where that is
     true or false. */
  /* Anchored to the start of a line, because "#shareSheet{" is not a unique string: any
     DESCENDANT selector ending in the sheet — `#stage.pwCover #shareSheet{...}` — ends with
     the same six characters, and an unanchored match happily returned that one instead and
     failed the file for not declaring a background it was never supposed to declare. The base
     rule is the one that starts its own line. */
  const baseCss = html.match(/^\s*#shareSheet\{[^}]*\}/m);
  if (!baseCss) bad('#shareSheet rule missing');
  else if (!/background:transparent/.test(baseCss[0]) || !/backdrop-filter:none/.test(baseCss[0])) {
    bad(`#shareSheet must not dim or blur the reveal in any state: ${baseCss[0]}`);
  } else if (!/pointer-events:none/.test(baseCss[0])) {
    bad('#shareSheet must not take pointer events on the container — the reveal handle is behind it');
  } else ok('the sheet never darkens the reveal');

  /* POINTER EVENTS ARE NOW PER-STATE, AND THE BASE RULE ALONE NO LONGER SETTLES IT. The check
     above used to be the whole story and its own comment explains why that was right: assert
     the base, because an override on .show would slip past a check aimed at .peek. Then .show
     got exactly such an override — deliberately, so that a tap outside the long sheet can
     collapse it, which is what a modal owes you and which had never worked because the handler
     was unreachable. The base check passed while the thing it was protecting had changed.
     So the invariant is split, and both halves are asserted where they are true:
       · SHORT must stay transparent to touch. It overlays a live reveal whose wipe handle sits
         directly behind it; swallowing events there breaks the screen the sheet exists to sell.
       · LONG must take them, or tap-outside-to-dismiss is dead code that reads as a feature.
     And neither state may reintroduce a scrim, which is the part that was never negotiable. */
  {
    const rule = (sel) => (html.match(new RegExp(sel.replace(/[.#]/g, '\\$&') + '\\{[^}]*\\}')) || [])[0] || '';
    const peekCss = rule('#shareSheet.peek');
    const showCss = rule('#shareSheet.show');
    /* The third detent answers to the same rule as the short one: it is even smaller and sits
       over the same live reveal, so it must never swallow a touch either. */
    const miniCss = rule('#shareSheet.ssMini');
    /pointer-events\s*:\s*auto/.test(miniCss)
      ? bad('#shareSheet.ssMini takes pointer events — the folded sheet sits over a live reveal and '
          + 'the wipe handle behind it stops responding')
      : ok('the folded state stays transparent to touch');
    /* AND IT KEEPS THE WHOLE HOME-INDICATOR INSET. The folded card was once trimmed to
       `calc(var(--safe-b) - 14px)` to make it shorter, which put the grabber inside the bottom
       ~20pt band iOS reserves for its own swipe — the system took the gesture and the sheet
       would not come back up. No DOM test can catch it: headless reports no safe area at all,
       so the arithmetic that breaks a phone is 0px either way here. The declaration is the
       only place the mistake is visible, so the declaration is what gets checked. */
    /* ON THE GRABBER, NOT ON THE CARD, and the difference is a bug that already shipped twice.
       The padding has to hang off .ssGrab: that element is the only one in the folded sheet
       with touch-action:none and a drag handler, so whatever it does NOT cover is a strip of
       .ssCard that swallows a touch and hands it to the system — and from a sheet sitting on
       the bottom edge, an unclaimed upward swipe is the iOS app switcher. On .ssCard it looked
       identical and left a 5px handle. */
    {
      const grabCss = rule('#shareSheet.ssMini .ssGrab');
      const cardCss = rule('#shareSheet.ssMini .ssCard');
      const pad = (grabCss.match(/padding\s*:\s*([^;}]+)/) || [])[1] || '';
      const cardPad = (cardCss.match(/padding\s*:\s*([^;}]+)/) || [])[1] || '';
      !/var\(--safe-b\)/.test(pad)
        ? bad(`#shareSheet.ssMini .ssGrab pads "${pad.trim()}" — the folded bar needs the full `
            + 'var(--safe-b) beneath it, ON THE GRABBER, or iOS takes the swipe that reopens the sheet')
        : /--safe-b\)\s*-/.test(pad)
          ? bad(`#shareSheet.ssMini .ssGrab subtracts from the safe area ("${pad.trim()}") — that `
              + 'is exactly what put the handle inside the home-indicator band')
          : /[1-9]/.test(cardPad)
            ? bad(`#shareSheet.ssMini .ssCard still pads "${cardPad.trim()}" — every padded pixel `
                + 'there is outside the grabber, so it is a dead strip that leaks the gesture to iOS')
            : ok('the folded bar clears the home indicator, and the grabber owns the whole target');
    }
    /pointer-events\s*:\s*auto/.test(peekCss)
      ? bad('#shareSheet.peek takes pointer events — the short sheet sits over a live reveal and '
          + 'the wipe handle behind it stops responding')
      : ok('the short state stays transparent to touch');
    /pointer-events\s*:\s*auto/.test(showCss)
      ? ok('the long state takes the backdrop, so a tap outside collapses it')
      : bad('#shareSheet.show does not take pointer events — the container is pointer-events:none, '
          + 'so shareSheetEl.onclick can never fire and tap-outside-to-dismiss is dead code');
    [['peek', peekCss], ['show', showCss], ['mini', miniCss]].forEach(([n, css]) => {
      if (/backdrop-filter\s*:\s*(?!none)/.test(css) || /background\s*:\s*(?!transparent)/.test(css)) {
        bad(`#shareSheet.${n} puts a scrim back over the reveal: ${css}`);
      }
    });
  }

  /^[\s\S]*$/.test(html) && /setTimeout\(peekShareSheet/.test(html)
    ? ok('the reveal schedules the peek')
    : bad('nothing schedules peekShareSheet() — the sheet will never present itself');
}

/* ---- 5c. The paywall may not quote a number ------------------------------------------------
   The paywall is the only screen in the app that makes checkable promises in exchange for
   money. Its copy used to state the figures as prose — "75s to paint instead of 40s", "Free
   paints at one size", "5 taps on a fixed clock" — and prose does not move when a constant
   does. The old version of this check compared ONE of those sentences to PAINT_SECONDS, which
   is why the clock stayed honest while two other claims quietly went false: free got three
   fixed sizes and the sentence still said one, and the free challenge clock is derived and
   clamped, not fixed. Both were live, on a paywall, next to a price.
   Comparing each sentence to its constant does not scale — it needs a new rule per sentence,
   written by whoever adds the sentence, which is exactly the person who just got it wrong.
   The rule that does scale is: PAYWALL COPY CONTAINS NO NUMBER. Every figure is interpolated
   from the constant that governs it, so there is no sentence left to be false. A bare numeral
   anywhere in that copy means someone typed a value instead of reading one. */
{
  const stripC = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const block = (start) => {
    const at = html.indexOf(start);
    if (at < 0) return null;
    const open = html.indexOf('{', at);
    let d = 0;
    for (let i = open; i < html.length; i++) {
      if (html[i] === '{') d++;
      else if (html[i] === '}') { d--; if (!d) return stripC(html.slice(open, i + 1)); }
    }
    return null;
  };
  const pitch = block('const PW_PITCH=');
  const hint = block('const PW_LOCK_HINT=');
  const generic = (html.match(/const pwGenericSub=[^\n]*/) || [''])[0];
  const subTag = (html.match(/<div class="pwSub"[^>]*>([^<]*)</) || [])[1] || '';
  if (!pitch || !hint) bad('PW_PITCH / PW_LOCK_HINT not found — did the paywall copy move?');
  else {
    /* Quoted strings and template literals, with ${...} holes removed first: an interpolated
       number is the CORRECT form and must not be mistaken for a typed one. Spelled-out numbers
       count too — "not just the three" was a claim about FREE_SHADES with no digit in it. */
    const WORDS = /\b(one|two|three|four|five|six|seven|eight|nine|ten)\b/i;
    const sources = [['PW_PITCH', pitch], ['PW_LOCK_HINT', hint], ['pwGenericSub', generic],
      ['the #pwSub markup', JSON.stringify(subTag)]];
    const offenders = [];
    for (const [where, src] of sources) {
      for (const m of src.matchAll(/`([^`]*)`|"([^"]*)"|'([^']*)'/g)) {
        const lit = (m[1] ?? m[2] ?? m[3] ?? '').replace(/\$\{[^}]*\}/g, '');
        if (/\d/.test(lit) || WORDS.test(lit)) offenders.push(`${where}: ${JSON.stringify(lit.trim())}`);
      }
    }
    offenders.length
      ? bad('PAYWALL COPY QUOTES A NUMBER instead of reading it — it will go false the next time '
          + 'the value changes, and it is a paid claim:\n    ' + offenders.join('\n    '))
      : ok('no paywall copy quotes a number — every figure is read from its constant');

    /* And the constants those templates interpolate must actually exist. A rename would
       otherwise turn a promise into "undefined seconds to paint". */
    const refs = new Set();
    for (const src of [pitch, hint, generic]) {
      for (const m of src.matchAll(/\$\{\s*([A-Za-z_$][\w$]*)/g)) refs.add(m[1]);
    }
    const missing = [...refs].filter((r) => !new RegExp(`(const|let|var)\\s+[^;\\n]*\\b${r}\\b`).test(html));
    missing.length
      ? bad(`paywall copy interpolates ${missing.join(', ')} — not declared anywhere, so the `
          + 'sentence renders "undefined"')
      : ok(`paywall figures resolve (${[...refs].sort().join(', ')})`);
  }
}

/* ---- 5c-bis. A carrier may not double as a real event --------------------------------------
   The wrapper drops any web event not on its compiled allow-list, so three funnel events ride
   names shipped binaries already accept. That only works while the carrier name means ONE
   thing. It stopped meaning one thing: the middle branch routed everything through
   torch_toggled, which line ~4808 also emits for real, so the round funnel was buried inside
   a live signal — and because the branch it replaced was chosen on a false premise (that
   1.0.2 does not call setNativeCaps; it does), reveal_previewed read as zero and the reveal
   looked broken for the entire fleet. It was not. 1 413 rounds finished that day.
   The rule that prevents the repeat: a carrier target must be emitted NOWHERE else. Then its
   count is the funnel and nothing else, and no property filter is needed to read it. */
{
  const carriers = html.match(/const CARRIER_102=\{[^}]*\}/);
  if (!carriers) bad('CARRIER_102 not found — how are funnel events reaching the wrapper?');
  else {
    const targets = [...carriers[0].matchAll(/:"([a-z_]+)"/g)].map((m) => m[1]);
    const routed = [...html.matchAll(/const name\s*=[^;]*/g)].map((m) => m[0]).join('\n');
    /* Any string literal the router can choose, not just the CARRIER_102 map — the bad branch
       was an inline "torch_toggled" that never appeared in the map at all. */
    const inline = [...routed.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
    const all = [...new Set([...targets, ...inline])];
    const collide = all.filter((n) => new RegExp(`track\\("${n}"`).test(html));
    collide.length
      ? bad(`carrier name(s) ${collide.join(', ')} are ALSO emitted directly by track() — the `
          + 'funnel is being counted inside a live signal, and reading it needs a property '
          + 'filter nobody will remember to apply')
      : ok(`carriers are dedicated (${all.join(', ')} — emitted only by trackCarried)`);
  }
}

/* ---- 5c-ter. …and a carried event may not double as ITSELF -----------------------------------
   5c-bis above guards one direction: a CARRIER name must mean one thing. This is the other,
   and it cost more. Every call site fires `track(kind)` and then `trackCarried(kind)` — the
   real name for anyone who can receive it, a carrier for the 1.0.2 fleet whose allow-list
   drops it. The router reads `caps.eventsV2 ? kind : CARRIER_102[kind]`, so the day eventsV2
   shipped it began resolving back to the name the call site had ALREADY sent, and both events
   were counted. Amplitude on 2026-08-19: `purchase_initiated` split exactly 38 without
   `carrier_for` and 38 with, the same 50/50 every day for a week. 90 buy taps on 08-17 read as
   180; `round_finished` read 4 311 for ~2 200 rounds. A doubled numerator makes a checkout
   rate look half as good as it is, and nothing anywhere looks broken.
   The browser guard is the same defect wearing the other hat: with no wrapper there is no
   allow-list to dodge and chWebTrack already delivered the real name, so the carrier only put
   plain-browser rounds inside `reveal_previewed` — the number that is supposed to mean "a
   round from a build that cannot say round_finished".
   Static because the guards are one keystroke from deletion; test-carrier-dom.mjs then proves
   at runtime that they actually hold, in all four worlds. */
{
  const fn = html.match(/function trackCarried\([\s\S]*?\n\}/);
  if (!fn) bad('trackCarried not found — the funnel events for the old fleet have lost their router');
  else {
    const body = fn[0];
    /* Only meaningful while the router CAN resolve to the real name. If someone later gives
       eventsV2 its own dedicated name, the guard stops being load-bearing and this check
       should stop demanding it rather than becoming a rule nobody remembers the reason for. */
    const routesToKind = /\?\s*kind\s*:/.test(body);
    const guards = [
      [routesToKind && !/\bname\s*===\s*kind\b[^\n]*return/.test(body),
        'the router can resolve to `kind` itself and nothing stops it re-sending a name the '
        + 'call site already sent — that is the 90-taps-read-as-180 bug, exactly'],
      [!/!window\.ReactNativeWebView\s*\)\s*return/.test(body),
        'a carrier is sent even with no wrapper around the page, where the real name already '
        + 'reached Amplitude through chWebTrack — browser traffic lands inside a carrier name'],
    ].filter(([broken]) => broken).map(([, msg]) => msg);
    guards.length
      ? bad('ONE ACTION IS BEING COUNTED TWICE — ' + guards.join('; AND '))
      : ok('a carried event is emitted once (trackCarried refuses the real name and the browser)');
  }
}

/* ---- 5c-quater. WEB_ONLY and the wrapper's allow-list must not overlap ----------------------
   WEB_ONLY names bypass postNative() and go straight to Amplitude, because the wrapper drops
   anything not on its compiled WEB_EVENTS set and track() returns the moment postNative
   succeeds. That is only correct while the two lists are disjoint. The day someone adds one
   of these to WEB_EVENTS in kamo-app and does not remove it here, the event still skips the
   wrapper — so the native path is quietly lost and the number silently changes meaning
   without anything failing.
   Cross-repo, so it can only run where kamo-app sits next to kamo. It says so rather than
   passing quietly: a check that skips in silence is the same as no check. */
{
  const webOnly = html.match(/const WEB_ONLY=new Set\(\[([^\]]*)\]\)/);
  if (!webOnly) bad('WEB_ONLY not found — events the wrapper cannot carry are being dropped again');
  else {
    const names = [...webOnly[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
    let wrapper = null;
    try {
      const src = readFileSync(join(ROOT, '..', 'kamo-app', 'analytics.js'), 'utf8');
      wrapper = src.split('WEB_EVENTS = new Set([')[1].split('])')[0];
    } catch { /* sibling repo not checked out here */ }
    if (!wrapper) {
      console.log(`  · WEB_ONLY not cross-checked (${names.length} names) — kamo-app is not beside kamo, `
        + 'so the overlap with WEB_EVENTS cannot be verified on this machine');
    } else {
      const listed = names.filter((n) => new RegExp(`'${n}'`).test(wrapper));
      listed.length
        ? bad(`${listed.join(', ')} are in BOTH WEB_ONLY and the wrapper's WEB_EVENTS — the web `
            + 'skips postNative for them, so adding them to the wrapper does nothing and the '
            + 'native path is lost. Remove them from WEB_ONLY.')
        : ok(`WEB_ONLY is disjoint from the wrapper's allow-list (${names.length} names routed direct)`);
    }

    /* AND THE OTHER DIRECTION, WHICH NOTHING ASKED UNTIL 2026-08-17: does anything EMIT it?
       The disjointness check above only compares two lists against each other, so a name can
       sit in WEB_ONLY for weeks after its last call site is deleted and read, to anyone
       grepping, exactly like a live event. That is not hypothetical — challenge_preview_opened
       lost its emitter with the rehearsal overlay on 2026-08-15 (00db2d2) and the name stayed,
       next to a comment describing it as the proof a share had landed. Amplitude then showed
       it going 125 -> 0 across that date and it was read as a broken funnel rather than as a
       feature that had been deliberately removed. A registered name that nothing writes is
       indistinguishable from a metric that just died, and the difference is a day of work.
       Reported as a LIST WITH REASONS rather than silently allowed, same as KNOWN_UNCALLED
       above: the point is that each one is a decision somebody made, on the record. */
    const KNOWN_DEAD_EVENTS = new Map([
      ['challenge_preview_opened', 'the sender rehearsal overlay (chPrevPlay) removed 2026-08-15, 00db2d2'],
      ['discord_opened', 'the Discord link is not on any surface right now'],
      ['prev_blocked_tapped', 'the feed no longer blocks stepping backwards'],
      ['visibility_consent_shown', 'the consent row became the publish act itself'],
      ['visibility_consent', 'same row — the toggle reports through hide_visibility_set now'],
    ]);
    /* The name has to be quoted the way the source quotes it, and prose is not a call site:
       this looks for track("<name>" specifically, which is how every event in this file is
       emitted. A name reachable only through a variable would read as dead here — none is
       today, and if one ever is, it belongs in the map above with that as its reason. */
    const emitted = new Set([...html.matchAll(/track\(\s*"([a-z0-9_]+)"/g)].map((m) => m[1]));
    const dead = names.filter((n) => !emitted.has(n) && !KNOWN_DEAD_EVENTS.has(n));
    dead.length
      ? bad(`in WEB_ONLY but never emitted: ${dead.join(', ')}\n    `
          + 'A name in this set with no track("<name>") call site is a phantom: it routes '
          + 'nothing, and it reads like a live metric to the next person who greps for it '
          + '(see challenge_preview_opened, 2026-08-15). Emit it, remove it, or add it to '
          + 'KNOWN_DEAD_EVENTS with the reason it is parked.')
      : ok(`every WEB_ONLY name has a call site (${names.length - KNOWN_DEAD_EVENTS.size} live, ${KNOWN_DEAD_EVENTS.size} known-dead allowed)`);
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
    /* No `()` in the anchor: it took a `via` parameter and this check went red on a signature
       change that had nothing to do with what it guards. Anchors match the NAME. */
    /* EVERY CAPTURE IS A NEW HIDE. chId survived capture() for months: within one session
       only the first round could publish, and every round after it shared the link to the
       PREVIOUS photo — personalised, signed, and pointing at someone else's picture. The
       app reload between launches hid it perfectly (one hide per launch reads as a user
       who made one). Nothing user-visible says it is happening, so it gets an assertion. */
    ['capture starts a fresh hide', 'function capture(', 'chResetRound()',
      'capture() does not call chResetRound() — chId survives into the next round, so the '
      + 'second hide of a session shares the FIRST hide\'s link and the friend opens a '
      + 'different photo'],
    /* THE ROW'S ANSWER IS WHAT PUBLISHES, and since 2026-08-15 it is the ONLY thing that does:
       the consent modal that used to gate this line is gone, so kfWantPublic() — the value the
       share sheet's .ssVis row writes and displays — is the whole of the decision. A call site
       that started passing a literal, or read some other flag, would publish somebody's room to
       a public feed against a switch that says Private, and nothing on screen would disagree.
       test-peek-dom asserts the row is visible in the short sheet; this asserts it is obeyed. */
    ['the visibility row is what publishes', 'async function chUpload(', 'kfApplyVisibility(mine,kfWantPublic())',
      'chUpload() no longer publishes through kfApplyVisibility(mine,kfWantPublic()) — with the '
      + 'consent modal gone that row is the only disclosure AND the only decision, so a call site '
      + 'that hardcodes the flag publishes against a switch the user set'],
    ['the reveal starts the upload without publishing', 'function enterFinished(', 'chPrepare()',
      'enterFinished() no longer calls chPrepare() — the image upload goes back to starting '
      + 'on the same gesture as the tap, which is the eight-second wait this split removed'],
    /* The go-public offer only exists if the send reveals it, and it is only honest if its
       tap performs the toggle's own act. Both halves are one deleted line away and neither
       is visible in a diff: the button just stays hidden, or stays a label. */
    ['the send reveals the go-public offer', 'async function chMarkSent(', 'ssOfferPub()',
      'chMarkSent() no longer calls ssOfferPub() — the post-send go-public offer never '
      + 'appears, and three-quarters of published hides keep missing the feed by default'],
    ['the go-public tap performs the toggle\'s own act', 'function ssOfferPub(', 'kfWantPublic()',
      'ssOfferPub() no longer gates on kfWantPublic() — the offer would appear over a toggle '
      + 'already saying Public, asking a question the sheet just answered'],
    /* Same guard as the peek path above, on the other door into the sheet. The visibility
       answer is remembered across rounds, so a sheet opened without this paints the previous
       hide's wording — and one of the two wordings is a claim the toggle underneath it
       contradicts. It replaces the chPrevRender() assertion that lived here; the card it
       protected is the feed now. */
    ['openShareSheet states the hide\'s real visibility', 'function openShareSheet(', 'kfRenderVis()',
      'openShareSheet() does not call kfRenderVis() — the headline, the toggle and "See it live" '
      + 'are one answer painted by one function, and skipping it leaves the sheet claiming '
      + 'whatever the last round chose'],
    /* The chSetOk / chSetReset rows are gone WITH the settings sheet: the seeker plays one
       buzz on no clock, so there are no taps or seconds left to save. chRepublish() is still
       guarded — the handle's blur handler is its remaining caller. */
    ['renaming the handle republishes the signed hide', 'inp.addEventListener("blur"', 'chRepublish()',
      'the handle blur handler no longer calls chRepublish() — a renamed sender keeps '
      + 'signing the OLD name on the hide behind the link'],
    /* THE PRE-ROLL BELONGS TO THE HIDE ABOUT TO BE SHOT. Without this reset a Retake carries
       the previous round's framing seconds into the next share — footage of a wall the user
       walked away from, opening a clip about a photo that was thrown away. */
    ['each round aims fresh', 'function enterCompose(', 'sessReset()',
      'enterCompose() does not call sessReset() — a Retake keeps the PREVIOUS round\'s '
      + 'pre-roll, so the session clip opens on footage of a photo that was discarded'],
    /* tlCapture() only fires at the END of a stroke, so without this the replay opens on a
       figure that is already part-painted. The opening frame is what makes the clip a
       recording of the round rather than of the second half of it. */
    ['the round is recorded from the shutter', 'function capture(', 'tlCaptureOpen()',
      'capture() does not call tlCaptureOpen() — the clip opens on a part-painted figure, '
      + 'skipping the shot the round started from'],
  ];
  for (const [label, start, needs, why] of wiring) {
    const body = bodyOf(start);
    if (body === null) bad(`could not locate ${start} — this check needs updating`);
    else if (!body.includes(needs)) bad(why);
    else ok(label);
  }
}

/* ---- 5d-sexies. The go-public tap must actually publish -----------------------------------
   The #ssGoPub handler is an arrow in a block, so the function-anchored wiring table above
   cannot reach it. What must hold: the tap performs the visibility toggle's own act — the
   sticky preference, the repaint, and the ROW-LEVEL flag. A handler that sets the label and
   skips kfApplyVisibility would show "In the feed ✓" over a hide that never left private,
   which is the one dishonest state this sheet must never produce. */
{
  /* Anchored on the onclick assignment, not on the $("#ssGoPub") lookup — peekShareSheet's
     per-round reset holds the same lookup earlier in the file, and indexOf would land there
     and read 5000 characters of the wrong neighbourhood. */
  const at = html.indexOf('g.onclick=async(e)=>{');
  if (at < 0) bad('the #ssGoPub handler block is gone — the go-public offer has no tap');
  else {
    /* 5000 raw characters, because the slice happens BEFORE the comments are stripped and
       this block narrates its reasoning — a window measured against stripped code would be
       measured against a length this file does not have at that offset. */
    const seg = html.slice(at, at + 5000)
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    const wants = ['kfSetWantPublic(true)', 'kfRenderVis()', 'kfApplyVisibility(id,true)', 'track("sent_public_accepted"'];
    const missing = wants.filter((w) => !seg.includes(w));
    missing.length
      ? bad('the #ssGoPub handler is missing: ' + missing.join(', ') + ' — the receipt and the '
          + 'publish have to travel together or the label lies')
      : ok('the go-public tap flips the preference, repaints the sheet, and publishes the row');
  }
}

/* ---- 5d-bis. tlFrames and tlTimes are one array wearing two names -------------------------
 * tlTimes carries the wall-clock mark for tlFrames[i], and sessionPayload() zips them by
 * index to hand native the pace the round actually ran at. So the pairing IS the feature, and
 * it is held together by nothing but discipline: separate places push, decimate and shift
 * tlFrames, and every one of them has to do the same to tlTimes.
 *
 * WHY A CHECK AND NOT A COMMENT. Getting this wrong does not throw and does not look broken.
 * The clip still renders, with every frame present and every mark present — they are simply
 * offset, so the replay speeds up and slows down at the wrong moments. No error, no failed
 * render, nothing in Amplitude. The only witness is someone watching a video and feeling that
 * it is a bit off.
 *
 * The rule is deliberately crude — same LINE, not same scope — because the fix for a violation
 * is always to put the mirror mutation next to its twin, which is also what keeps the pairing
 * readable. If a refactor ever needs them apart, rewrite this check to follow it; do not
 * delete it.
 */
{
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const lines = strip(html).split('\n');
  const MUTATES = /tlFrames\s*(?:=[^=]|\.push\(|\.shift\(|\.pop\(|\.splice\()/;
  const sites = lines.filter((l) => MUTATES.test(l));
  const offenders = [];
  lines.forEach((ln, i) => {
    if (MUTATES.test(ln) && !/tlTimes/.test(ln)) offenders.push(`${i + 1}: ${ln.trim().slice(0, 110)}`);
  });
  offenders.length
    ? bad('tlFrames is mutated without tlTimes on the same line — the session clip would play\n'
      + '    the round back out of sync, with nothing anywhere reporting it:\n      ' + offenders.join('\n      '))
    : ok(`tlFrames and tlTimes are mutated together (${sites.length} sites)`);
}

/* ---- 5d-quinquies. THE TWO ANALYTICS ROADS STAY JOINABLE ---------------------------------
 * track() sends an event one of two ways: through the bridge to the native SDK, or — for
 * every name in WEB_ONLY — straight to Amplitude's HTTP API from the page. Those land under
 * two different Amplitude users unless the web payload carries the same user_id native sets.
 *
 * WHAT BREAKING THIS LOOKS LIKE: nothing. No error, no warning, no drop in any count. Only
 * cross-road funnels change, and they change to ZERO — which reads as a wall in the product
 * rather than a hole in the instrumentation. On 2026-08-13 `essay_finished` -> `sheet_presented`
 * reported 324 people painting a hide and not one of them reaching the share sheet, and it
 * took reading track() to disbelieve the number.
 *
 * So the payload keeps user_id, and it keeps device_id beside it — the device_id is the only
 * identity a browser seeker will ever have, and replacing it would break the seeker funnel to
 * fix the app one.
 */
{
  const at = html.indexOf('function chWebTrack(');
  if (at < 0) bad('could not locate chWebTrack() — this check needs updating');
  else {
    const head = html.slice(at, at + 2600);
    const hasUser = /user_id\s*:/.test(head);
    const hasDevice = /device_id\s*:\s*chDeviceId\(\)/.test(head);
    if (!hasUser) {
      bad('chWebTrack() no longer sends user_id — every WEB_ONLY event goes back to a separate\n'
        + '    Amplitude user from the app\'s own events, and every funnel crossing the two silently\n'
        + '    returns zero instead of failing');
    } else if (!hasDevice) {
      bad('chWebTrack() no longer sends device_id — a browser seeker has no user_id at all, so\n'
        + '    the whole seeker funnel loses its only identity');
    } else if (!/window\.KAMO\.setAnalyticsUserId\s*=/.test(html)) {
      bad('window.KAMO.setAnalyticsUserId is gone — the wrapper has no way to hand the id over,\n'
        + '    so user_id above is always empty and the join never happens');
    } else ok('web-direct events carry both ids, so they join the app\'s events');
  }
}

/* ---- 5d-quater. THERE IS NO MANDATORY PAINT PERCENTAGE TO SHARE --------------------------
 * A standing rule from the founder, stated twice. The send is never gated on coverage.
 *
 * It has been broken once already: PR #147 added a floor that refused "Challenge a friend"
 * outright, closed the sheet and pushed the user back to the brush. It fired on over a third
 * of everyone who finished a round, for days, and the only thing it ever produced was a share
 * that did not happen.
 *
 * It is an easy rule to break by accident, because the REASON for the floor is good: a hide
 * with no paint publishes a challenge whose og:image shows the figure in plain sight and
 * spoils the answer in the thread before anyone taps it. The correct expression of that is
 * chUpload() refusing to PUBLISH — which stays, and is not what this checks. What must never
 * come back is a coverage test that ends the send.
 *
 * So: inside the invite handler, no `if (… CH_MIN_COVERAGE …) { … return … }`. Computing
 * `bare` from the same constant is fine and required — the handler has to know no challenge
 * is coming so that it does not WAIT for one.
 */
{
  const at = html.indexOf('$("#ssInvite").onclick');
  if (at < 0) bad('could not locate the #ssInvite handler — this check needs updating');
  else {
    const open = html.indexOf('{', at);
    let d = 0, end = -1;
    for (let i = open; i < html.length; i++) {
      if (html[i] === '{') d++;
      else if (html[i] === '}') { d--; if (!d) { end = i; break; } }
    }
    const body = html.slice(open + 1, end < 0 ? html.length : end)
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    /* [^{}]* so the match cannot run past the end of the if-block and find an unrelated
       `return` further down the handler — the same lazy-span mistake 5d documents. */
    if (/if\s*\([^)]*CH_MIN_COVERAGE[^)]*\)\s*\{[^{}]*\breturn\b/.test(body)) {
      bad('THE SHARE IS GATED ON COVERAGE AGAIN. The invite handler returns early on\n'
        + '    CH_MIN_COVERAGE, which is a mandatory paint percentage to share — ruled out\n'
        + '    twice, and the last time it shipped it silently refused a third of all finished\n'
        + '    rounds.\n'
        + '    Keep the PUBLISH floor (chUpload) — that one stops a link preview spoiling the\n'
        + '    answer. The SEND has to go out regardless, as the invite.');
    } else if (!/const\s+bare\s*=/.test(body)) {
      bad('the invite handler no longer computes `bare` — without it the native path holds the\n'
        + '    button at "Preparing your challenge…" for 8s waiting on an id that is never\n'
        + '    coming, then sends the invite anyway');
    } else ok('the send is never gated on coverage (the publish floor still is)');
  }
}

/* ---- 5d-ter. The pre-roll sampler stays behind its capability -----------------------------
 * sessPre() encodes a 720x1280 JPEG off the camera preview and is called from camTick — i.e.
 * from inside a requestAnimationFrame loop, on the aim screen, which is the one screen where a
 * stutter is most visible. That cost is only worth paying for a binary that can actually
 * render the session clip, so the first thing the function does is ask.
 *
 * Deleting the guard would break nothing a test can see. It would just make every user on
 * every older build pay 15-25ms of main thread, several times a second, for frames no
 * renderer will ever read.
 */
{
  const at = html.indexOf('function sessPre(');
  if (at < 0) bad('could not locate sessPre() — this check needs updating');
  else {
    /sessWanted\(\)/.test(html.slice(at, at + 220))
      ? ok('the pre-roll sampler asks for the capability before it encodes anything')
      : bad('sessPre() no longer opens on sessWanted() — every build without the session\n'
        + '    renderer now encodes JPEGs off the camera preview for frames nobody reads');
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
  /* hidesDone reads the kamo_hides counter that bumpHides() still writes on every capture.
     Its only caller was teachHint's "stop after the second hide" guard, and the teaching
     hints are off — so it is parked, not dead: turning the hints back on needs it, and
     deleting it would leave the counter write-only and invite someone to delete that too. */
  const KNOWN_UNCALLED = new Set(['blobShadow', 'captureBurst', 'roundRectFill', 'hidesDone']);

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
  bad('SHARE PATHS BROKEN:\n' + why(e));
}

/* ---- 7. The challenge link's head ----------------------------------------------------------
   infra/edge-h.ts renders every playkamo.com/h/<id> — the unfurl in the thread AND the only
   URL on the ranking domain anyone links to. It is deployed by hand to Supabase, so nothing
   else in this repo forces it to stay honest. Chained here for the same reason as the share
   paths: one command before a push. */
try {
  execFileSync(process.execPath, [join(ROOT, 'scripts', 'test-edge-h.mjs')], { stdio: 'pipe' });
  ok('the challenge link unfurls and keeps its domain (node scripts/test-edge-h.mjs for the detail)');
} catch (e) {
  bad('CHALLENGE LINK HEAD BROKEN:\n' + why(e));
}

/* ---- 8. The share sheet, rendered in a real browser -----------------------------------------
   Everything above reads the file. Two bugs shipped this week that reading the file could not
   see: the preview card was whitelisted in the short sheet's CSS while nothing ever added the
   class that displays it, and the card rose twice because .pwCard's animation took over the
   moment a more specific one was removed. Both were invisible in the source and obvious on a
   phone. This one opens Chromium.
   It SKIPS rather than fails when playwright-core is not installed — it is not a dependency of
   this repo — but it says so loudly, because a check that quietly does nothing is worse than
   no check. Run it with PW_CORE=<dir containing node_modules>. */
try {
  const out = execFileSync(process.execPath, [join(ROOT, 'scripts', 'test-peek-dom.mjs')], { stdio: 'pipe' }).toString();
  out.includes('skipping')
    ? skipped('test-peek-dom.mjs', 'DOM TEST', out)
    : ok('the short sheet carries the whole ask (node scripts/test-peek-dom.mjs for the detail)');
} catch (e) {
  /* OUT OF QUARANTINE 2026-08-15, and worth recording what it was quarantined FOR, because
     every one of the fourteen failures turned out to be the suite describing a sheet that no
     longer existed rather than a sheet that had broken.
     The headline symptom — "the LONG state measures 25px against a 372px peek" — was the
     handle: taps used to step UP, and on 2026-08-12 the founder made them walk DOWN and wrap
     from the floor. So the suite tapped the grabber expecting `open`, got the 25px folded bar,
     and called it the long state; the drag, the third detent and the tap-outside assertions
     all cascaded from that one wrong expectation. The rest were elements deleted out from
     under it: the preview card, the rehearsal overlay, the Instagram slab.
     It now asserts the sheet that ships, and the paywall-copy block it carries earned its
     place on the way out — it caught three live strings calling the figurine a "body". */
  bad('THE SHORT SHEET IS BROKEN:\n' + why(e));
}

/* ---- 9. The results chip ---------------------------------------------------------------
   Same reason as 8: localStorage, a network answer and a screen mode are runtime state, and
   the chip is the only thing this app can show someone for coming back. */
try {
  const out = execFileSync(process.execPath, [join(ROOT, 'scripts', 'test-mine-dom.mjs')], { stdio: 'pipe' }).toString();
  out.includes('skipping')
    ? skipped('test-mine-dom.mjs', 'RESULTS-CHIP DOM TEST', out)
    : ok('the results chip behaves (node scripts/test-mine-dom.mjs for the detail)');
} catch (e) {
  /* OUT OF QUARANTINE. It required the resend message to quote "30 sec and 5 taps"; the round
     settings are retired and the seeker plays one buzz on no clock, so the assertion was
     inverted rather than deleted — neither a hide storing those values nor one storing none
     may quote them, and both must state the deal actually on offer. */
  bad('THE RESULTS CHIP IS BROKEN:\n' + why(e));
}

/* ---- 10. The creator pass --------------------------------------------------------------
   This one hands out KAMO+. Three of its four invariants fail silently: a broken comparison
   gives it to anyone who holds the button, storing a flag instead of the hash makes a leaked
   phrase permanent, and living in the wrong key means the wrapper's launch-time setPro(false)
   erases it — which would reproduce the exact support ticket it was built to close. */
try {
  const out = execFileSync(process.execPath, [join(ROOT, 'scripts', 'test-pass-dom.mjs')], { stdio: 'pipe' }).toString();
  out.includes('skipping')
    ? skipped('test-pass-dom.mjs', 'CREATOR-PASS TEST', out)
    : ok('the creator pass unlocks, persists and can be revoked (node scripts/test-pass-dom.mjs)');
} catch (e) {
  bad('THE CREATOR PASS IS BROKEN:\n' + why(e));
}

/* ---- 11. The player card ---------------------------------------------------------------
   It opens for EVERYONE now, so every membership signal on it has to be able to say no — and
   the handle it holds is interpolated into a share message a stranger reads, which is the one
   value in this app that goes from a text field into somebody else's phone. */
try {
  const out = execFileSync(process.execPath, [join(ROOT, 'scripts', 'test-home-dom.mjs')], { stdio: 'pipe' }).toString();
  out.includes('skipping')
    ? skipped('test-home-dom.mjs', 'PLAYER-CARD TEST', out)
    : ok('the player card keeps a clean handle and claims only what is true (node scripts/test-home-dom.mjs)');
} catch (e) {
  /* OUT OF QUARANTINE. It clicked #khEdit, a pencil control that no longer exists — the
     headline itself became the way back into the field. The assertion it carried is the one
     that matters (there has to be a way to fix a typo after the field collapses), so it moved
     onto #khTitle rather than being dropped. */
  bad('THE PLAYER CARD IS BROKEN:\n' + why(e));
}

/* ---- 11b. The name has to survive the next launch ---------------------------------------
   Reported twice from the field — "d'une session à l'autre on doit toujours entrer le nom" —
   and on BOTH builds, which killed the obvious explanation (1.0.2's `incognito` WebView store)
   because the new build does not set that flag. Every other DOM suite here builds one page and
   stays on it, so nothing anywhere crossed the one line that matters: a second document
   against the same origin. That is what a relaunch is. */
try {
  const out = execFileSync(process.execPath, [join(ROOT, 'scripts', 'test-handle-dom.mjs')], { stdio: 'pipe' }).toString();
  out.includes('skipping')
    ? skipped('test-handle-dom.mjs', 'HANDLE TEST', out)
    : ok('the name is typed once and survives the next launch (node scripts/test-handle-dom.mjs)');
} catch (e) {
  bad('THE NAME DOES NOT SURVIVE A RELAUNCH:\n' + why(e));
}

/* ---- 11c. The full-bleed paywall arm ---------------------------------------------------- */
/* Half of a 50/50 revenue experiment. Every other DOM test boots pinned to the sheet arm
   (navigator.webdriver), so without this one the arm real users see would ship untested. */
try {
  const out = execFileSync(process.execPath, [join(ROOT, 'scripts', 'test-pwfull-dom.mjs')], { stdio: 'pipe' }).toString();
  out.includes('skipping')
    ? skipped('test-pwfull-dom.mjs', 'FULL-ARM PAYWALL TEST', out)
    : ok('the full-bleed paywall arm renders and sells only real prices (node scripts/test-pwfull-dom.mjs)');
} catch (e) {
  bad('THE FULL-BLEED PAYWALL ARM IS BROKEN:\n' + why(e));
}

/* ---- 11d. Which plan the CTA sells ------------------------------------------------------ */
/* The other half of the same screen, and the one with a failure mode that costs money rather
   than looking wrong: a device in the lifetime arm whose store cannot sell the lifetime must
   fall back to the weekly, not show a hero for a product that does not exist. */
try {
  const out = execFileSync(process.execPath, [join(ROOT, 'scripts', 'test-planarm-dom.mjs')], { stdio: 'pipe' }).toString();
  out.includes('skipping')
    ? skipped('test-planarm-dom.mjs', 'PLAN-ARM TEST', out)
    : ok('the hero-plan arm sells the plan it selected, and falls back when it cannot (node scripts/test-planarm-dom.mjs)');
} catch (e) {
  bad('THE HERO-PLAN ARM IS BROKEN:\n' + why(e));
}

/* ---- 11e. The hint on the seek screen --------------------------------------------------- */
/* Two guarantees, both of which fail silently if nobody looks: a released binary must see no
   hint button at all (the capability gate is what keeps a web deploy that lands before the
   build from changing anything for live users), and the revealed zone must be an ELLIPSE
   scaled per axis - the server's region is one, and a circle would show a shape the answer is
   not guaranteed to sit inside. */
try {
  const out = execFileSync(process.execPath, [join(ROOT, 'scripts', 'test-hint-dom.mjs')], { stdio: 'pipe' }).toString();
  out.includes('skipping')
    ? skipped('test-hint-dom.mjs', 'HINT TEST', out)
    : ok('the hint is gated, drawn where the server put it, and still there when the round ends (node scripts/test-hint-dom.mjs)');
} catch (e) {
  /* BOTH STREAMS, because the \u2717 lines are on NEITHER the one this used to read. test-hint-dom
     prints its passes with console.log and its failures with console.error, so filtering
     stdout for \u2717 found nothing and this printed "THE HINT IS BROKEN:" followed by a blank
     line \u2014 a red CI that names no cause, on the check whose whole job is to name one. */
  const streams = ((e.stdout || '') + '\n' + (e.stderr || '')).toString();
  const lines = streams.split('\n').filter((l) => l.includes('\u2717'));
  bad('THE HINT IS BROKEN:\n' + (lines.length ? lines.join('\n') : streams.trim().split('\n').slice(-12).join('\n')));
}

/* ---- 11e2. The card on your own photo ----------------------------------------------------
   The one screen where every control pointed backwards: "See it live" seeds the feed with the
   hide you just published, and the round's ending card offered to challenge you back and to
   block you. Both are gone there; "Send to a friend" takes the primary slot and "Hide another
   one" reaches the camera. Asserted rather than read, because it is a branch on chMine() that
   fires down exactly one path — a regression is invisible to everybody except the person who
   just made a hide, which is everybody this app is trying to keep. */
try {
  const out = execFileSync(process.execPath, [join(ROOT, 'scripts', 'test-ownpost-dom.mjs')], { stdio: 'pipe' }).toString();
  out.includes('skipping')
    ? skipped('test-ownpost-dom.mjs', 'OWN-POST TEST', out)
    : ok('your own hide gets its own card, and its exit reaches the camera (node scripts/test-ownpost-dom.mjs)');
} catch (e) {
  bad('THE OWN-HIDE CARD IS BROKEN:\n' + why(e));
}

/* ---- 11f. What the sheet claims, and to whom --------------------------------------------- */
/* The headline announces that the hide is live, and the toggle 40px below it can make that
   false. Same shape for the two offers underneath: "See it live" must not point at a feed a
   private hide is not in, and #ssGet must not promise a notification inside a wrapper that
   already has one. Every one of these is a visible mistake to the user and an invisible one
   in a diff. */
try {
  const out = execFileSync(process.execPath, [join(ROOT, 'scripts', 'test-sheetlive-dom.mjs')], { stdio: 'pipe' }).toString();
  out.includes('skipping')
    ? skipped('test-sheetlive-dom.mjs', 'SHEET-LIVE TEST', out)
    : ok('the sheet claims only what the toggle allows, and opens the feed on that hide (node scripts/test-sheetlive-dom.mjs)');
} catch (e) {
  bad('THE SHEET IS CLAIMING THE WRONG THING:\n' + why(e));
}

/* ---- 12. The signed challenge, from the receiver's side --------------------------------- */
try {
  const out = execFileSync(process.execPath, [join(ROOT, 'scripts', 'test-seek-dom.mjs')], { stdio: 'pipe' }).toString();
  out.includes('skipping')
    ? skipped('test-seek-dom.mjs', 'SEEKER TEST', out)
    : ok('the seeker screen names the sender (node scripts/test-seek-dom.mjs)');
} catch (e) {
  bad('THE SEEKER SCREEN IS BROKEN:\n' + why(e));
}

/* ---- 12b. The one-buzz round, end to end -------------------------------------------------
   The seeker was rewritten around one aimed buzz, the snap reveal and the A/B flip, and
   every failure mode in that chain is runtime state a static read cannot see: a reticle
   that never mounts, a release that commits nothing, a snap that arrives as a fade, a
   flip armed with nothing behind it, a re-hide that strands the overlay. */
try {
  const out = execFileSync(process.execPath, [join(ROOT, 'scripts', 'test-buzz-dom.mjs')], { stdio: 'pipe' }).toString();
  out.includes('skipping')
    ? skipped('test-buzz-dom.mjs', 'BUZZ TEST', out)
    : ok('the one-buzz round behaves end to end (node scripts/test-buzz-dom.mjs)');
} catch (e) {
  bad('THE ONE-BUZZ SEEKER IS BROKEN:\n' + why(e));
}

/* ---- 12b-ter. The feed ---------------------------------------------------------------------
   The feed does not reimplement the round — it mounts a real chSeek into each slide — so the
   two ways it can be wrong are both invisible in a diff: the mount landing on document.body
   (a fullscreen round with a dead scroller under it) and the previous round never being
   destroyed (a clock per swipe, forever). The third assertion is the visibility default: a
   row that flips its own label without calling set_hide_public reads as a setting that was
   honoured, which is worse than having no row at all. */
try {
  const out = execFileSync(process.execPath, [join(ROOT, 'scripts', 'test-feed-dom.mjs')], { stdio: 'pipe' }).toString();
  out.includes('skipping')
    ? console.log('  · FEED TEST SKIPPED — ' + out.trim().split('\n').pop())
    : ok('the feed plays real rounds and states where a photo goes (node scripts/test-feed-dom.mjs)');
} catch (e) {
  bad('THE FEED IS BROKEN:\n' + why(e));
}

/* ---- 12b-bis. The swipe is not free, and the lock is not a trap ---------------------------
   chNoteSeek() runs from ending(), and ending() only happens on a buzz — so scrolling past a
   feed round cost nothing and the run counted only the rounds the player was already sure
   about. That is the same selection bias `n_attempts` carries (feed 59.2% found in 3.6s
   against 48.0% in 7.3s on a link), and it made the hint pack insurance against a risk nobody
   was exposed to. The slide is held until its round is answered.
   The half that needs a gate is the RELEASE. There is no clock any more, so a slide that locks
   and never lets go is a dead end with no timer and no gesture out of it — and one release
   path (a photo that never loads) does not go through ending() at all. */
try {
  const out = execFileSync(process.execPath, [join(ROOT, 'scripts', 'test-feedlock-dom.mjs')], { stdio: 'pipe' }).toString();
  out.includes('skipping')
    ? skipped('test-feedlock-dom.mjs', 'FEED LOCK TEST', out)
    : ok('the feed holds a round until it is answered, and always lets go (node scripts/test-feedlock-dom.mjs)');
} catch (e) {
  bad('THE FEED LOCK IS A TRAP OR A NO-OP:\n' + why(e));
}

/* ---- 12b-quater. The reply knows who it answers -------------------------------------------
   iOS never says who a share went to, so the only address KAMO can ever have for a reply is
   the hide it answers — captured on "Send one back" and stamped on the published row. Both
   ways it can break are silent: the address never captured (the reply publishes as an
   ordinary hide and nobody is notified), or the address outliving its round (a stranger gets
   a notification about a hide they were never part of). */
try {
  const out = execFileSync(process.execPath, [join(ROOT, 'scripts', 'test-reply-dom.mjs')], { stdio: 'pipe' }).toString();
  out.includes('skipping')
    ? console.log('  · REPLY TEST SKIPPED — ' + out.trim().split('\n').pop())
    : ok('a reply knows who it answers (node scripts/test-reply-dom.mjs)');
} catch (e) {
  bad('THE REPLY LOOP IS BROKEN:\n' + why(e));
}

/* ---- 12b-sexies. The feed's quality pass ----------------------------------------------------
   The LQIP is stranger-authored CSS and the banger is a positional insertion into two lists
   that must move together — both invisible in a diff, both asserted in a browser. */
try {
  const out = execFileSync(process.execPath, [join(ROOT, 'scripts', 'test-feedq-dom.mjs')], { stdio: 'pipe' }).toString();
  out.includes('skipping')
    ? skipped('test-feedq-dom.mjs', 'FEED-QUALITY TEST', out)
    : ok('the lqip paints (and only the real shape), the banger inserts fourth (node scripts/test-feedq-dom.mjs)');
} catch (e) {
  bad('THE FEED QUALITY PASS IS BROKEN:\n' + why(e));
}

/* ---- 12b-quinquies. The challenges panel ---------------------------------------------------
   The other half of the reply loop: the screen where an answer is finally SEEN. Its three
   silent failure modes — a stranger's handle reaching the DOM as markup, the replay flag
   stuck the wrong way (a spent answer inflating the author's attempt count, or a fresh one
   refusing to file), and a no-hides device being asked to wait on a network call whose
   answer is [] by construction — are all runtime state, so they get a browser. */
try {
  const out = execFileSync(process.execPath, [join(ROOT, 'scripts', 'test-chal-dom.mjs')], { stdio: 'pipe' }).toString();
  out.includes('skipping')
    ? skipped('test-chal-dom.mjs', 'CHALLENGES TEST', out)
    : ok('the challenges panel behaves (node scripts/test-chal-dom.mjs)');
} catch (e) {
  bad('THE CHALLENGES PANEL IS BROKEN:\n' + why(e));
}

/* ---- 12b-bis. The share sends THIS round's hide, and sends it now -------------------------
   Two field-reported bugs that hid each other: the upload starting on the same gesture as
   the tap (an 8s wait, then the generic invite), and chId surviving capture() so the second
   hide of a session shared the FIRST hide's link. Both are timing, both are invisible to a
   static read, and the test stubs a 3-second upload because neither reproduces on a fast
   one. */
try {
  const out = execFileSync(process.execPath, [join(ROOT, 'scripts', 'test-share-dom.mjs')], { stdio: 'pipe' }).toString();
  out.includes('skipping')
    ? skipped('test-share-dom.mjs', 'SHARE-TIMING TEST', out)
    : ok('the share is instant and always its own hide (node scripts/test-share-dom.mjs)');
} catch (e) {
  bad('THE SHARE SENDS THE WRONG HIDE OR MAKES THE USER WAIT:\n' + why(e));
}

/* ---- 12b-ter. Instagram is reachable, native-only, and it does not out-rank the send ------
   The button was cut on 2026-08-15 for two good reasons — a labelled slab took a third of a
   row built for two, and it sat above the send — and one bad one: a seven-day average taken
   over the days before the wave, on a series that was doubling right up to the evening the
   markup was deleted. It is back as a 48px glyph, and every way it could go wrong again is a
   layout fact or a gate, which is to say invisible in a diff: a label creeping back onto it
   re-wraps "Remove mark", and a gate loosened to `nativeCaps` puts a dead button on the web.
   Both fail here rather than on a phone. */
try {
  const out = execFileSync(process.execPath, [join(ROOT, 'scripts', 'test-igbtn-dom.mjs')], { stdio: 'pipe' }).toString();
  out.includes('skipping')
    ? skipped('test-igbtn-dom.mjs', 'INSTAGRAM BUTTON TEST', out)
    : ok('Instagram is reachable, native-only, and does not out-rank the send (node scripts/test-igbtn-dom.mjs)');
} catch (e) {
  bad('THE INSTAGRAM TARGET IS UNREACHABLE OR IT IS EATING THE ROW:\n' + why(e));
}

/* ---- 12b-quater. The feed is walled in a browser, and NOTHING else is --------------------
   19,388 browser players put back 176 hides (0.9%); in the app 3,261 put back 2,877 (88%). So
   the unlimited feed is what the wall is for. Every risk in this change is a wall one door too
   far left — on a stranger's first visit, on somebody who just published, or inside the app —
   and none of those is visible in a diff: they are a localStorage counter, an opts flag and a
   wrapper test. The suite drives all three from the real controls. */
try {
  const out = execFileSync(process.execPath, [join(ROOT, 'scripts', 'test-feedwall-dom.mjs')], { stdio: 'pipe' }).toString();
  out.includes('skipping')
    ? skipped('test-feedwall-dom.mjs', 'FEED-WALL TEST', out)
    : ok('the wall is on the feed, and only on the feed (node scripts/test-feedwall-dom.mjs)');
} catch (e) {
  bad('THE WEB FEED WALL IS IN THE WRONG PLACE:\n' + why(e));
}

/* THE POST-SEND INSTALL OFFER, and the two ways it goes wrong are opposites. Shown inside the
   wrapper it sells the app to somebody holding it, on the most-seen surface in the product,
   after every send. Shown before anything is sent it is an advert on a sheet nobody has used.
   Both are one edited condition away, and neither is visible in a diff — so the suite asserts
   the TRANSITION (hidden, send, visible) from a browser, and test-share-dom asserts the
   silence from the wrapper. */
try {
  const out = execFileSync(process.execPath, [join(ROOT, 'scripts', 'test-sentcta-dom.mjs')], { stdio: 'pipe' }).toString();
  out.includes('skipping')
    ? skipped('test-sentcta-dom.mjs', 'SENT-CTA TEST', out)
    : ok('the app is offered after the send, and only in a browser (node scripts/test-sentcta-dom.mjs)');
} catch (e) {
  bad('THE POST-SEND OFFER IS WRONG:\n' + why(e));
}

/* WHICH IMPRESSION THE PAYWALL SPENDS, AND WHERE IT STOPS. The nth split says the first
   paywall of an install converts at 3.4% and every later one at ~1.5%, and that nothing past
   the 8th has ever converted at all. Both rules that follow are invisible in a screenshot and
   fail silently — a paywall that opens when it should not looks exactly like a paywall — so
   they are asserted on the wire, and as PAIRS: refused on a fresh device AND opened once it
   has seen one, because a paywall that never opens would pass either half alone. */
try {
  const out = execFileSync(process.execPath, [join(ROOT, 'scripts', 'test-pwgate-dom.mjs')], { stdio: 'pipe' }).toString();
  out.includes('skipping')
    ? skipped('test-pwgate-dom.mjs', 'PAYWALL-GATE TEST', out)
    : ok('every install is offered once and the tail stays capped (node scripts/test-pwgate-dom.mjs)');
} catch (e) {
  bad('THE FIRST-OFFER GUARANTEE OR THE TAIL CAP IS BROKEN:\n' + why(e));
}

/* ---- 12b-septies. The record the broken run names ------------------------------------------
   The run pill lives one row from the headline, and the fix for that is a MOVE — .dead goes
   static inside .chTop before it prints prose. Adding the record lengthened that prose, so the
   guarantee is now geometric rather than a copy length somebody can eyeball: the test reads
   both rectangles out of a browser at 390px and 320px and intersects them. It also holds the
   silence at equality, which is the half a later edit deletes without noticing. */
try {
  const out = execFileSync(process.execPath, [join(ROOT, 'scripts', 'test-runrec-dom.mjs')], { stdio: 'pipe' }).toString();
  out.includes('skipping')
    ? skipped('test-runrec-dom.mjs', 'RUN-RECORD TEST', out)
    : ok('the record speaks on the break and stays off the title (node scripts/test-runrec-dom.mjs)');
} catch (e) {
  bad('THE BROKEN RUN IS LANDING ON THE HEADLINE OR MISSTATING THE RECORD:\n' + why(e));
}

/* ---- 12c. The spectator seat ------------------------------------------------------------
   The replay animates a recorded transform into a travelling viewport, and its ending has
   to differ by outcome. One assertion there is a security boundary rather than a polish
   check: a round that ended in a FIND must end with NO buzz marker, because
   get_seek_traces strips the winning coordinates server-side so this screen can never be
   turned into a cheat sheet by someone holding a challenge link. */
try {
  const out = execFileSync(process.execPath, [join(ROOT, 'scripts', 'test-replay-dom.mjs')], { stdio: 'pipe' }).toString();
  out.includes('skipping')
    ? skipped('test-replay-dom.mjs', 'REPLAY TEST', out)
    : ok('the replay plays and never leaks the winning spot (node scripts/test-replay-dom.mjs)');
} catch (e) {
  bad('THE REPLAY IS BROKEN:\n' + why(e));
}

/* ---- 12d. The bell on your own hide ------------------------------------------------------
   The one notification opt-in the user opens rather than one we interrupt with. Every way it
   can be wrong looks correct on screen: offered on a stranger's slide (where the promise is
   a lie), offered to somebody who already granted, offered in a browser or on a wrapper that
   cannot answer it, or claiming success on a refusal. */
try {
  const out = execFileSync(process.execPath, [join(ROOT, 'scripts', 'test-bell-dom.mjs')], { stdio: 'pipe' }).toString();
  out.includes('skipping')
    ? skipped('test-bell-dom.mjs', 'BELL TEST', out)
    : ok('the notification bell is offered where it is true, and answers honestly (node scripts/test-bell-dom.mjs)');
} catch (e) {
  bad('THE NOTIFICATION BELL IS BROKEN:\n' + why(e));
}

/* ---- 12e. The card on slide 4 ------------------------------------------------------------
   The feed's first ask, and it is half an experiment: the holdout is the only thing that makes
   its effect separable from an ad spend that doubled the traffic every day it shipped into. So
   the ways it can be wrong are not all cosmetic. Shown to somebody who already publishes is an
   insult; shown to the control arm is not a smaller effect but no measurement at all; mounted
   under the paywall it files an impression nobody saw and deflates the only ratio it has; and
   deferred by that paywall WITHOUT a retry it never appears for the session at all. The tap
   also has to leave without the live round underneath booking it as a guess. */
try {
  const out = execFileSync(process.execPath, [join(ROOT, 'scripts', 'test-feedgate-dom.mjs')], { stdio: 'pipe' }).toString();
  out.includes('skipping')
    ? skipped('test-feedgate-dom.mjs', 'FEED GATE TEST', out)
    : ok('the feed asks once, of the right person, and counts it once (node scripts/test-feedgate-dom.mjs)');
} catch (e) {
  bad('THE FEED\'S FIRST ASK IS BROKEN:\n' + why(e));
}

/* The opener experiment: the banger's POSITION obeys bangerArm, and nothing else moves. A
   leaking holdout, a creator shown the opener, two bangers in one session, a seen opener
   rerunning, or a duplicated slide from the cached first page — every one of these renders a
   perfectly normal-looking feed and quietly unreads the experiment. */
try {
  const out = execFileSync(process.execPath, [join(ROOT, 'scripts', 'test-banger-dom.mjs')], { stdio: 'pipe' }).toString();
  out.includes('skipping')
    ? skipped('test-banger-dom.mjs', 'BANGER-OPENER TEST', out)
    : ok('the proven opener obeys its arm, once per session, position only (node scripts/test-banger-dom.mjs)');
} catch (e) {
  bad('THE OPENER EXPERIMENT IS BROKEN:\n' + why(e));
}

/* A device that cannot create a WebGL context must get hunt-only mode, not a black screen.
   initThree() runs at module top level; before this guard existed, that throw killed
   everything after it — seeker, feed, tracking — and looked exactly like churn (17 devices
   in the beacon's first 12 hours). The test drives the real failure: getContext() null. */
try {
  const out = execFileSync(process.execPath, [join(ROOT, 'scripts', 'test-webgl-dead.mjs')], { stdio: 'pipe' }).toString();
  out.includes('skipping')
    ? skipped('test-webgl-dead.mjs', 'WEBGL-DEAD TEST', out)
    : ok('a GL-less phone gets hunt-only mode, not a black screen (node scripts/test-webgl-dead.mjs)');
} catch (e) {
  bad('HUNT-ONLY MODE IS BROKEN:\n' + why(e));
}

/* The handle crosses a trust boundary: one user types it, another user's phone renders it.
   It is narrowed in the page and again in create_hide, and this is the assertion that the
   third layer never becomes markup. A single innerHTML here would undo both. */
{
  /* MATCHED ON THE INTENT, NOT ON THE SHAPE. This pinned the exact expression
     `textContent = h.name ?`, so the day the headline gained a second branch (the first feed
     slide says the sentence, the rest say the name) it went red on a change that kept both
     properties it exists to protect. What must stay true is narrower and worth stating: the
     headline is written with textContent, it still reads h.name, and chHead never takes
     innerHTML anywhere in the file. */
  const assign = html.match(/\$\$\("chHead"\)\.textContent\s*=([\s\S]{0,400}?);/);
  const seek = assign && /h\.name/.test(assign[1]) && !/\$\$\("chHead"\)\.innerHTML/.test(html);
  seek
    ? ok('the seeker headline names the sender, via textContent')
    : bad('the seeker headline no longer branches on h.name through textContent — either the '
        + 'signature is gone or it is being written as HTML, and the value comes off a stranger\'s device');
}

/* ---- 13. The control the paywall sells --------------------------------------------------
   "KAMO+ unlocks the whole range, down to fine detail" is a promise about a slider, made to
   someone deciding whether to pay. A member silently snapped to the three presets looks exactly
   like normal use — the bar renders the same either way apart from a 10px thumb — so nothing
   would report it except the person who paid. */
try {
  const out = execFileSync(process.execPath, [join(ROOT, 'scripts', 'test-brush-dom.mjs')], { stdio: 'pipe' }).toString();
  out.includes('skipping')
    ? skipped('test-brush-dom.mjs', 'BRUSH TEST', out)
    : ok('members get the brush range they paid for (node scripts/test-brush-dom.mjs)');
} catch (e) {
  bad('THE BRUSH RANGE IS BROKEN:\n' + why(e));
}

/* ---- 13-bis. The two escapes from a bad stroke ------------------------------------------
   Undo and Clear are the only way back out of a stroke that went wrong, on a board with an
   89-second clock running over it — and both of them were quietly wrong for as long as nothing
   watched them. Undo popped the top of the stack and then painted what was UNDERNEATH it, so
   the first tap took the good stroke as well as the bad one and the last tap did nothing;
   Clear read the blank board off the front of the same stack, which the budget trim had been
   shifting away since the seventh stroke. Neither throws, neither shows in a diff, and both
   are perfectly visible in the number on the coverage chip — which is what the suite drives,
   with real strokes through the real handlers. */
try {
  const out = execFileSync(process.execPath, [join(ROOT, 'scripts', 'test-undo-dom.mjs')], { stdio: 'pipe' }).toString();
  out.includes('skipping')
    ? skipped('test-undo-dom.mjs', 'UNDO TEST', out)
    : ok('Undo takes back one stroke and Clear takes back all of them (node scripts/test-undo-dom.mjs)');
} catch (e) {
  bad('UNDO OR CLEAR IS BROKEN:\n' + why(e));
}

/* ---- 13-ter. The only channel this app has for a sentence -------------------------------
   showHint() is how "Reported. Thank you.", "Link copied", "Couldn't load the replay", "Still
   going up — give it a second" and "That one is in the app" are all said, and #hint shipped at
   z-index 12 INSIDE #app — a position:fixed element, so a stacking context. Every one of those
   lines was painted, with the right text, underneath the surface that sent it: the reveal, the
   share sheet, a seek round, the feed, My kamos, the player card. The file already worked
   around the hero case in camFail() and nobody generalised it.
   Asserted by hit-testing rather than by z-index arithmetic, because the number alone was
   never the answer — the parent is half of it. */
try {
  const out = execFileSync(process.execPath, [join(ROOT, 'scripts', 'test-toast-dom.mjs')], { stdio: 'pipe' }).toString();
  out.includes('skipping')
    ? skipped('test-toast-dom.mjs', 'TOAST TEST', out)
    : ok('every surface that sends a message can show one (node scripts/test-toast-dom.mjs)');
} catch (e) {
  bad('THE MESSAGE CHANNEL IS BURIED AGAIN:\n' + why(e));
}

/* ---- 13a. What the board does with the photo it was given -------------------------------
   The letterbox is for the camera, whose sensor is wider than the board — a picked photo has no
   cropped-away field of view to buy back, and the bars only spend a third of the screen on a
   blurred, dimmed copy of the picture the user just chose. Every portrait shot off the camera
   roll took them, and they are pixels INSIDE the published image: the seeker opens the hide and
   sees them too. Nothing throws, nothing is logged, and the paint looks deliberate. */
try {
  const out = execFileSync(process.execPath, [join(ROOT, 'scripts', 'test-fit-dom.mjs')], { stdio: 'pipe' }).toString();
  out.includes('skipping')
    ? skipped('test-fit-dom.mjs', 'FRAMING TEST', out)
    : ok('a picked photo fills the board, the camera keeps its bars (node scripts/test-fit-dom.mjs)');
} catch (e) {
  bad('THE FRAMING IS BROKEN:\n' + why(e));
}

/* ---- 13a-bis. The crop the user drags ----------------------------------------------------
   Filling the board with a picked photo spends a third of its width, and which third is now the
   user's choice — dragged on the live <img> under a CSS transform, painted by coverInto()
   sampling a source rect. Two machines, one state, nothing forcing them to agree; when they
   stop agreeing the picture jumps at the shutter and photoFrame reads correct in both. */
try {
  const out = execFileSync(process.execPath, [join(ROOT, 'scripts', 'test-reframe-dom.mjs')], { stdio: 'pipe' }).toString();
  out.includes('skipping')
    ? skipped('test-reframe-dom.mjs', 'REFRAME TEST', out)
    : ok('the crop the user drags is the crop that gets painted (node scripts/test-reframe-dom.mjs)');
} catch (e) {
  bad('THE PHOTO CROP IS BROKEN:\n' + why(e));
}

/* ---- 13b. The clock the session clip runs on --------------------------------------------
   The Instagram share is the round played back at its real length, and every way of getting
   that wrong still produces a video: marks offset from frames, a stroke held for zero
   milliseconds, a four-minute clip Stories will truncate mid-reveal. Nothing throws, nothing
   is logged, and the only witness is someone watching the output. */
try {
  const out = execFileSync(process.execPath, [join(ROOT, 'scripts', 'test-session-dom.mjs')], { stdio: 'pipe' }).toString();
  out.includes('skipping')
    ? skipped('test-session-dom.mjs', 'SESSION TEST', out)
    : ok('the session clip runs at the length of the round (node scripts/test-session-dom.mjs)');
} catch (e) {
  bad('THE SESSION CLIP\'S TIMELINE IS BROKEN:\n' + why(e));
}

/* ---- 14. The end of the viral loop ------------------------------------------------------
   The seeker's "Play KAMO" is the only link in this file that leads to an install, and it is
   the one App Store link the native wrapper can never improve — the seeker screen runs in a
   stranger's browser, so window.KAMO.setAppLink is never called there. Losing the OneLink on
   it costs nothing visible: taps keep counting, installs keep arriving, and only the
   attribution goes quiet. */
try {
  const out = execFileSync(process.execPath, [join(ROOT, 'scripts', 'test-reflink-dom.mjs')], { stdio: 'pipe' }).toString();
  out.includes('skipping')
    ? skipped('test-reflink-dom.mjs', 'REFERRAL-LINK TEST', out)
    : ok('the seeker CTA is attributed (node scripts/test-reflink-dom.mjs)');
} catch (e) {
  bad('THE REFERRAL LINK IS BROKEN:\n' + why(e));
}

/* The other silent measurement failure, and the reason it needs a wire-level test rather than
   a reading of the file: `app_variant` has to reach Amplitude as a USER property, because that
   is what `gp:app_variant` means and what every per-variant dashboard segments on. Written into
   event_properties alone it renders fine, resolves fine, and reports the native population as
   though it were the whole app — 97% of KAMO is a plain browser, and it sat outside the segment
   from the day the web path shipped until 2026-08-15. Both emitters are covered: chWebTrack and
   the boot-crash beacon, which duplicates the key and the device id and so must duplicate this. */
try {
  const out = execFileSync(process.execPath, [join(ROOT, 'scripts', 'test-variantprop-dom.mjs')], { stdio: 'pipe' }).toString();
  out.includes('skipping')
    ? skipped('test-variantprop-dom.mjs', 'VARIANT-PROPERTY TEST', out)
    : ok('the web names its variant to Amplitude as a user property (node scripts/test-variantprop-dom.mjs)');
} catch (e) {
  bad('THE WEB IS INVISIBLE IN THE VARIANT DASHBOARDS:\n' + why(e));
}

/* The runtime half of 5c-ter. The static check can see that two guards are written; only a
   browser can say that the router actually emits one name per action across the four worlds
   that exist — eventsV2, an old build that announced its caps, a build that announced none,
   and no wrapper at all. The middle two are the ones a "simplification" would delete, and
   they are the only reason carriers exist. The Buy tap is then driven for real, because the
   doubling was found on the path that pays and that is where it must stay found. */
try {
  const out = execFileSync(process.execPath, [join(ROOT, 'scripts', 'test-carrier-dom.mjs')], { stdio: 'pipe' }).toString();
  out.includes('skipping')
    ? skipped('test-carrier-dom.mjs', 'CARRIER TEST', out)
    : ok('one action emits one event name, on every build (node scripts/test-carrier-dom.mjs)');
} catch (e) {
  bad('AN ACTION IS BEING COUNTED TWICE:\n' + why(e));
}

/* The regression this change exists to prevent, asserted on the source as well as at runtime:
   a bare `location.href=appLink` in the seeker handler is one keystroke away, and it would put
   every referred install back into the organic bucket with nothing on screen to show for it. */
{
  const cta = html.match(/\$\$\("chGo"\)\.onclick[\s\S]{0,300}?location\.href[^;]*;/);
  if (!cta) bad('the seeker CTA handler is gone — #chGo no longer navigates anywhere');
  else if (/location\.href\s*=\s*appLink\s*;/.test(cta[0]))
    bad('the seeker CTA navigates straight to appLink again — referred installs will land as organic');
  else if (!/refLink\(/.test(cta[0]))
    bad('the seeker CTA no longer routes through refLink() — attribution on the viral loop is gone');
  else ok('the seeker CTA still routes through refLink(), not the bare listing');
}

/* THE ID MUST NOT GO BACK BEHIND THE BYTES.
   This has now shipped broken twice, and both times it read as a share bug rather than an
   ordering bug: create_hide was reachable only after `await chPrepare()`, so the link did not
   exist until a ~200KB JPEG had crossed the network, and every send inside that window went
   out as the generic invite with a ?i=1 link and no game behind it. On the web path — which
   cannot wait at all, because navigator.share needs the tap's activation — that was 6 sends
   in 10 across 12-13 Aug.
   The runtime assertion lives in test-share-dom (ROUND 4) and is the real one. This is the
   cheap one that fires without a browser, because the reordering it guards against is a
   two-line refactor that reads perfectly reasonably in a diff. */
{
  const up = html.match(/async function chUpload\(\)\{[\s\S]*?\n\}/);
  if (!up) bad('chUpload() is gone — the publish path cannot be checked');
  else {
    /* Sliced at the CALL, not at the string: "create_hide" is named in three comments inside
       this function, the first of them 196 characters in, and slicing there cut the window
       off before the code it exists to read. */
    const call = up[0].indexOf('chRpc("create_hide"');
    const head = call < 0 ? '' : up[0].slice(0, call);
    if (call < 0)
      bad('chUpload() no longer calls chRpc("create_hide", …) — the publish path cannot be checked');
    else if (/await\s+chPrepare\s*\(/.test(head))
      bad('chUpload() awaits chPrepare() BEFORE create_hide — the hide id is queued behind the\n'
        + '    image upload again, so every share in that 3-6s window sends the generic invite\n'
        + '    and a ?i=1 link with no hide in it. Take the name from chSlot() and let the bytes\n'
        + '    travel on their own; see the note above chSlot().');
    else if (!/const\s+slot\s*=\s*chSlot\(\)/.test(head))
      bad('chUpload() no longer takes its storage name from chSlot() — the id is only as fast\n'
        + '    as whatever now produces that name.');
    else ok('the hide id is taken from chSlot(), not awaited behind the upload');
  }
}

/* ---- 15. The claim App Review rejected --------------------------------------------------
   1.0.9 (42) was rejected on guideline 2.1(b): the paywall advertised a 3-day trial while
   Apple's payment sheet showed none. The screen must never promise an offer the store did
   not return — and, just as importantly, must keep promising it on 1.0.2, which cannot
   report either way and is 99.7% of the fleet. */
try {
  const out = execFileSync(process.execPath, [join(ROOT, 'scripts', 'test-trial-copy-dom.mjs')], { stdio: 'pipe' }).toString();
  out.includes('skipping')
    ? skipped('test-trial-copy-dom.mjs', 'TRIAL-COPY TEST', out)
    : ok('the paywall promises only what the store returned (node scripts/test-trial-copy-dom.mjs)');
} catch (e) {
  bad('THE TRIAL COPY IS BROKEN:\n' + why(e));
}

/* THE FEED'S load() MUST HAND A JOINER THE PAGE IT IS ALREADY FETCHING.
   Every caller pages off this promise — `load().then(paint)` in the opening sequence, in the
   second lap, in the Retry card and in dry(), the path everything left after the black-
   rectangle filter takes a page away. While it was `async function load(){ if(S.loading)
   return; …}` a second caller got a promise that had ALREADY resolved, so paint() ran against
   an empty slide list and drew the cold start — "Nothing here yet.", the invitation to publish
   the very first hide — milliseconds before the page in flight appended its slides and the
   IntersectionObserver started a round underneath it. Nothing takes that card down: midOff()
   only runs inside a paint(), and no second paint is coming. It shipped, and the founder
   photographed it on 2026-08-17.
   Asserted structurally because the race is a matter of microseconds on a real device and a
   DOM test would have to lose it on purpose to catch anything. */
{
  const m = html.match(/\n  function load\(\)\{[\s\S]*?\n  \}/);
  if (!m) bad('the feed\'s load() is gone or is async again — a joiner cannot be checked for the\n'
    + '    in-flight page, and an async load() with a bare `if(S.loading) return` is exactly the\n'
    + '    bug: paint() then draws "Nothing here yet." over a round that is about to start.');
  else if (!/if\(S\.loading\)\s*return\s+S\.inflight/.test(m[0]))
    bad('load() no longer hands the in-flight promise to a concurrent caller — whatever it\n'
      + '    returns instead resolves before a single row has landed, and every `load().then(paint)`\n'
      + '    paints an empty feed on top of one that is loading.');
  else ok('a concurrent load() joins the page in flight instead of resolving empty');
}

/* nativeCaps is read by trialAdvertised(), which applyTrialCopy() calls at module scope. A
   `let` declared after that call is a temporal-dead-zone throw that kills the whole script
   before window.KAMO exists — a blank app for every user, from one moved line. */
{
  const decl = html.indexOf('let nativeCaps={}');
  const use = html.indexOf('\napplyTrialCopy();');
  decl === -1 ? bad('let nativeCaps={} is gone — trialAdvertised() has nothing to read')
    : use === -1 ? bad('the module-scope applyTrialCopy() call is gone')
    : decl < use ? ok('nativeCaps is declared before the module-scope applyTrialCopy() call')
    : bad('nativeCaps is declared AFTER applyTrialCopy() runs — TDZ ReferenceError, blank app for everyone');
}

if (staleSuites.length) {
  console.log(`\n! ${staleSuites.length} quarantined suite(s) — real coverage, stale assertions, NOT a regression:`);
  staleSuites.forEach((n) => console.log('    - ' + n));
  console.log('  Rewrite them against the shipped design and drop them from `stale(...)` in the same commit.');
}
console.log(failed ? `\n✗ ${failed} problem(s) — DO NOT PUSH` : '\n✓ all checks passed');
process.exit(failed ? 1 : 0);
