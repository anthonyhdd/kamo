/**
 * THE VERDICT ON EVERY PLACEHOLDER, WRITTEN DOWN ONCE.
 *
 * kfLooksBlack() in index.html decides whether a hide is too dark to play, and it decides well.
 * It just decides again every time: on every device, on every page, for ever —
 * 13 726 drops for 5 705 feed opens on 2026-08-17, the same few hundred rows thrown away over
 * and over while still holding a slot in every page the feed serves to everyone. The judgement
 * was never the problem. Nowhere to put it was.
 *
 * This is the place to put it. The `lqip` column IS the picture — a ~20px JPEG carried in the
 * row, the same bytes the browser reads — so the whole thing is decode, measure, write back:
 *
 *   pg_cron every 5 min → sweep_lqip() → pg_net → here → lqip_next_batch / lqip_record
 *
 * and `hides.lqip_mean` then gates feed_page and feed_best, in SQL, for every client at once.
 * See infra/2026-09-18-feed-stops-serving-black-slabs.sql for why nothing here can unpublish or
 * refuse a hide, and infra/2026-09-19-feed-drops-the-dark-too.sql for where the cut sits and
 * what it costs.
 *
 * WHY AN EDGE FUNCTION. Postgres cannot decode a JPEG, and there is no version of this that
 * runs in SQL. The 2026-08-20 purge did it on a laptop, by hand, downloading 3 738 objects
 * through the public bucket — which is why it happened exactly once and the corpus refilled.
 *
 * ⚠️ AND NOT FROM THE PLAYERS' DEVICES, which is the cheaper design and the wrong one: every
 * seeker's browser already has this verdict, but letting it POST one would let any holder of
 * the anon key — it ships inside index.html — take any id out of feed_page and assert "this one
 * is too dark" about it, for everyone, for ever. The bytes are in the database. So is the
 * reader.
 *
 * IT ANSWERS WITH THE SUMMARY AND HOLDS THE pg_net WORKER WHILE IT RUNS, which is the opposite
 * of what cleanup-hides does (202 + EdgeRuntime.waitUntil) and is deliberate. That one runs a
 * minute-plus every night. This one runs for its whole budget on the first day, draining a
 * backlog of ~8 500, and for ~10 ms every five minutes after that, because by then each sweep
 * measures the three hides published since the last one. Paying for a second RPC and a run
 * table to save a worker that is idle by tomorrow is not a trade worth making — and the answer
 * being readable in net._http_response is how a sweep gets audited at all.
 *
 * Deploy:  supabase functions deploy measure-lqip --no-verify-jwt
 * Mirror:  this file. The function lives in Supabase and deploying does not touch this repo,
 *          so diff the two before believing either — same rule as edge-h.ts.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import jpeg from "npm:jpeg-js@0.4.4";

/* ══ CORE ══════════════════════════════════════════════════════════════════════════════════
   Everything between these two markers is plain JavaScript on purpose — no type annotations —
   because scripts/test-edge-lqip.mjs slices this exact region out of this file and runs it
   under Node with fake I/O and fake pixels. A test that re-implemented the luma would pass
   while this drifted; this one fails when the behaviour here changes. Keep the region
   annotation-free, and keep every dependency injected (io.decode) so it can be driven without
   a JPEG or a network. */

/** THE CUT, and it is DARKNESS ALONE — founder, 2026-09-19: « même si c'est de vraies photos
    sombres c'est nul, faut enlever. » It started as the client's KF_DARK_MEAN / KF_DARK_SPREAD
    (18 AND flat) and widened the next day on the sweep's own numbers: every mean-luma band
    below 40 is never-found 18.8-28.8% against 12.9-16.0% above it. See
    infra/2026-09-19-feed-drops-the-dark-too.sql.
    ⚠️ This constant only COUNTS. The gate is the SQL predicate in feed_page / feed_best, and
    moving one without the other makes a sweep's answer disagree with the feed it feeds. */
const DARK_MEAN = 40;

/** Rec. 601 luma, per target cell, averaged over the source pixels that fall in it.
    THE DOWNSCALE IS NOT DECORATION. kfLooksBlack() draws the placeholder into a canvas clamped
    to 24x24 and reads THAT, so a tall 20x36 lqip is squashed before it is judged — and
    squashing averages, which pulls min and max toward the mean and SHRINKS the spread. Reading
    the full-size placeholder here would compute a larger spread than the browser does on the
    same bytes, i.e. quietly refuse to confirm rows the client is already dropping. A box
    average is the closest honest analogue of what drawImage does on the way down. */
function lumaGrid(rgba, w, h, tw, th) {
  const out = new Float64Array(tw * th);
  for (let ty = 0; ty < th; ty++) {
    const y0 = Math.floor((ty * h) / th);
    const y1 = Math.max(y0 + 1, Math.floor(((ty + 1) * h) / th));
    for (let tx = 0; tx < tw; tx++) {
      const x0 = Math.floor((tx * w) / tw);
      const x1 = Math.max(x0 + 1, Math.floor(((tx + 1) * w) / tw));
      let sum = 0, n = 0;
      for (let y = y0; y < y1 && y < h; y++) {
        for (let x = x0; x < x1 && x < w; x++) {
          const i = (y * w + x) * 4;
          sum += (rgba[i] * 299 + rgba[i + 1] * 587 + rgba[i + 2] * 114) / 1000;
          n++;
        }
      }
      out[ty * tw + tx] = n ? sum / n : 0;
    }
  }
  return out;
}

/** {mean, spread} for a decoded placeholder, or null when there is nothing to judge.
    NULL IS A VERDICT AND IT MEANS "SERVE IT". One pixel is not evidence: a degenerate 1x1 or
    2x2 placeholder has a spread of zero by construction, so judging it would read every dark
    one as a flat rectangle and take a real hide down. kfLooksBlack() refuses below 4px and so
    does this, on the same numbers. */
function verdict(img) {
  if (!img || !img.data || !(img.width > 0) || !(img.height > 0)) return null;
  const tw = Math.max(1, Math.min(24, img.width));
  const th = Math.max(1, Math.min(24, img.height));
  if (tw < 4 || th < 4) return null;
  const g = lumaGrid(img.data, img.width, img.height, tw, th);
  let sum = 0, min = 255, max = 0;
  for (let i = 0; i < g.length; i++) {
    const y = g[i];
    sum += y;
    if (y < min) min = y;
    if (y > max) max = y;
  }
  return { mean: Math.round(sum / g.length), spread: Math.round(max - min) };
}

/** What the feed gate will say about this verdict. Reported, never enforced from here — the
    row is written with its numbers and the SQL decides. Counting it is what makes a sweep
    readable: "judged 400, dark 61" is an answer, "judged 400" is not.
    THE SPREAD IS MEASURED AND NOT TESTED. 18 AND flat let through the worst shape there is —
    a black frame with one bright light in it, mean 1 spread 124 — which is flat nowhere and
    playable nowhere. It stays on the row so "dark but textured" can be argued later from
    numbers rather than from memory. */
function isTooDark(v) {
  return !!v && v.mean < DARK_MEAN;
}

/** Batch until the backlog is empty or the budget is spent.
    ALWAYS ONE BATCH, even if the budget is already gone: a sweep that returns having measured
    nothing is indistinguishable from a sweep that is not running, and the steady state is
    three rows. The budget stops the FIRST day's drain from running past the isolate's limit;
    it is not a reason to skip the work entirely. */
async function sweep(io, opts) {
  const started = io.now();
  const out = { judged: 0, dark: 0, undecodable: 0, batches: 0, ms: 0, error: null };
  try {
    for (;;) {
      if (out.batches && io.now() - started >= opts.budget_ms) break;
      const rows = await io.next(opts.batch);
      if (!rows || !rows.length) break;
      const ids = [], means = [], spreads = [];
      for (const r of rows) {
        let v = null;
        /* An unreadable placeholder is written down as unjudgeable rather than left alone:
           leaving it alone means the next sweep picks it up again, for ever, and a backlog
           that never drains is how this job stops being run at all. */
        try { v = verdict(io.decode(r.lqip)); } catch (_) { v = null; }
        ids.push(r.id);
        means.push(v ? v.mean : null);
        spreads.push(v ? v.spread : null);
        if (!v) out.undecodable++; else if (isTooDark(v)) out.dark++;
      }
      out.judged += await io.record(ids, means, spreads);
      out.batches++;
      if (rows.length < opts.batch) break;
    }
  } catch (e) {
    /* Partial work is kept: every batch already settled stays settled, and the next sweep
       starts where this one stopped. The error rides out in the answer so it lands in
       net._http_response next to the run that hit it. */
    out.error = String((e && e.message) || e).slice(0, 300);
  }
  out.ms = io.now() - started;
  return out;
}

/* ══ END CORE ══════════════════════════════════════════════════════════════════════════════ */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

/* jpeg-js ships CJS; Deno's npm interop hands it back as a default object on some versions and
   spreads the named exports on others. Both shapes, once, here. */
const decodeJpeg = (jpeg && jpeg.decode) ? jpeg.decode : jpeg;

const DATA_URL = /^data:image\/jpeg;base64,/;

/** data: URL → {width, height, data}. Throws on anything that is not the shape the app writes;
    the caller turns a throw into "unjudgeable", which is the same answer the browser gives. */
function decodeLqip(lqip) {
  if (typeof lqip !== "string" || !DATA_URL.test(lqip)) throw new Error("not a jpeg data url");
  const b64 = lqip.slice(lqip.indexOf(",") + 1);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return decodeJpeg(bytes, { useTArray: true, maxMemoryUsageInMB: 16 });
}

/** Every RPC re-checks the secret inside Postgres — checking it once at the door and trusting
    the rest of the conversation is how a leaked URL turns into a write. */
async function rpc(secret, name, body) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ p_secret: secret, ...body }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${name} -> ${r.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  const secret = req.headers.get("x-kamo-secret") ?? "";
  if (!secret) return new Response("forbidden", { status: 403 });
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return new Response(JSON.stringify({ error: "no service credentials in this isolate" }),
      { status: 500, headers: { "Content-Type": "application/json" } });
  }

  let body = {};
  try { body = await req.json(); } catch (_) { body = {}; }
  const opts = {
    batch: Math.min(1000, Math.max(1, Number(body.batch) || 400)),
    budget_ms: Math.min(120000, Math.max(1000, Number(body.budget_ms) || 20000)),
  };

  const io = {
    now: () => Date.now(),
    decode: decodeLqip,
    next: (limit) => rpc(secret, "lqip_next_batch", { p_limit: limit }),
    record: (ids, means, spreads) =>
      rpc(secret, "lqip_record", { p_ids: ids, p_means: means, p_spreads: spreads }),
  };

  try {
    const out = await sweep(io, opts);
    return new Response(JSON.stringify(out),
      { status: out.error ? 500 : 200, headers: { "Content-Type": "application/json" } });
  } catch (e) {
    /* The only way out of sweep() is a throw from the FIRST next() — i.e. a bad secret, which
       Postgres answers 42501 to. Say so plainly rather than logging a stack nobody reads. */
    const msg = String((e && e.message) || e).slice(0, 300);
    return new Response(JSON.stringify({ error: msg }),
      { status: /forbidden|42501/.test(msg) ? 403 : 500,
        headers: { "Content-Type": "application/json" } });
  }
});
