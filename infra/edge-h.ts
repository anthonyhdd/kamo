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
 * The bounce uses BOTH a meta refresh and a script, and no User-Agent sniffing. A scraper
 * reads the head and stops; a browser runs one of the two and is gone in a frame. UA lists
 * rot, and every new messaging app would silently start getting the wrong response.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SITE = "https://kamo.bliss-coach.com/";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

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
function page(o: { title: string; desc: string; image: string; to: string }) {
  const to = esc(o.to);
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(o.title)}</title>
<meta property="og:type" content="website">
<meta property="og:site_name" content="KAMO">
<meta property="og:title" content="${esc(o.title)}">
<meta property="og:description" content="${esc(o.desc)}">
<meta property="og:image" content="${esc(o.image)}">
<meta property="og:url" content="${to}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(o.title)}">
<meta name="twitter:description" content="${esc(o.desc)}">
<meta name="twitter:image" content="${esc(o.image)}">
<meta http-equiv="refresh" content="0;url=${to}">
<link rel="canonical" href="${to}">
</head><body style="background:#000">
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
  };

  if (!id) return html(page(generic));

  const hide = await getHide(id);
  // Expired, blocked or bogus: send them to the app rather than to a dead game, and keep the
  // generic card so the message never renders as a broken link.
  if (!hide) return html(page(generic));

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
