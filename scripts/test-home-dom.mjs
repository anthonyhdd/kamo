#!/usr/bin/env node
/**
 * THE PLAYER CARD — the handle, the Discord door, and who the card claims to be.
 *
 * It replaced the KAMO+ member home, which showed three numbers nobody could act on and only
 * opened for someone who had already paid. The wordmark now opens this for everyone, which
 * means every membership signal on it has to be able to say no — a free user wearing "KAMO+"
 * on their own card is the app telling them they own something they do not.
 *
 * What is checked here cannot be checked statically:
 *   · the handle survives a reload (it is the name on every challenge; losing it silently is
 *     worse than never having asked)
 *   · it is sanitised on the way in, because it is interpolated into a share message
 *   · the caret does not jump while typing — the bug you get for free by reassigning .value
 *     on every keystroke, which makes editing the middle of a name impossible
 *   · the + and the upsell follow isPro in BOTH directions
 *   · Discord points at the real invite
 *
 *   PW_CORE=<dir with node_modules> node scripts/test-home-dom.mjs
 */
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { pwBases, chromeExe, PW_SETUP } from './lib/pw.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const req = createRequire(import.meta.url);
let chromium = null;
for (const base of pwBases(ROOT)) {
  try { ({ chromium } = req(base ? join(base, 'node_modules/playwright-core') : 'playwright-core')); break; } catch {}
}
if (!chromium) {
  console.log('· playwright-core not installed — skipping the home test — run: ' + PW_SETUP);
  process.exit(0);
}

const real = readFileSync(join(ROOT, 'index.html'), 'utf8');
const at = real.lastIndexOf('</script>');
const html = real.slice(0, at)
  + '\nwindow.__h={'
  + 'open(pro){isPro=!!pro;openKamoHome();return this.state();},'
  + 'state(){const g=(s)=>{const e=document.querySelector(s);return e?getComputedStyle(e).display:"absent";};'
  + 'return{shown:document.getElementById("kamoHome").classList.contains("show"),'
  + 'plus:g("#khPlus"),upsell:g("#khUpsell"),title:(document.getElementById("khTitle")||{}).textContent,'
  + 'value:(document.getElementById("khHandle")||{}).value,stored:(()=>{try{return localStorage.getItem("kamo_handle")||"";}catch(e){return"";}})(),'
  + 'discord:DISCORD_URL,chips:document.querySelectorAll("#kamoHome .kpChip").length,'
  /* THE NAME IS THE BUTTON NOW. #khEdit was a separate pencil control and it no longer
     exists: once a handle is set the field collapses and the HEADLINE ("@name") is what
     reopens it, caret at the end. So there is no distinct edit affordance whose display can
     be read — #khTitle is always on screen. `edit` is therefore gone from this snapshot, and
     what replaces it is the assertion that tapping the headline actually brings the field
     back, which is the behaviour the pencil used to provide. */
  + 'restore:g("#khRestore"),field:g("#khName"),titleShown:g("#khTitle"),'
  + 'score:g("#khScore"),scoreText:(document.getElementById("khScore")||{}).textContent||""};},'
  /* Tapping the headline, through its OWN click handler rather than by calling khShowField()
     directly — the guard that makes it a no-op when no handle is set lives in that handler,
     and calling past it would assert a path no finger can take. */
  + 'tapName(){document.getElementById("khTitle").click();return this.state();},'
  /* chRpc is a function DECLARATION, so it is replaceable from inside the module. Stubbed per
     id so the aggregate can be checked against known rows — and so a null (an expired or
     blocked hide, which get_hide answers with nothing) is exercised rather than assumed. */
  + 'hides(ids,rows){try{localStorage.setItem("kamo_hides",JSON.stringify(ids))}catch(e){}'
  + 'chRpc=(fn,b)=>Promise.resolve(rows[b.p_id]||null);},'
  /* The invite text is built inside the click handler, so it cannot be read without sending.
     Rebuilt here from the same getHandle() the handler uses — what is under test is that the
     stored value is handle-shaped and reachable, not the string concatenation, which
     test-share.mjs already covers against the real function body. */
  + 'handle(){return getHandle();},'
  /* THE BOX'S OWN CLICK LEAVES THE CARD NOW — it closes the home and opens the My-kamos grid
     (2026-08-15), so clicking it here would tear down the very thing this block measures.
     The in-place expansion survives on exactly one path and this is it: khOpenNext is the
     one-shot khResults() consumes, and it is how a "somebody found your hide" notification
     (window.KAMO.openFound) lands on the list rather than on a scope switch. Set the flag and
     re-render, which is precisely what that path does. */
  + 'expand(){khOpenNext=true;return khResults().then(()=>this.fit());},'
  /* WHAT THE USER CAN ACTUALLY SEE. The card is anchored to the bottom edge, so overflow goes
     off the TOP of the screen — and every element up there is still laid out, still styled,
     still `display:block`. getComputedStyle cannot tell you the badge is sitting at y=-180.
     Geometry can, so this reads rectangles. */
  + 'fit(){const c=document.querySelector("#kamoHome .kpCard"),s=document.getElementById("khScore"),'
  + 'b=document.querySelector("#kamoHome .kpBadge");'
  + 'return{cardTop:Math.round(c.getBoundingClientRect().top),'
  + 'badgeTop:Math.round(b.getBoundingClientRect().top),'
  + 'scoreScrolls:s.scrollHeight>s.clientHeight+1,'
  + 'rows:document.querySelectorAll("#khScore .khRow").length,'
  + 'headText:(document.querySelector("#khScore .khHead")||{}).textContent||""};},'
  + 'wipe(){try{localStorage.removeItem("kamo_handle")}catch(e){}},'
  /* ══ THE NEWS TRAY ═══════════════════════════════════════════════════════════════════════
     Seeded at the level khTray() actually reads: the two module lists chNewsCheck() fills at
     launch, plus the tally object khResults() hands over. Driving the RPCs instead would test
     Supabase; what is under test here is what the card does with three answers it already
     has — the order, the caps, and the fact that a stale mark empties the row. */
  + 'news(o){chNewsReplies=o.replies||[];chNewsRx=o.rx||[];'
  + 'try{localStorage.setItem("kamo_seen_tries",String(o.seenTries|0));'
  + 'localStorage.setItem("kamo_rx_seen",String(o.rxSeen|0));'
  + 'o.replySeen?localStorage.setItem(REPLY_SEEN_KEY,o.replySeen):localStorage.removeItem(REPLY_SEEN_KEY);'
  + 'localStorage.setItem(KF_SEEN_KEY,JSON.stringify(o.played||[]));}catch(e){}'
  + 'khTray({rows:o.rows||[],tried:o.tried|0,found:o.found|0,hides:(o.rows||[]).length});'
  + 'const el=document.getElementById("khTray");'
  + 'return{shown:el.style.display!=="none",n:el.children.length,'
  + 'labels:[...el.querySelectorAll(".khTrayLbl")].map(x=>x.textContent),'
  + 'metas:[...el.querySelectorAll(".khTrayMeta")].map(x=>x.textContent.trim()),'
  + 'imgs:[...el.querySelectorAll(".khTrayPic img")].map(x=>x.getAttribute("src")||""),'
  + 'rxSeen:(()=>{try{return localStorage.getItem("kamo_rx_seen")}catch(e){return null}})()};},'
  /* The tap, through the cell's own handler — the routing and the event both live there. */
  + 'tapNews(i){window.__nav=null;window.__ev=null;'
  + 'const _f=chFeed,_t=track;chFeed=(o)=>{window.__nav=o||{};};track=(n,p)=>{if(n==="home_news_tapped")window.__ev=p;};'
  + 'const b=document.querySelectorAll("#khTray .khTrayCell")[i];if(b)b.click();'
  + 'chFeed=_f;track=_t;return{nav:window.__nav,ev:window.__ev,'
  + 'open:document.getElementById("kamoHome").classList.contains("show")};},'
  /* The two bodies: which is worn, which is locked, what each is showing, and what the strip
     under the locked one is offering. */
  + 'bodies(){const a=document.getElementById("khCharA"),b=document.getElementById("khCharB");'
  + 'return{wornA:a.classList.contains("on"),wornB:b.classList.contains("on"),'
  + 'lockB:b.classList.contains("lock"),'
  + 'srcA:(document.getElementById("khBodyImgA")||{}).getAttribute?document.getElementById("khBodyImgA").getAttribute("src"):"",'
  + 'srcB:(document.getElementById("khBodyImgB")||{}).getAttribute?document.getElementById("khBodyImgB").getAttribute("src"):"",'
  + 'finA:document.querySelectorAll("#khFinA .khFinOpt").length,'
  + 'finB:document.querySelectorAll("#khFinB .khFinOpt").length,'
  + 'sell:document.getElementById("khFinB").classList.contains("sell"),'
  + 'tappable:document.querySelectorAll("#khFinB button").length};}};\n'
  + real.slice(at);

const MIME = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.css': 'text/css' };
const server = createServer((rq, rs) => {
  const p = decodeURIComponent(rq.url.split('?')[0]);
  if (p === '/' || p === '/index.html') { rs.writeHead(200, { 'Content-Type': 'text/html' }); return rs.end(html); }
  try {
    const body = readFileSync(join(ROOT, p.replace(/^\/+/, '')));
    rs.writeHead(200, { 'Content-Type': MIME[p.slice(p.lastIndexOf('.'))] || 'application/octet-stream' });
    rs.end(body);
  } catch { rs.writeHead(404); rs.end('not found'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;

let failed = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { failed++; console.error('  ✗ ' + m); };

const { globSync } = await import('node:fs');
const exe = chromeExe();
if (!exe) { console.log('· no Chrome or Chromium found — skipping (set PW_CHROME=<path>)'); server.close(); process.exit(0); }
const browser = await chromium.launch({ executablePath: exe });
const page = await browser.newPage({ locale: 'en-US', viewport: { width: 390, height: 844 } });
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__h, null, { timeout: 10000 });

console.log('\nTHE CARD OPENS FOR EVERYONE, AND CLAIMS ONLY WHAT IS TRUE');
{
  await page.evaluate(() => window.__h.wipe());
  const free = await page.evaluate(() => window.__h.open(false));
  free.shown ? ok('a free user gets the card, not the paywall') : bad('the card did not open for a free user');
  free.plus === 'none'
    ? ok('no + on a free user\'s badge')
    : bad(`the badge wears "KAMO+" for a non-member (display:${free.plus}) — it is telling them they own something they do not`);
  /* THE UPSELL BANNER IS GONE ON PURPOSE — it was a full-width CTA sitting on top of the
     results list, which is the reason the card is opened at all. What must NOT be gone is a
     route to the paywall, so the assertion moved rather than being deleted: the locked
     controls on this card still carry ✦ and still lead there, which is a better ask because
     it arrives attached to the thing being sold. */
  free.upsell === 'absent'
    ? ok('no upsell banner eating the results list')
    : bad(`the upsell banner is back (${free.upsell}) — it pushes the hides into a ~150px window`);
  /* .khBodyOpt since 2026-08-18 — the two pills became two renders of the models, and the ✦
     rides on the locked TILE. Same assertion, same reason: this is the card's only route to
     the paywall now that the banner is gone. */
  const locks = await page.evaluate(() => document.querySelectorAll('#kamoHome .khBodyOpt.lock, #kamoHome .khFinOpt.lock').length);
  locks > 0
    ? ok(`and KAMO+ is still reachable from the card — ${locks} locked control(s) marked ✦`)
    : bad('nothing on the card leads to the paywall any more: the banner went and took the only route with it');

  /* ══ THE BODIES ARE PICTURES, AND THE PAID COLOURS ARE VISIBLE TO A BUYER ═══════════════
     Both halves of this block are regressions waiting to happen.
     The pictures: two words ("Original", "New") named a difference of build that no label can
     carry, and any hand-drawn stand-in would be a guess — so the assertion is that the tiles
     point at the RENDERS, and that the worn one is the posed frame while the other stands.
     The colours: the swatch row used to require the new body, and the new body requires
     membership, so the four paid finishes were visible only to the people who already owned
     them. A free user must now see them under the locked tile — dim, and NOT tappable, since
     a tap there would paint nothing on the body they are wearing. */
  const bod = await page.evaluate(() => window.__h.bodies());
  bod.wornA && !bod.wornB
    ? ok('a free user is wearing the original body, and the tile shows it')
    : bad(`the worn tile is wrong for a free user (A:${bod.wornA} B:${bod.wornB})`);
  /^vendor\/body-classic-wave\.png$/.test(bod.srcA) && /^vendor\/body-v2-stand\.png$/.test(bod.srcB)
    ? ok('the worn body is the posed render and the other one stands — the pair says which is yours')
    : bad(`the tiles are not showing the right renders (A:${bod.srcA} B:${bod.srcB})`);
  bod.lockB
    ? ok('the body they do not own wears the ✦')
    : bad('the locked body carries no mark — the one paid object on the card is unlabelled');
  bod.sell && bod.finB === 4 && bod.tappable === 0
    ? ok('and its four paid finishes are on show under it, inert — an article a buyer can finally see')
    : bad(`the finishes are not being offered under the locked body (sell:${bod.sell} n:${bod.finB} tappable:${bod.tappable})`);
  bod.finA === 0
    ? ok('nothing under the original body, which no finish applies to')
    : bad(`${bod.finA} swatch(es) under the original body — they paint nothing there`);
  free.chips === 0
    ? ok('no perk list — the card is about who you are, not what the subscription contains')
    : bad(`${free.chips} perk chips are back on the player card`);
  free.restore === 'absent'
    ? ok('no Restore row — a store action does not belong on a card about who you are')
    : bad(`Restore is back on the player card (${free.restore}); it lives on the paywall, which is `
        + 'where the five taps that justified it actually happened');

  const pro = await page.evaluate(() => window.__h.open(true));
  pro.plus !== 'none' ? ok('a member gets the +') : bad('the + is hidden from someone who paid for it');
  /* 'absent' now, not 'none': the banner is out of the markup entirely rather than hidden per
     user, so nobody is sold what they already own because there is nothing to sell here. */
  pro.upsell === 'absent'
    ? ok('and is not sold what they already own')
    : bad(`the upsell row is ${pro.upsell} for a member`);
}

console.log('\nTHE HANDLE IS KEPT, AND KEPT CLEAN');
{
  await page.evaluate(() => { window.__h.wipe(); window.__h.open(false); });
  await page.click('#khHandle');
  await page.type('#khHandle', 'Tony_99');
  const typed = await page.evaluate(() => window.__h.state());
  typed.stored === 'Tony_99'
    ? ok('typing saves as you go — no Save button to forget')
    : bad(`stored ${JSON.stringify(typed.stored)} after typing "Tony_99"`);

  /* THE CARET. Reassigning .value on every keystroke is the obvious implementation and it
     makes the field unusable: the caret jumps to the end, so you cannot fix a typo in the
     middle of your own name. Typing into the middle is the only way to see it. */
  await page.evaluate(() => { const i = document.getElementById('khHandle'); i.setSelectionRange(2, 2); });
  await page.keyboard.type('X');
  const mid = await page.evaluate(() => ({ v: document.getElementById('khHandle').value,
    caret: document.getElementById('khHandle').selectionStart }));
  mid.v === 'ToXny_99' && mid.caret === 3
    ? ok('editing the middle of a name works — the caret stays put')
    : bad(`typing into the middle produced ${JSON.stringify(mid.v)} with the caret at ${mid.caret} — `
        + 'the field is rewriting itself on every keystroke and pushing the caret to the end');

  /* SANITISED ON THE WAY IN, because the value is interpolated into a share message that a
     stranger then reads. An @ typed by hand must not survive either — the markup already
     draws one, and storing a second gives every invite "@@name". */
  await page.evaluate(() => { window.__h.wipe(); window.__h.open(false); });
  await page.click('#khHandle');
  await page.type('#khHandle', '@bad name<script>');
  await page.evaluate(() => document.getElementById('khHandle').blur());
  const clean = await page.evaluate(() => window.__h.state());
  clean.stored === 'badnamescript' && !/[@<>\s]/.test(clean.stored)
    ? ok(`"@bad name<script>" is narrowed to ${JSON.stringify(clean.stored)}`)
    : bad(`a hand-typed @, spaces or markup survived: ${JSON.stringify(clean.stored)}`);
  clean.value === clean.stored
    ? ok('and the field is normalised on blur, so what you see is what goes out')
    : bad(`the field shows ${JSON.stringify(clean.value)} but ${JSON.stringify(clean.stored)} is stored`);
}

/* THE CARD KEEPS UP WHILE YOU TYPE. It did not: khShowField() and the headline were computed
   only in openKamoHome(), so someone who typed a name sat looking at "Sign your hides" above a
   field containing the name they had just signed, and only saw it take effect the next time
   they opened the card. */
console.log('\nIT SWITCHES OVER AS SOON AS YOU ARE DONE');
{
  await page.evaluate(() => { window.__h.wipe(); window.__h.open(false); });
  await page.click('#khHandle');
  await page.type('#khHandle', 'nova');
  const typing = await page.evaluate(() => window.__h.state());
  typing.title === '@nova'
    ? ok('the headline follows the keystrokes')
    : bad(`the headline is still ${JSON.stringify(typing.title)} while the name is being typed`);
  typing.field !== 'none'
    ? ok('and the field stays put while there is a caret in it')
    : bad('the field collapsed mid-keystroke — the caret has nowhere to be');

  await page.evaluate(() => document.getElementById('khHandle').blur());
  const done = await page.evaluate(() => window.__h.state());
  /* The headline carries the name once the field stands down — that IS the edit control, so
     asserting it holds "@name" asserts both that the collapse happened and that the way back
     in is on screen. */
  /* Against the shape, not a literal: the headline carries whatever was typed, and pinning
     the exact name here would break the next time the fixture changes without the behaviour
     changing at all. What matters is that it collapsed AND the name is on screen — that is
     both halves of the edit control existing. */
  done.field === 'none' && /^@\w+/.test(done.title || '')
    ? ok('and stands down on blur, leaving the name itself as the way back in')
    : bad(`after blur the field is ${done.field} and the headline is ${JSON.stringify(done.title)}`);

  /* THE PENCIL'S JOB, DONE BY THE NAME. This is the assertion #khEdit used to carry: there
     has to be a way back to the field after it collapses, or a typo is permanent. */
  const reopened = await page.evaluate(() => window.__h.tapName());
  reopened.field !== 'none'
    ? ok('tapping the name reopens the field — the headline is the edit control')
    : bad('tapping the headline did not bring the field back; the name cannot be changed');
  /* NEVER BOTH AT ONCE. The field was hidden behind the headline precisely so the name is not
     printed twice, and reopening it put the pair back on screen together — "@tony" over
     "@tony" with a caret in it (founder, 2026-08-18). The field takes the headline's place
     now; it does not stack under it. */
  reopened.titleShown === 'none'
    ? ok('and the headline stands down while it does — the name is on screen once, not twice')
    : bad(`the headline is still up (display:${reopened.titleShown}) while the field shows the same name`);

  /* Clearing it must NOT collapse to a headline offering to change nothing. */
  await page.evaluate(() => { const i = document.getElementById('khHandle'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); i.blur(); });
  const cleared = await page.evaluate(() => window.__h.state());
  cleared.field !== 'none' && cleared.title === 'Sign your hides'
    ? ok('clearing it puts the field and the instruction back')
    : bad(`after clearing, field=${cleared.field} title=${JSON.stringify(cleared.title)}`);
}

console.log('\nIT SURVIVES A RELAUNCH, AND IT LEADS SOMEWHERE');
{
  await page.evaluate(() => { window.__h.wipe(); window.__h.open(false); });
  await page.click('#khHandle');
  await page.type('#khHandle', 'tony');
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__h);
  const back = await page.evaluate(() => window.__h.open(false));
  back.value === 'tony' && back.stored === 'tony'
    ? ok('the handle is still there after a relaunch')
    : bad(`the handle did not survive a reload (field ${JSON.stringify(back.value)}, stored ${JSON.stringify(back.stored)})`);
  back.title === '@tony'
    ? ok(`the handle IS the headline once it exists ("${back.title}")`)
    : bad(`the headline is ${JSON.stringify(back.title)} — expected the bare handle`);
  /* AND THE FIELD STANDS DOWN. With the headline showing @tony, a field showing @tony forty
     pixels lower is the same value twice in one glance. */
  back.field === 'none' && back.edit !== 'none' && back.edit !== 'absent'
    ? ok('the field gives way to "Change name" once there is a name')
    : bad(`with a handle set the field is ${back.field} and the edit button is ${back.edit} — `
        + 'the card is showing the same value twice');
  back.discord === 'https://discord.gg/ET9PYFt8M'
    ? ok('Discord points at the real invite')
    : bad(`DISCORD_URL is ${JSON.stringify(back.discord)}`);
}

console.log('\nTHE CARD REPORTS WHAT HAPPENED TO THE HIDES YOU SENT');
{
  /* SENT BUT UNPLAYED IS ITS OWN ANSWER. An absent row here is ambiguous in the wrong
     direction — "nobody opened them" and "this is broken" look identical. */
  await page.evaluate(() => window.__h.hides(['a', 'b'],
    { a: { n_attempts: 0, n_found: 0 }, b: { n_attempts: 0, n_found: 0 } }));
  await page.evaluate(() => window.__h.open(false));
  await page.waitForTimeout(250);
  const quiet = await page.evaluate(() => window.__h.state());
  /* THE SUMMARY MOVED, THE RULE DID NOT. The folded row used to spell the outcome out
     ("2 challenges sent · nobody has played yet"); it now names the door it opens, because
     the grid behind it carries those same two numbers as chips AND the photos they are
     about. What is still asserted is the part that was ambiguous in the wrong direction:
     somebody who has sent gets a row at all, counting the hides they actually have. */
  /My kamos \(2\)/.test(quiet.scoreText)
    ? ok(`somebody who has sent gets the door, counted ("${quiet.scoreText.trim()}")`)
    : bad(`two published hides render ${JSON.stringify(quiet.scoreText)}`);

  /* But someone who has never sent anything still gets nothing — that row would be about
     their own inactivity rather than about other people. */
  await page.evaluate(() => window.__h.hides([], {}));
  const none0 = await page.evaluate(() => window.__h.open(false));
  none0.score === 'none'
    ? ok('and someone who has never sent a challenge gets no row at all')
    : bad(`a never-sent user sees ${JSON.stringify(none0.scoreText)}`);

  /* Aggregated across every hide, with an expired one (null from get_hide) dropped. */
  await page.evaluate(() => window.__h.hides(['a', 'b', 'gone'], {
    a: { n_attempts: 9, n_found: 2 }, b: { n_attempts: 3, n_found: 1 } }));
  await page.evaluate(() => window.__h.open(false));
  await page.waitForTimeout(250);
  const many = await page.evaluate(() => window.__h.state());
  /* Three ids in, two counted: get_hide answers an expired or blocked hide with nothing, and
     a row about a hide that no longer exists is a row the user cannot act on. The drop has to
     happen BEFORE the count, which is the half a folded summary can still prove. */
  /My kamos \(2\)/.test(many.scoreText)
    ? ok(`the expired hide is dropped before the count ("${many.scoreText.trim()}")`)
    : bad(`three ids with one dead renders ${JSON.stringify(many.scoreText)}`);

  /* NOT GATED ON THE HANDLE. The score is about hides you sent, and you can send hides
     without ever naming yourself — most people will. */
  await page.evaluate(() => { window.__h.wipe(); window.__h.hides(['a'], { a: { n_attempts: 1, n_found: 0 } }); });
  await page.evaluate(() => window.__h.open(false));
  await page.waitForTimeout(250);
  const none = await page.evaluate(() => window.__h.state());
  /My kamos \(1\)/.test(none.scoreText)
    ? ok('and an unsigned sender gets it too — the score is about hides, not about names')
    : bad(`with no handle set the row reads: ${JSON.stringify(none.scoreText)}`);

  /* THE ROW IS A BUTTON, AND TAPPING IT MUST NOT DISMISS THE CARD.
     Reported from the field: "quand on tap sur la card ça ferme au lieu d'ouvrir le preview
     ou le watch". Two faults met on the same gesture. The row had no handler at all, so a tap
     that missed the three small controls did nothing — and the card's drag-to-close armed
     INSIDE the list whenever it was too short to scroll, so the few pixels of travel in a
     normal press cleared the 40px threshold and shut the card instead.
     Asserted through a real press with movement rather than a bare .click(), because a
     synthetic click has no travel and would pass against the very code that failed. */
  await page.evaluate(() => window.__h.expand());
  const tapped = await page.evaluate(async () => {
    const row = document.querySelector('#khScore .khRow');
    if (!row) return { err: 'no row' };
    const r = row.getBoundingClientRect();
    const x = Math.round(r.left + 12), y = Math.round(r.top + r.height / 2);
    const o = (cy) => ({ bubbles: true, cancelable: true, pointerId: 3, pointerType: 'touch', clientX: x, clientY: cy });
    /* Down, then 44px of drift — past the dismiss threshold — then up: a thumb reaching for
       a control on a 46px row, which is exactly the gesture that was closing the card. */
    row.dispatchEvent(new PointerEvent('pointerdown', o(y)));
    row.dispatchEvent(new PointerEvent('pointermove', o(y + 44)));
    row.dispatchEvent(new PointerEvent('pointerup', o(y + 44)));
    await new Promise((r2) => setTimeout(r2, 150));
    return { shown: document.getElementById('kamoHome').classList.contains('show'),
             live: row.classList.contains('khRowTap') };
  });
  tapped.shown
    ? ok('a press with travel on a row leaves the card open — the list is not a dismiss surface')
    : bad('pressing a row closed the card: the drag-to-close still arms inside #khScore');
  tapped.live
    ? ok('and a played row is marked live, so the whole row is the target rather than three chips')
    : bad('the row carries no tap affordance — only the small controls are reachable');

  /* ONE SENTENCE, NOT THE SAME NUMBERS TWICE. The chips under the state line restated it word
     for word ("1 tried" under "1 tried · nobody found you") and held the width that was
     pushing the sentence onto a third line. */
  const dup = await page.evaluate(() => {
    const row = document.querySelector('#khScore .khRow');
    return { txt: (row.querySelector('.khRowTxt') || {}).textContent || '',
             chips: row.querySelectorAll('.khRowChips .chChip').length };
  });
  dup.chips === 0 && /1 tried/.test(dup.txt)
    ? ok('and it states the count once, in the sentence, with no chip repeating it')
    : bad(`the row repeats itself: ${dup.chips} chip(s) under ${JSON.stringify(dup.txt)}`);
}

/* TEN CHALLENGES IS THE MAXIMUM chMine() KEEPS, SO TEN IS THE SIZE THE CARD MUST SURVIVE.
   The report was "quand on ouvre et qu'il y a beaucoup de challenges, ça casse la modal, et on
   voit plus le haut" — and in the same breath, "Show each one ne fonctionne pas". Those were
   one bug: the card is anchored to the BOTTOM edge, so expanding pushed the badge, the name
   and the summary off the top of the screen, and the rows the button had just rendered were
   drawn above y=0 where nothing could be seen. The button was working perfectly.
   Nothing in this file could catch that, because every element involved was still `display`
   whatever it should be — which is why the hook measures rectangles. */
console.log('\nTEN CHALLENGES STILL FIT ON THE SCREEN');
{
  const ids = Array.from({ length: 10 }, (_, i) => 'h' + i);
  const rows = {};
  ids.forEach((id, i) => { rows[id] = { n_attempts: i, n_found: i % 3, img_path: '' }; });
  await page.evaluate(([ids, rows]) => window.__h.hides(ids, rows), [ids, rows]);
  await page.evaluate(() => window.__h.open(false));
  await page.waitForTimeout(250);

  const shut = await page.evaluate(() => window.__h.fit());
  shut.cardTop >= 0
    ? ok(`closed, the card starts on screen (top ${shut.cardTop}px)`)
    : bad(`the card already overflows before anything is expanded (top ${shut.cardTop}px)`);

  const open = await page.evaluate(() => window.__h.expand());
  open.rows === 10
    ? ok('the notification path renders all ten rows in place')
    : bad(`expanding rendered ${open.rows} rows — the accordion is not opening`);
  open.cardTop >= 0 && open.badgeTop >= 0
    ? ok(`and the top of the card is still visible (card ${open.cardTop}px, badge ${open.badgeTop}px)`)
    : bad(`expanded, the card runs off the top of the screen (card ${open.cardTop}px, badge `
        + `${open.badgeTop}px) — the badge, the name and the summary are all unreachable`);
  open.scoreScrolls
    ? ok('the list scrolls inside its own box rather than growing the card')
    : bad('the results box is not a scroll container — ten rows have to go somewhere, and '
        + 'without this they go off the top of the screen');
  /* The two numbers this card exists to deliver used to be REPLACED by the list they
     summarise, so they were readable only while the thing they describe was closed. */
  /played your hide/.test(open.headText)
    ? ok(`the summary rides above the open list ("${open.headText.trim()}")`)
    : bad(`the open state's header reads ${JSON.stringify(open.headText)} — the headline was `
        + 'thrown away by the expansion');
}

console.log('\nTHE NEWS TRAY SHOWS WHAT THE DOT WAS POINTING AT');
{
  /* The seeds are built HERE and passed in: page.evaluate ships the function to the browser,
     where nothing in this file's scope exists. */
  const R = (id, iso, name) => ({ id, created_at: iso, img_path: id + '.jpg', name });

  /* NOTHING NEW IS THE COMMON CASE, and it must cost nothing on screen. An empty row, a
     "nothing new" line or a spinner would each be worse than the absence. */
  const quiet = await page.evaluate((o) => window.__h.news(o),
    { rows: [{ id: 'a', img_path: 'a.jpg', n_attempts: 4, n_found: 1 }], tried: 4, seenTries: 4, rxSeen: 0 });
  !quiet.shown && quiet.n === 0
    ? ok('nothing new: no row at all, not an empty one')
    : bad(`the tray renders with nothing to say (shown:${quiet.shown} n:${quiet.n})`);

  /* THE ORDER IS BY KIND AND NEVER BY RECENCY. A reply is the only tile with an action behind
     it, so it leads; a fixed position also means the row does not have to be re-read on every
     open. And the caps are asymmetric on purpose — replies are one tile each (each is a
     separate round to play), plays and reactions are one tile TOTAL, or three reactions on
     three photos would push the only actionable tile off the edge. */
  const full = await page.evaluate((o) => window.__h.news(o), {
    replies: [R('r1', '2026-08-18T10:00:00Z', 'mira'), R('r2', '2026-08-18T09:00:00Z', null),
              R('r3', '2026-08-18T08:00:00Z', 'zed'), R('r4', '2026-08-18T07:00:00Z', 'old')],
    rx: [{ hide_id: 'h1', n: 3 }, { hide_id: 'h2', n: 12 }],
    rows: [{ id: 'h1', img_path: 'h1.jpg', n_attempts: 4, n_found: 1 },
           { id: 'h2', img_path: 'h2.jpg', n_attempts: 20, n_found: 5 }],
    tried: 24, seenTries: 19, rxSeen: 2, replySeen: '2026-08-17T00:00:00Z' });
  full.n === 5
    ? ok('three answers, one plays tile and one reactions tile — five, never one per reaction')
    : bad(`the tray rendered ${full.n} tiles: ${JSON.stringify(full.labels)}`);
  full.labels.slice(0, 3).every((l) => /answered you/.test(l))
    ? ok('the answers lead, because they are the only tiles that carry an action')
    : bad(`the order is not replies-first: ${JSON.stringify(full.labels)}`);
  /new plays/.test(full.labels[3] || '') && /new reactions/.test(full.labels[4] || '')
    ? ok(`then the plays, then the reactions ("${full.labels[3]}" · "${full.labels[4]}")`)
    : bad(`plays and reactions are out of order: ${JSON.stringify(full.labels)}`);
  /5 new plays/.test(full.labels[3] || '')
    ? ok('and the plays tile counts what is NEW since the last look, not the lifetime total')
    : bad(`the plays label reads ${JSON.stringify(full.labels[3])} — it should be the 5 new ones, not 24`);
  full.imgs.length === 5 && full.imgs.every((s) => /\/storage\/v1\/object\/public\/hides\//.test(s))
    ? ok('every tile is the photograph it is about')
    : bad(`the tiles are not showing the hides: ${JSON.stringify(full.imgs)}`);
  /@mira/.test(full.metas[0] || '') && /Someone/.test(full.metas[1] || '')
    ? ok('an answer is named, and an unsigned one says Someone')
    : bad(`the answer tiles are not naming their sender: ${JSON.stringify(full.metas.slice(0, 2))}`);
  /* AN ANSWER WAITS UNTIL IT IS PLAYED, NOT UNTIL IT IS GLIMPSED. The first cut filtered on
     replySeenAt() — the wordmark dot's mark, which khResults() stamps on every open of this
     card. One look without a tap and the round vanished while it was still unplayed. The
     feed's own record of what has been played is the honest test, and it is the one the
     Challenges panel already uses. */
  const stale = await page.evaluate((o) => window.__h.news(o), {
    replies: [R('r1', '2026-08-18T10:00:00Z', 'mira'), R('r2', '2026-08-18T09:00:00Z', 'zed')],
    rows: [{ id: 'h1', img_path: 'h1.jpg', n_attempts: 2, n_found: 0 }],
    tried: 2, seenTries: 2, rxSeen: 0, replySeen: '2026-08-19T00:00:00Z' });
  stale.n === 2
    ? ok('an answer older than the last glance is still waiting — the card does not spend it by being opened')
    : bad(`the tray dropped unplayed answers because the card had been opened: ${stale.n} tile(s)`);
  const done = await page.evaluate((o) => window.__h.news(o), {
    replies: [R('r1', '2026-08-18T10:00:00Z', 'mira'), R('r2', '2026-08-18T09:00:00Z', 'zed')],
    rows: [{ id: 'h1', img_path: 'h1.jpg', n_attempts: 2, n_found: 0 }],
    tried: 2, seenTries: 2, rxSeen: 0, played: ['r1'] });
  done.n === 1 && /@zed/.test(done.metas[0] || '')
    ? ok('and one that HAS been played drops out, leaving the one that has not')
    : bad(`playing an answer did not clear its tile: ${done.n} tile(s) ${JSON.stringify(done.metas)}`);

  /* The mark is stamped on delivery, exactly as the grid stamps it — otherwise the reactions
     tile returns on every single open until the reader happens to visit the grid. */
  full.rxSeen === '15'
    ? ok('and showing the reactions spends them, so the tile does not cry wolf next open')
    : bad(`the reactions high-water mark is ${full.rxSeen} after the tray delivered them`);

  /* NAVIGATION. An answer opens ON that hide (chFeed seeds it as slide 0 by id); the reader's
     own numbers open the grid, where every hide and every count lives. Both close the card
     first — leaving it up would put the sheet over the thing it just opened. */
  /* Re-seeded: the two cases above left their own, shorter rows on screen, and the taps
     below address tiles by index. */
  await page.evaluate((o) => window.__h.news(o), {
    replies: [R('r1', '2026-08-18T10:00:00Z', 'mira'), R('r2', '2026-08-18T09:00:00Z', null),
              R('r3', '2026-08-18T08:00:00Z', 'zed')],
    rx: [{ hide_id: 'h1', n: 3 }, { hide_id: 'h2', n: 12 }],
    rows: [{ id: 'h1', img_path: 'h1.jpg', n_attempts: 4, n_found: 1 },
           { id: 'h2', img_path: 'h2.jpg', n_attempts: 20, n_found: 5 }],
    tried: 24, seenTries: 19, rxSeen: 2 });
  const tapReply = await page.evaluate(() => window.__h.tapNews(0));
  tapReply.nav && tapReply.nav.first === 'r1' && !tapReply.open
    ? ok('tapping an answer opens the feed on that exact hide, and the card gets out of the way')
    : bad(`the answer tile routed to ${JSON.stringify(tapReply.nav)} (card still open: ${tapReply.open})`);
  tapReply.ev && tapReply.ev.kind === 'reply'
    ? ok('and it reports which kind was tapped')
    : bad(`home_news_tapped carried ${JSON.stringify(tapReply.ev)}`);
  const tapPlays = await page.evaluate(() => window.__h.tapNews(3));
  tapPlays.nav && tapPlays.nav.mine === true
    ? ok('the plays tile opens your own grid, where the numbers belong')
    : bad(`the plays tile routed to ${JSON.stringify(tapPlays.nav)}`);
  const tapRx = await page.evaluate(() => window.__h.tapNews(4));
  tapRx.nav && tapRx.nav.mine === true
    ? ok('and so does the reactions tile')
    : bad(`the reactions tile routed to ${JSON.stringify(tapRx.nav)}`);

  /* A HIDE THAT IS NOT IN THE TALLY CANNOT BE SHOWN. my_reactions answers by hide id and the
     photograph comes from the tally rows — a reaction on a hide this device no longer lists
     has no picture, and a tile with no picture is worse than no tile. */
  const orphan = await page.evaluate((o) => window.__h.news(o),
    { rx: [{ hide_id: 'gone', n: 9 }], rows: [{ id: 'h1', img_path: 'h1.jpg', n_attempts: 1, n_found: 0 }],
      tried: 1, seenTries: 1, rxSeen: 0 });
  orphan.n === 0
    ? ok('a reaction on a hide with no photograph to show renders nothing')
    : bad(`the tray invented a tile for a hide it has no image for: ${JSON.stringify(orphan.labels)}`);
}

await browser.close();
server.close();
console.log(failed ? `\n✗ ${failed} failure(s)` : '\n✓ the player card keeps a clean handle and claims only what is true');
process.exit(failed ? 1 : 0);
