#!/usr/bin/env node
/**
 * BLACK-SLAB SWEEP TEST — extracts the real verdict()/sweep() out of infra/edge-measure-lqip.ts
 * and drives them with fake pixels and fake I/O.
 *
 * Not a copy of the logic: the CORE region is cut out of the source file and evaluated, so this
 * fails if that file changes and the behaviour does not survive. Same contract as
 * test-edge-cleanup.mjs, and for the same reason — the function is deployed by hand to Supabase
 * and nothing else in this repo forces it to stay honest.
 *
 * WHAT IT GUARDS. This job decides, once and for everyone, that a hide never appears in the
 * feed again. Four properties, and each of them has a way of failing silently:
 *
 *   anything too dark to play reads dark         — the thing being fixed
 *   an ordinary photograph does NOT              — the way this feature becomes a bug
 *   an unjudgeable placeholder is null, not 0/0  — null serves the hide; 0/0 buries it
 *   ids, means and spreads stay aligned          — a slipped array buries the wrong hides
 *
 * Plus the two ways an unattended five-minute loop misbehaves: a batch that never drains
 * spinning until the isolate dies, and a budget so eager the sweep measures nothing at all.
 *
 *   node scripts/test-edge-lqip.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(ROOT, 'infra', 'edge-measure-lqip.ts'), 'utf8');

let failed = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { failed++; console.log('  ✗ ' + m); };
const eq = (got, want, m) => (JSON.stringify(got) === JSON.stringify(want)
  ? ok(m) : bad(`${m} — got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`));

/* The region is annotation-free JavaScript by construction — that is what the markers in the
   source are promising. If someone adds a TS type in there this throws, which is the intended
   way to find out. */
const A = src.indexOf('/* ══ CORE ══');
const B = src.indexOf('/* ══ END CORE ══');
if (A < 0 || B < 0) throw new Error('could not find the CORE markers in infra/edge-measure-lqip.ts');
const core = src.slice(src.indexOf('*/', A) + 2, B);
const { verdict, isTooDark, sweep, DARK_MEAN } =
  new Function(`${core}; return { verdict, isTooDark, sweep, DARK_MEAN };`)();

/** A decoded placeholder whose pixels come from a function of (x, y) — no JPEG involved. */
function img(w, h, px) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = px(x, y);
      const i = (y * w + x) * 4;
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}

const flat = (v) => (w, h) => img(w, h, () => [v, v, v]);

console.log('the verdict');
{
  /* The #223 slab the reply bug published: a frame with nothing in it. */
  eq(verdict(flat(0)(20, 26)), { mean: 0, spread: 0 }, 'a pure black placeholder reads 0/0');
  eq(isTooDark(verdict(flat(0)(20, 26))), true, '...and that is too dark to serve');

  /* What a real slab looks like once it is 20px wide: near-black, and what little variation
     survives the downscale is tiny. A bright speck in the ORIGINAL photograph does not survive
     — one pixel in 54x54 — so the thing to assert is this, not a synthetic hot pixel. */
  const grain = img(20, 26, (x, y) => { const v = 2 + ((x + y) % 3); return [v, v, v]; });
  eq(isTooDark(verdict(grain)), true, 'near-black with only grain in it is too dark');

  /* A dim room with plenty of variation still goes, since 2026-09-19: the founder's call is
     that a photograph nobody can see is as bad as a rectangle, however textured it is. This
     was the case the first cut protected, and protecting it was the mistake. */
  const room = img(20, 26, (x) => { const v = 2 + x * 2; return [v, v, v]; });   // mean 21, spread 38
  eq(isTooDark(verdict(room)), true, 'a dark photograph WITH variation is dropped too');

  /* THE ONE THAT MUST NOT BE DROPPED: an ordinary photograph. 73% of the corpus is mean 80+,
     and a cut that reached it would empty the feed rather than clean it. */
  eq(isTooDark(verdict(flat(140)(20, 26))), false, 'a normally-lit frame is kept');
  eq(isTooDark(verdict(img(20, 26, (x) => { const v = 45 + x; return [v, v, v]; }))), false,
    'and so is a dim-but-legible one just above the cut');

  eq(verdict(null), null, 'no image at all is unjudgeable');
  eq(verdict(img(2, 2, () => [0, 0, 0])), null, 'a 2x2 placeholder is unjudgeable, not dark');
  eq(verdict({ width: 20, height: 26 }), null, 'a decode that produced no pixels is unjudgeable');

  /* The cut lives in the SQL predicate too. If it ever moves here, it moves there the same
     day, or a sweep's answer stops describing the feed it feeds. */
  eq(DARK_MEAN, 40, 'the cut is mean < 40');

  /* Right at the edge, both sides of it, and the spread has no vote. */
  eq(isTooDark({ mean: 39, spread: 200 }), true, '39 is dark however textured');
  eq(isTooDark({ mean: 40, spread: 0 }), false, '40 is kept however flat (inclusive-out)');
  eq(isTooDark({ mean: 1, spread: 124 }), true, 'the black frame with one bright light goes');
}

/** A fake corpus and a fake pair of RPCs, recording exactly what was written. */
function harness({ rows = [], batch = 3, budget_ms = 60000, clock = null, failOn = -1 } = {}) {
  const pending = rows.map((r) => ({ ...r }));
  const written = [];
  let t = 0, calls = 0;
  const io = {
    now: () => (clock ? clock(t++) : 0),
    /* Fake "decoder": the row carries its decoded pixels directly, or a thrower. */
    decode: (lqip) => { if (lqip === 'broken') throw new Error('bad jpeg'); return lqip; },
    next: async (n) => {
      calls++;
      if (calls === failOn) throw new Error('lqip_next_batch -> 403 forbidden');
      return pending.splice(0, n);
    },
    record: async (ids, means, spreads) => {
      written.push({ ids, means, spreads });
      return ids.length;
    },
  };
  return { io, opts: { batch, budget_ms }, written, left: () => pending.length };
}

console.log('the sweep');
{
  const black = flat(0)(20, 26), photo = img(20, 26, (x) => [10 + x * 6, 10 + x * 6, 10 + x * 6]);
  const rows = [
    { id: 'a', lqip: black }, { id: 'b', lqip: photo }, { id: 'c', lqip: 'broken' },
    { id: 'd', lqip: photo }, { id: 'e', lqip: black },
  ];
  const h = harness({ rows, batch: 3 });
  const out = await sweep(h.io, h.opts);
  eq([out.judged, out.dark, out.undecodable, out.batches], [5, 2, 1, 2],
    'every row is judged once, and the counts say what happened');
  eq(h.left(), 0, 'the backlog drains');
  eq(h.written.map((w) => w.ids), [['a', 'b', 'c'], ['d', 'e']], 'ids go back in the order they came');
  eq(h.written[0].means, [0, 67, null], 'an unjudgeable row is written NULL, not zero');
  eq(h.written[0].spreads, [0, 114, null], 'and so is its spread — both or neither');
  eq(h.written.every((w) => w.ids.length === w.means.length && w.ids.length === w.spreads.length),
    true, 'the three arrays are always the same length');
}

{
  /* A short page means the corpus is exhausted: asking again would be a round trip for an
     empty answer, every five minutes, for ever. */
  const h = harness({ rows: [{ id: 'a', lqip: flat(0)(20, 26) }], batch: 8 });
  const out = await sweep(h.io, h.opts);
  eq(out.batches, 1, 'a short page ends the sweep without a second ask');
}

{
  const h = harness({ rows: [], batch: 8 });
  const out = await sweep(h.io, h.opts);
  eq([out.judged, out.batches, out.error], [0, 0, null], 'an empty backlog is a no-op, not a failure');
}

{
  /* The budget is a stop for the first day's drain, not a reason to do nothing: a clock that
     is already past it must still measure one batch. */
  const rows = Array.from({ length: 9 }, (_, i) => ({ id: 's' + i, lqip: flat(0)(20, 26) }));
  const h = harness({ rows, batch: 3, budget_ms: 1000, clock: (n) => n * 1000000 });
  const out = await sweep(h.io, h.opts);
  eq([out.batches, out.judged], [1, 3], 'a spent budget still measures one batch, then stops');
  eq(h.left(), 6, '...and leaves the rest for the next sweep');
}

{
  /* A budget that never expires must not turn a corpus that keeps answering into an isolate
     that never returns — the batch is what ends it, and a full page keeps it going. */
  const rows = Array.from({ length: 30 }, (_, i) => ({ id: 'r' + i, lqip: flat(0)(20, 26) }));
  const h = harness({ rows, batch: 10, budget_ms: 60000, clock: (n) => n * 100 });
  const out = await sweep(h.io, h.opts);
  eq([out.batches, out.judged, h.left()], [3, 30, 0], 'full pages keep going until the corpus is out');
}

{
  /* A refused secret on the first ask is the whole failure mode of a leaked URL. It must come
     back as an error, with nothing written. */
  const h = harness({ rows: [{ id: 'a', lqip: flat(0)(20, 26) }], failOn: 1 });
  const out = await sweep(h.io, h.opts);
  eq([out.judged, h.written.length], [0, 0], 'a refused first ask writes nothing');
  eq(/forbidden/.test(out.error || ''), true, '...and says why');
}

{
  /* A failure halfway keeps what was already settled: the next sweep starts where this one
     stopped, rather than re-measuring from the top for ever. */
  const rows = Array.from({ length: 9 }, (_, i) => ({ id: 'p' + i, lqip: flat(0)(20, 26) }));
  const h = harness({ rows, batch: 3, failOn: 3 });
  const out = await sweep(h.io, h.opts);
  eq([out.judged, out.batches], [6, 2], 'two batches survive a third that throws');
  eq(out.error !== null, true, '...and the error rides out in the answer');
}

console.log(failed ? `\n${failed} FAILED` : '\nall good');
process.exit(failed ? 1 : 0);
