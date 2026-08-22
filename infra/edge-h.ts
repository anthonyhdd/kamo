/**
 * The link preview for a challenge.  —  Supabase edge function `h`, project qpztlobbnjyjbxqyuzgg
 *
 * ⚠️ THIS FILE IS THE SOURCE OF A FUNCTION THAT ALREADY RUNS IN PRODUCTION, and until today it
 * existed nowhere in git. It was written and deployed straight to Supabase, which meant the
 * copy under every challenge link in every thread — the most-read sentence this product has —
 * could not be grepped, reviewed or diffed from the repo. That is how it kept saying "body"
 * for two days after the word was retired everywhere else.
 * Editing this file does NOT deploy it. Deploy with the Supabase MCP (deploy_edge_function,
 * project qpztlobbnjyjbxqyuzgg, name `h`, verify_jwt FALSE — it exists to be fetched by
 * scrapers that carry no token) or `supabase functions deploy h`. Keep the two in step: the
 * next person to read this file will assume it is what is running.
 *
 * 504 challenges have been sent and 344 were never opened — 68%. The cause is in the page's
 * <head>: og:image is the app ICON and og:title is the same sentence for every hide ever
 * made, because the page is static HTML on GitHub Pages and scrapers do not run JS. So a
 * challenge from a friend lands in iMessage looking like an advert for an app, and nobody
 * taps an advert.
 *
 * This sits in front of that page and gives each hide its own preview: the real photo, and
 * the sender's name. The mystery image IS the hook — there is a kamo hidden in it and you
 * cannot see it, which is the whole product, rendered in the thread before anyone taps.
 *
 * WHY A REDIRECT AND NOT A REWRITE. Serving the game from here would put a Deno function in
 * front of every play, and the game is a static file that has never needed one. This does one
 * job: answer scrapers correctly, then get humans to the real page at once.
 *
 * The bounce is a script and nothing else, and no User-Agent sniffing. A browser runs it and
 * is gone in a frame; anything that does not run JS reads the head, then the body, and stops.
 * UA lists rot, and every new messaging app would silently start getting the wrong response.
 *
 * WHAT SEARCH ENGINES USED TO BE TOLD HERE, and why it was wrong. This page is the ONLY thing
 * on playkamo.com that the outside world ever links to, and it used to spend that entirely:
 *
 *   - `<link rel="canonical">` pointed at kamo.bliss-coach.com — a different origin, and one
 *     whose index.html carries `<meta name="robots" content="noindex,nofollow">`. Naming a
 *     forbidden page as the canonical version of a playkamo.com URL consolidates the domain's
 *     only inbound signal onto a dead end.
 *   - `<meta http-equiv="refresh" content="0;…">` made every /h/ URL a redirect off-domain, so
 *     anything crawled here was forwarded away before the body was read.
 *   - `og:url` also named kamo.bliss-coach.com, so the unfurled card claimed a domain the
 *     shared link does not point at.
 *
 * Now: `noindex,follow` and no canonical at all. The pages are deliberately kept OUT of the
 * index — a hide's photo is deleted after the 30-day storage retention, so an indexed hide
 * becomes a soft-404 by design, and thousands of those is a liability, not a long tail. What
 * they must do instead is FOLLOW: the body carries a real crawlable link to playkamo.com, so
 * the share surface feeds the pages that are actually trying to rank rather than a noindex
 * origin on another domain. `noindex` and `canonical` are contradictory instructions — pick
 * one, and for a page that outlives its own content it is noindex.
 *
 * The body is not dead weight for humans either: without JS the old page was a black screen,
 * and it is now the photo plus a link that works.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SITE = "https://kamo.bliss-coach.com/";
/* The origin this function is REACHED at, which is not the one it sends people to. The
 * Cloudflare Worker on playkamo.com/h/* forwards here (infra/playkamo-worker.js), so every
 * link in every thread is a playkamo.com link and every self-referential tag has to say so. */
const PUBLIC = "https://playkamo.com";

/* THE INSTALL LINK ON THE HIGHEST-INTENT SURFACE THE PRODUCT HAS, and until now it was a
 * bare listing URL. Two things were wrong with that, and the second is the expensive one.
 *
 *  - It is untracked. `~/SPANISH/content-engine/config.json` states the rule for the video
 *    descriptions in one line — "never hardcode a bare apps.apple.com URL: it is untracked
 *    and it outranks the tracked link" — and this page was breaking it on the one surface
 *    where the visitor has already seen a friend's challenge and decided to install. Every
 *    one of those installs has been landing in `af_status: Organic` with nothing to say the
 *    loop earned it, which is why the loop's contribution is unknown rather than small.
 *
 *  - It drops the hide. The App Store round-trip loses the URL, so the friend who tapped a
 *    challenge, installed, and opened, arrives on an empty camera with the round they came
 *    for gone. A OneLink is the only carrier that survives that trip. `deep_link_value=hide`
 *    names the route and `deep_link_sub2` carries the id; kamo-app/attribution.js reads
 *    exactly that pair (extractDeepHide) and hands it to the same `deepHide` state a warm
 *    universal link uses, so there is one road to a hide and not two.
 *
 * sub2 rather than sub1 because sub1 is the referrer code — see the note on extractDeepHide.
 * `pid`/`c` are what AppsFlyer groups by, and they are named for this surface so a challenge
 * install can be told apart from an in-app share and from the YouTube fleet.
 *
 * The base is the template kamo-app already ships (attribution.js ONELINK_URL). There is a
 * SECOND template in the account — getkamo.onelink.me/0Dmw, used by the YouTube pipeline —
 * and the two are not interchangeable for reporting. Do not "unify" them without checking
 * which one each consumer reads. */
const APP_STORE = "https://apps.apple.com/app/id6789639784";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

const ONELINK = "https://kamo.onelink.me/dc9X";
const installLink = (id: string) =>
  id
    ? ONELINK + "?pid=challenge_link&c=challenge&deep_link_value=hide"
      + "&deep_link_sub2=" + encodeURIComponent(id)
    : APP_STORE;

/** This goes into an HTML attribute and `name` is typed by a user. */
const esc = (s: unknown) =>
  String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

async function getHide(id: string) {
  try {
    const r = await fetch(SUPABASE_URL + "/rest/v1/rpc/get_hide", {
      method: "POST",
      headers: { apikey: ANON, Authorization: "Bearer " + ANON, "Content-Type": "application/json" },
      body: JSON.stringify({ p_id: id }),
    });
    if (!r.ok) return null;
    const j = await r.json();
    const row = Array.isArray(j) ? j[0] : j;
    return row && row.img_path ? row : null;
  } catch (_) {
    return null;
  }
}

/* EVERY TAG THAT CARRIES THE PHOTO, and twitter:image is one of them. It went missing for
 * one deploy on 2026-08-12 while the copy was being corrected — a line dropped in a
 * hand-copied rewrite — and the whole point of this function is that the picture reaches
 * the thread. Clients that read the twitter:* set (X, and several link unfurlers that
 * prefer it when present) would have fallen back to no image at all. */
function page(o: { title: string; desc: string; image: string; to: string; self: string; get: string }) {
  const to = esc(o.to);
  const get = esc(o.get);
  const self = esc(o.self);
  const title = esc(o.title);
  const desc = esc(o.desc);
  const image = esc(o.image);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<meta name="robots" content="noindex,follow">
<meta property="og:type" content="website">
<meta property="og:site_name" content="KAMO">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${desc}">
<meta property="og:image" content="${image}">
<meta property="og:url" content="${self}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${desc}">
<meta name="twitter:image" content="${image}">
</head><body style="background:#05060a;color:#f4f4f8;margin:0;padding:24px;font-family:-apple-system,BlinkMacSystemFont,system-ui,sans-serif">
<main style="max-width:620px;margin:0 auto">
<h1 style="font-size:21px;line-height:1.3;margin:0 0 6px">${title}</h1>
<p style="margin:0 0 16px;opacity:.75">${desc}</p>
<img src="${image}" alt="${title}" style="width:100%;height:auto;border-radius:12px;display:block">
<p style="margin:20px 0 0"><a href="${to}" style="color:#5fe6a4;font-weight:600;text-decoration:none">Find the kamo</a></p>
<p style="margin:12px 0 0;font-size:14px;opacity:.7"><a href="${PUBLIC}/" style="color:#5fe6a4">What is KAMO?</a> &middot; <a href="${get}" style="color:#5fe6a4">Get it on the App Store</a></p>
</main>
<script>location.replace(${JSON.stringify(o.to)})</script>
</body></html>`;
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  // Accept ?h=<id> and the trailing path segment, so the link shape can change later without
  // stranding every message already sent.
  const raw = url.searchParams.get("h") || url.pathname.split("/").filter(Boolean).pop() || "";
  const id = raw.replace(/[^a-f0-9]/gi, "").slice(0, 16);

  /* THE COPY IS WRITTEN FOR WHERE IT LANDS, which is under a full-width photo in a message
     thread. Two rules follow from that.
     Never say "this photo" — the reader is already looking at it, so the words are spent
     describing what they can see instead of telling them what to do.
     And the title carries everything: iMessage renders it bold on one or two lines and
     truncates or drops the description entirely depending on client. Anything that has to be
     read goes in the title; the description is a bonus line, never a dependency.
     "One tap" IS the deal, verbatim — the seeker screen and the in-app share message both
     say it. It said "buzz" for a day — insider shorthand for the haptic — and a receiver has
     no reason to know what a buzz is (founder's call, 2026-08-12).
     AND THE SENDER HID SOMEONE, THEY ARE NOT THE ONE HIDDEN. "Someone's hiding in here"
     and "find them" put the reader on the trail of the friend who sent the message, who is
     nowhere in the picture — what is hidden is the small figure they painted into it. The
     sender is the author of the puzzle, never its subject (founder's call, 2026-08-12).

     A KAMO, NEVER A BODY (founder's call, 2026-08-13 — and this is where it was missed).
     The figure is called a kamo in every user-facing string in the app: the seeker headline,
     the in-app share message, the preview card on the share sheet. This function kept saying
     "hid a body in here", so the ONE sentence a receiver actually reads — the bold line under
     the photo in WhatsApp, before they know anything about this product — was the only place
     still using the retired word, and it read as morbid rather than playful next to a picture
     of two people kissing. The app said kamo and the link said body, about the same hide.
     Kept in lockstep with the app: chSeek() opens on the same sentence. */
  const generic = {
    title: "Someone hid a kamo in here",
    desc: "One tap to find it.",
    // The branded 1200x630 card from the landing, not the app icon. This card is what
    // every link older than 30 days (the storage retention window), every blocked hide
    // and every bogus id renders as — a share of ALL links ever sent that only grows.
    // The icon stretched into a summary_large_image frame read as a broken advert.
    image: "https://playkamo.com/img/og.jpg",
    to: SITE,
    get: APP_STORE,
  };

  /* This page's OWN address, for og:url. `id` is already down to [a-f0-9]{0,16}, so it goes
     into a URL without further escaping. A bogus or expired id still has a real /h/ URL —
     that is the link sitting in someone's thread — so only the no-id case falls back to the
     landing page. */
  const self = id ? `${PUBLIC}/h/${id}` : `${PUBLIC}/`;

  if (!id) return html(page({ ...generic, self }));

  const hide = await getHide(id);
  // Expired, blocked or bogus: send them to the app rather than to a dead game, and keep the
  // generic card so the message never renders as a broken link.
  if (!hide) return html(page({ ...generic, self }));

  const who = String(hide.name || "").trim().replace(/^@+/, "").slice(0, 24);
  const image = `${SUPABASE_URL}/storage/v1/object/public/hides/${encodeURIComponent(hide.img_path)}`;

  return html(page({
    // The name is the whole difference between "an app is messaging me" and "my friend is
    // daring me", and it is prefixed to match how the game itself writes it on screen
    // ("@tony hid a kamo here"). Unsigned hides still beat the old card, because the
    // photo carries it.
    title: who ? `@${who} hid a kamo in here` : generic.title,
    desc: generic.desc,
    image,
    to: `${SITE}?h=${encodeURIComponent(id)}`,
    get: installLink(id),
    self,
  }));
});

function html(body: string) {
  return new Response(body, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // Scrapers re-fetch; the photo behind a hide never changes, so let them cache. Short
      // enough that a hide going blocked stops being advertised within the hour.
      "Cache-Control": "public, max-age=600",
    },
  });
}
