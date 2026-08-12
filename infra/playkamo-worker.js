/**
 * playkamo.com/h/<id> — the pretty face of a challenge link.
 *
 * WHY THIS FILE EXISTS. 344 of the 504 challenges ever sent were never opened. The cause was
 * a static <head>: og:image was the app icon and og:title was the same sentence for every
 * hide in existence, because both playkamo.com and kamo.bliss-coach.com are GitHub Pages and
 * scrapers do not run JS. The fix is a Supabase edge function that renders per-hide metadata
 * — but its URL is a supabase.co address, and a supabase.co address in an iMessage from a
 * friend reads as spam. The photo is the hook; the domain is the permission to tap it.
 *
 * So this Worker sits on playkamo.com and forwards /h/* to that function, leaving every other
 * path on GitHub Pages untouched. The landing page keeps working exactly as it does today.
 *
 * DEPLOY (free, ~15 minutes, no code changes anywhere else)
 *
 *   1. Cloudflare → Add a site → playkamo.com → Free plan.
 *   2. Cloudflare gives you two nameservers. At Hover, replace playkamo.com's nameservers
 *      with them. Cloudflare imports the existing records, so the landing page keeps
 *      resolving to GitHub Pages throughout. Propagation is usually minutes.
 *   3. Make sure the GitHub Pages records are PROXIED (orange cloud) so the Worker route can
 *      intercept. A grey cloud bypasses Workers entirely and this file will never run.
 *   4. Workers & Pages → Create Worker → paste this file → Deploy.
 *   5. Settings → Domains & Routes → Add route: playkamo.com/h/*
 *   6. Flip SHARE_HOST in index.html to https://playkamo.com/h — one line, see chLink().
 *
 * Step 6 is deliberately LAST. Until the route answers, pointing shares at playkamo.com/h
 * would 404 every challenge sent in the meantime, which is a worse failure than an ugly
 * domain. Ship the domain when the door exists, not before.
 *
 * VERIFY before flipping:
 *   curl -s https://playkamo.com/h/<a-real-hide-id> | grep -E 'og:(title|image)'
 * You want the sender's name in og:title and a storage URL ending in .jpg in og:image.
 */

const FUNCTION_ORIGIN = "https://qpztlobbnjyjbxqyuzgg.supabase.co/functions/v1/h";

export default {
  async fetch(request) {
    const url = new URL(request.url);

    // Anything that is not a challenge link belongs to the landing page. Falling through
    // rather than 404ing means a mistyped route degrades to the site instead of a dead end.
    if (!url.pathname.startsWith("/h/")) return fetch(request);

    // Hide ids are lowercase hex, 16 chars. Anything else is noise — hand it to the function
    // anyway, which answers with the generic card and sends the reader to the site.
    const id = url.pathname.slice(3).split("/")[0].replace(/[^a-f0-9]/gi, "").slice(0, 16);

    const upstream = new URL(FUNCTION_ORIGIN);
    if (id) upstream.searchParams.set("h", id);

    // GET only, and no request body forwarded: this endpoint exists to be scraped and
    // followed, nothing else. Scrapers are strict about redirects, so the function's own
    // 200 + meta-refresh is returned verbatim rather than re-wrapped.
    const res = await fetch(upstream.toString(), {
      method: "GET",
      headers: { "user-agent": request.headers.get("user-agent") || "" },
      redirect: "follow",
    });

    const out = new Response(res.body, res);
    out.headers.set("content-type", "text/html; charset=utf-8");
    return out;
  },
};
