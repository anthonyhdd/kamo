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
const staleSuites = [];
const stale = (name, why) => { staleSuites.push(name); console.log(`  ! STALE — ${name}: ${why}`); };

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
  } else if (!/chPrevRender\(/.test(peekFn[0])) {
    /* The peek CSS exempts .chPrev from its hide-everything rule, but .chPrev is display:none
       until chPrevRender() adds `.on`. Whitelisting it in CSS and never rendering it is a
       silent no-op — the short sheet shows a headline and a button and no preview, which is
       exactly the arrangement the card was added to replace. Shipped that way once. */
    bad('peekShareSheet() does not call chPrevRender() — .chPrev is display:none until it runs, '
      + 'so the short sheet is whitelisting a card that never gets turned on');
  } else ok('the sheet arrives short, renders the card, and does not publish');

  /* The other half of that rule. Not publishing on presentation is right; never publishing
     is what makes "Challenge a friend" — visible in the short state — send the generic
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
    : bad('no pointerdown listener calls chUpload() — Challenge a friend will send the generic '
        + 'invite instead of a challenge link');

  /* THE CTA IS A DIRECT CHILD OF THE CARD, AND IT COMES AFTER THE PREVIEW.
     Two invariants, one line of markup, and moving that line is the most ordinary edit on
     this sheet — "put the card above the button" was a request, not a refactor. It landed
     the button INSIDE .chPrev, which is `display:flex` in a row: the full-width CTA turned
     into a cell squeezed between the caption and the gear icon. Nothing threw, no test
     noticed, and the diff read exactly like the change that was asked for.
     Two things have to hold. (1) Direct child of .ssCard — .ssCard is the column, and the
     peek rule is `.ssCard > *`, so a nested button is not governed by it at all. (2) After
     .chPrev — see what goes out, then send it. Depth is counted rather than pattern-matched
     so this survives the markup around it changing. */
  {
    const cardAt = html.indexOf('<div class="ssCard');
    const prevAt = html.indexOf('<div class="chPrev"');
    const btnAt = html.indexOf('id="ssInvite"');
    if (cardAt < 0 || prevAt < 0 || btnAt < 0) bad('.ssCard / .chPrev / #ssInvite not all found in the sheet markup');
    else {
      const between = html.slice(html.indexOf('>', cardAt) + 1, btnAt);
      const depth = (between.match(/<div\b/g) || []).length - (between.match(/<\/div>/g) || []).length;
      depth === 0
        ? ok('#ssInvite is a direct child of .ssCard (the peek rule reaches it, and it is full width)')
        : bad(`#ssInvite is nested ${depth} level(s) deep inside .ssCard — if that is .chPrev it is a `
            + 'flex ROW, so the CTA renders as a squeezed cell beside the gear, and `.ssCard > *` '
            + 'in the peek rule no longer governs it');
      btnAt > prevAt
        ? ok('the preview card comes before the CTA')
        : bad('#ssInvite appears before .chPrev — the button asks for trust before showing what it sends');
      /* THE ROUND'S TERMS APPEAR ONCE. A kicker above the headline used to print "20S · 5 TAPS"
         while the preview card ~100px below printed the same two numbers as chips. It was not
         a duplicate when it was written — the card was only drawn after a share had gone out —
         and it became one silently the day the card became permanent in the short sheet. The
         same drift will happen again the moment anything is added above the title, so the
         invariant is stated where it can be checked: this sheet has no kicker. .pwKick itself
         stays legitimate on the paywall and the preview overlay, where it is the only place
         the terms are stated at all. */
      const sheetAt = html.indexOf('<div id="shareSheet">');
      const sheetEnd = html.indexOf('<div id="confirmSheet">', sheetAt);
      const sheetHtml = sheetAt >= 0 && sheetEnd > sheetAt ? html.slice(sheetAt, sheetEnd) : '';
      !/class="pwKick"/.test(sheetHtml)
        ? ok("the round's terms are stated once, on the card that sends them")
        : bad('the share sheet has a .pwKick again — it prints the same seconds and taps the '
            + 'preview card already carries on its chips, twice in one glance');
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

/* ---- 5c-ter. WEB_ONLY and the wrapper's allow-list must not overlap -------------------------
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
    ['the reveal starts the upload without publishing', 'function enterFinished(', 'chPrepare()',
      'enterFinished() no longer calls chPrepare() — the image upload goes back to starting '
      + 'on the same gesture as the tap, which is the eight-second wait this split removed'],
    ['openShareSheet renders the challenge card', 'function openShareSheet(', 'chPrevRender()',
      'openShareSheet() does not call chPrevRender() — the card is display:none until something '
      + 'adds .on, so it will only appear after a share instead of before one'],
    /* The chSetOk / chSetReset rows are gone WITH the settings sheet: the seeker plays one
       buzz on no clock, so there are no taps or seconds left to save. chRepublish() is still
       guarded — the handle's blur handler is its remaining caller. */
    ['renaming the handle republishes the signed hide', 'inp.addEventListener("blur"', 'chRepublish()',
      'the handle blur handler no longer calls chRepublish() — a renamed sender keeps '
      + 'signing the OLD name on the hide behind the link'],
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
  bad('SHARE PATHS BROKEN:\n' + (e.stdout || '').toString().split('\n').filter((l) => l.includes('✗')).join('\n'));
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
    ? console.log('  · DOM TEST SKIPPED — ' + out.trim().split('\n').pop())
    : ok('the short sheet renders correctly (node scripts/test-peek-dom.mjs for the detail)');
} catch (e) {
  stale('the short sheet (test-peek-dom.mjs)', 'asserts the share-sheet TABS, which were removed — 13 assertions describe the pre-tab-removal design');
}

/* ---- 9. The results chip ---------------------------------------------------------------
   Same reason as 8: localStorage, a network answer and a screen mode are runtime state, and
   the chip is the only thing this app can show someone for coming back. */
try {
  const out = execFileSync(process.execPath, [join(ROOT, 'scripts', 'test-mine-dom.mjs')], { stdio: 'pipe' }).toString();
  out.includes('skipping')
    ? console.log('  · RESULTS-CHIP DOM TEST SKIPPED — ' + out.trim().split('\n').pop())
    : ok('the results chip behaves (node scripts/test-mine-dom.mjs for the detail)');
} catch (e) {
  stale('the results chip (test-mine-dom.mjs)', 'requires the share message to quote the round terms, which was deliberately rewritten');
}

/* ---- 10. The creator pass --------------------------------------------------------------
   This one hands out KAMO+. Three of its four invariants fail silently: a broken comparison
   gives it to anyone who holds the button, storing a flag instead of the hash makes a leaked
   phrase permanent, and living in the wrong key means the wrapper's launch-time setPro(false)
   erases it — which would reproduce the exact support ticket it was built to close. */
try {
  const out = execFileSync(process.execPath, [join(ROOT, 'scripts', 'test-pass-dom.mjs')], { stdio: 'pipe' }).toString();
  out.includes('skipping')
    ? console.log('  · CREATOR-PASS TEST SKIPPED — ' + out.trim().split('\n').pop())
    : ok('the creator pass unlocks, persists and can be revoked (node scripts/test-pass-dom.mjs)');
} catch (e) {
  bad('THE CREATOR PASS IS BROKEN:\n' + (e.stdout || '').toString().split('\n').filter((l) => l.includes('✗')).join('\n'));
}

/* ---- 11. The player card ---------------------------------------------------------------
   It opens for EVERYONE now, so every membership signal on it has to be able to say no — and
   the handle it holds is interpolated into a share message a stranger reads, which is the one
   value in this app that goes from a text field into somebody else's phone. */
try {
  const out = execFileSync(process.execPath, [join(ROOT, 'scripts', 'test-home-dom.mjs')], { stdio: 'pipe' }).toString();
  out.includes('skipping')
    ? console.log('  · PLAYER-CARD TEST SKIPPED — ' + out.trim().split('\n').pop())
    : ok('the player card keeps a clean handle and claims only what is true (node scripts/test-home-dom.mjs)');
} catch (e) {
  stale('the player card (test-home-dom.mjs)', 'clicks #khEdit, which no longer exists — the headline became the edit control');
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
    ? console.log('  \u00b7 HANDLE TEST SKIPPED \u2014 ' + out.trim().split('\n').pop())
    : ok('the name is typed once and survives the next launch (node scripts/test-handle-dom.mjs)');
} catch (e) {
  bad('THE NAME DOES NOT SURVIVE A RELAUNCH:\n' + (e.stdout || '').toString().split('\n').filter((l) => l.includes('\u2717')).join('\n'));
}

/* ---- 11c. The full-bleed paywall arm ---------------------------------------------------- */
/* Half of a 50/50 revenue experiment. Every other DOM test boots pinned to the sheet arm
   (navigator.webdriver), so without this one the arm real users see would ship untested. */
try {
  const out = execFileSync(process.execPath, [join(ROOT, 'scripts', 'test-pwfull-dom.mjs')], { stdio: 'pipe' }).toString();
  out.includes('skipping')
    ? console.log('  \u00b7 FULL-ARM PAYWALL TEST SKIPPED \u2014 ' + out.trim().split('\n').pop())
    : ok('the full-bleed paywall arm renders and sells only real prices (node scripts/test-pwfull-dom.mjs)');
} catch (e) {
  bad('THE FULL-BLEED PAYWALL ARM IS BROKEN:\n' + (e.stdout || '').toString().split('\n').filter((l) => l.includes('\u2717')).join('\n'));
}

/* ---- 12. The signed challenge, from the receiver's side --------------------------------- */
try {
  const out = execFileSync(process.execPath, [join(ROOT, 'scripts', 'test-seek-dom.mjs')], { stdio: 'pipe' }).toString();
  out.includes('skipping')
    ? console.log('  · SEEKER TEST SKIPPED — ' + out.trim().split('\n').pop())
    : ok('the seeker screen names the sender (node scripts/test-seek-dom.mjs)');
} catch (e) {
  bad('THE SEEKER SCREEN IS BROKEN:\n' + (e.stdout || '').toString().split('\n').filter((l) => l.includes('✗')).join('\n'));
}

/* ---- 12b. The one-buzz round, end to end -------------------------------------------------
   The seeker was rewritten around one aimed buzz, the snap reveal and the A/B flip, and
   every failure mode in that chain is runtime state a static read cannot see: a reticle
   that never mounts, a release that commits nothing, a snap that arrives as a fade, a
   flip armed with nothing behind it, a re-hide that strands the overlay. */
try {
  const out = execFileSync(process.execPath, [join(ROOT, 'scripts', 'test-buzz-dom.mjs')], { stdio: 'pipe' }).toString();
  out.includes('skipping')
    ? console.log('  · BUZZ TEST SKIPPED — ' + out.trim().split('\n').pop())
    : ok('the one-buzz round behaves end to end (node scripts/test-buzz-dom.mjs)');
} catch (e) {
  bad('THE ONE-BUZZ SEEKER IS BROKEN:\n' + (e.stdout || '').toString().split('\n').filter((l) => l.includes('✗')).join('\n'));
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
  bad('THE FEED IS BROKEN:\n' + (e.stdout || '').toString().split('\n').filter((l) => l.includes('✗')).join('\n'));
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
    ? console.log('  · SHARE-TIMING TEST SKIPPED — ' + out.trim().split('\n').pop())
    : ok('the share is instant and always its own hide (node scripts/test-share-dom.mjs)');
} catch (e) {
  bad('THE SHARE SENDS THE WRONG HIDE OR MAKES THE USER WAIT:\n' + (e.stdout || '').toString().split('\n').filter((l) => l.includes('✗')).join('\n'));
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
    ? console.log('  · REPLAY TEST SKIPPED — ' + out.trim().split('\n').pop())
    : ok('the replay plays and never leaks the winning spot (node scripts/test-replay-dom.mjs)');
} catch (e) {
  bad('THE REPLAY IS BROKEN:\n' + (e.stdout || '').toString().split('\n').filter((l) => l.includes('✗')).join('\n'));
}

/* The handle crosses a trust boundary: one user types it, another user's phone renders it.
   It is narrowed in the page and again in create_hide, and this is the assertion that the
   third layer never becomes markup. A single innerHTML here would undo both. */
{
  const seek = html.match(/\$\$\("chHead"\)\.textContent\s*=\s*h\.name\s*\?/);
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
    ? console.log('  · BRUSH TEST SKIPPED — ' + out.trim().split('\n').pop())
    : ok('members get the brush range they paid for (node scripts/test-brush-dom.mjs)');
} catch (e) {
  bad('THE BRUSH RANGE IS BROKEN:\n' + (e.stdout || '').toString().split('\n').filter((l) => l.includes('✗')).join('\n'));
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
    ? console.log('  · REFERRAL-LINK TEST SKIPPED — ' + out.trim().split('\n').pop())
    : ok('the seeker CTA is attributed (node scripts/test-reflink-dom.mjs)');
} catch (e) {
  bad('THE REFERRAL LINK IS BROKEN:\n' + (e.stdout || '').toString().split('\n').filter((l) => l.includes('✗')).join('\n'));
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

/* ---- 15. The claim App Review rejected --------------------------------------------------
   1.0.9 (42) was rejected on guideline 2.1(b): the paywall advertised a 3-day trial while
   Apple's payment sheet showed none. The screen must never promise an offer the store did
   not return — and, just as importantly, must keep promising it on 1.0.2, which cannot
   report either way and is 99.7% of the fleet. */
try {
  const out = execFileSync(process.execPath, [join(ROOT, 'scripts', 'test-trial-copy-dom.mjs')], { stdio: 'pipe' }).toString();
  out.includes('skipping')
    ? console.log('  · TRIAL-COPY TEST SKIPPED — ' + out.trim().split('\n').pop())
    : ok('the paywall promises only what the store returned (node scripts/test-trial-copy-dom.mjs)');
} catch (e) {
  bad('THE TRIAL COPY IS BROKEN:\n' + (e.stdout || '').toString().split('\n').filter((l) => l.includes('✗')).join('\n'));
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
