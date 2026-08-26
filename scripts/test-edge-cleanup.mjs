#!/usr/bin/env node
/**
 * NIGHTLY-PURGE TEST — extracts the real sweep() out of infra/edge-cleanup-hides.ts and drives
 * it with fake I/O.
 *
 * Not a copy of the logic: the CORE region is cut out of the source file and evaluated, so this
 * fails if that file changes and the behaviour does not survive. Same contract as
 * test-edge-h.mjs, and for the same reason — the function is deployed by hand to Supabase and
 * nothing else in this repo forces it to stay honest.
 *
 * WHAT IT GUARDS. `cleanup_expired_hides()` failed twenty nights running and told nobody, and
 * the reason it failed is a property no DOM test and no static check can see: one refused
 * delete aborted every deletion behind it. The four things that must hold, forever:
 *
 *   the rows go even when the bucket refuses     — the exact defect being fixed
 *   a refused path is written down, not lost     — or the bytes are billed forever
 *   an object that is already gone is not an error — the job has to be re-runnable
 *   objects are deleted BEFORE their rows        — the row is the only thing holding the path
 *
 * Plus the two ways an unattended nightly loop eats a database: a batch that never drains
 * spinning forever, and a shared object being deleted out from under a hide still in the feed.
 *
 *   node scripts/test-edge-cleanup.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(ROOT, 'infra', 'edge-cleanup-hides.ts'), 'utf8');

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
if (A < 0 || B < 0) throw new Error('could not find the CORE markers in infra/edge-cleanup-hides.ts');
const core = src.slice(src.indexOf('*/', A) + 2, B);
const { chunk, sweep } = new Function(`${core}; return { chunk, sweep };`)();

const OPTS = { batch: 2, api_chunk: 2, max_batches: 40, budget_ms: 60000, orphan_limit: 10 };

/* A fake bucket and a fake table, plus a call log — the ORDER of the calls is itself under
   test, so it is recorded rather than only counted. */
function harness({ hides = [], orphans = [], remove, clock } = {}) {
  const db = hides.map((h) => ({ ...h }));
  const orph = [...orphans];
  const log = [];
  let t = 0;
  const io = {
    now: () => (clock ? clock(t++) : 0),
    claimOrphans: async (n) => { log.push('claimOrphans'); return orph.slice(0, n); },
    clearOrphans: async (paths) => {
      log.push('clearOrphans:' + paths.join(','));
      for (const p of paths) { const i = orph.indexOf(p); if (i >= 0) orph.splice(i, 1); }
    },
    claimBatch: async (n) => { log.push('claimBatch'); return db.slice(0, n).map((h) => ({ ...h })); },
    settleBatch: async (ids, removed, failedPaths) => {
      log.push('settleBatch:' + ids.join(','));
      if (io.settleDeletesNothing) return { deleted: 0, remaining: db.length };
      for (const id of ids) { const i = db.findIndex((h) => h.id === id); if (i >= 0) db.splice(i, 1); }
      return { deleted: ids.length, remaining: db.length };
    },
    removeObjects: async (paths) => {
      log.push('removeObjects:' + paths.join(','));
      return remove ? remove(paths) : { ok: true, count: paths.length, error: null };
    },
  };
  return { io, db, orph, log };
}
/* A hide owns THREE objects — the photo and its two reveal frames. The fake mirrors that,
   because a fixture with one path per hide would let a regression to img_path-only pass. */
const objs = (base) => [base + '.jpg', base + '_b.jpg', base + '_w.jpg'];
const rows = (n, over = {}) => Array.from({ length: n }, (_, i) =>
  ({ id: 'h' + i, paths: objs('p' + i), ...over }));

console.log('\nNIGHTLY-PURGE TEST\n');

/* ---- 1. the plain case ------------------------------------------------------------------ */
{
  const h = harness({ hides: rows(5) });
  const t = await sweep(h.io, OPTS);
  eq([t.rows_deleted, t.objects_removed, t.orphaned, t.batches], [5, 15, 0, 3],
     'five hides, batches of two: every row and all THREE objects each');
  eq(h.db.length, 0, 'the table drains');
  eq(t.stopped_for, null, 'and it stops because it ran out of work, not out of budget');
}

/* ---- 2. THE DEFECT: the bucket refuses, the rows go anyway ------------------------------- */
{
  const h = harness({ hides: rows(4), remove: () => ({ ok: false, count: 0, error: 'boom' }) });
  const t = await sweep(h.io, OPTS);
  eq(t.rows_deleted, 4, 'a bucket that refuses every delete does not stop a single row');
  eq(t.orphaned, 12, 'and every refused path is counted as an orphan — reveal frames included');
  /* 4 hides / batch 2 = 2 batches; 6 paths a batch / chunk 2 = 3 chunks; each tried twice. */
  eq(h.log.filter((l) => l.startsWith('removeObjects')).length, 12,
     'each chunk is retried exactly once before it is given up on');
  eq(t.notes.length > 0, true, 'the refusal is carried out in notes, not swallowed');
}

/* ---- 3. idempotency: an object that is already gone is not a failure --------------------- */
{
  const h = harness({ hides: rows(2), remove: (p) => ({ ok: true, count: p.length - 1, error: null }) });
  const t = await sweep(h.io, OPTS);
  eq([t.rows_deleted, t.orphaned, t.objects_missing], [2, 0, 3],
     'a key the bucket no longer has is counted missing, never orphaned, and stops nothing');
}

/* ---- 4. the shared object stays ---------------------------------------------------------- */
{
  const h = harness({ hides: [
    { id: 'a', paths: [] },              // a live hide still points at this one's file
    { id: 'b', paths: objs('own') },
  ] });
  const t = await sweep(h.io, OPTS);
  const sent = h.log.filter((l) => l.startsWith('removeObjects')).join('|');
  eq(sent.includes('shared'), false, 'an object a live hide still points at is never sent to storage');
  eq(sent.includes('own_b.jpg') && sent.includes('own_w.jpg'), true,
     'while an unshared hide gives up its reveal frames too');
  eq([t.rows_deleted, t.objects_shared], [2, 1], 'its row is still deleted, and the skip is counted');
}

/* ---- 5. objects before rows -------------------------------------------------------------- */
{
  const h = harness({ hides: rows(2) });
  await sweep(h.io, { ...OPTS, api_chunk: 100 });
  const r = h.log.findIndex((l) => l.startsWith('removeObjects:p0.jpg'));
  const s = h.log.indexOf('settleBatch:h0,h1');
  eq(r >= 0 && s >= 0 && r < s, true,
     'the object is deleted before the row that names it — the other order loses the path');
}

/* ---- 6. a batch that never drains stops ---------------------------------------------------*/
{
  const h = harness({ hides: rows(4) });
  h.io.settleDeletesNothing = true;
  const t = await sweep(h.io, OPTS);
  eq([t.batches, t.stopped_for], [1, 'no_progress'],
     'a claim that deletes nothing breaks the loop instead of re-claiming forever');
}

/* ---- 7. the wall clock ------------------------------------------------------------------- */
{
  const h = harness({ hides: rows(10), clock: (i) => (i === 0 ? 0 : 999999) });
  const t = await sweep(h.io, { ...OPTS, budget_ms: 1000 });
  eq([t.batches, t.stopped_for], [0, 'time'], 'past the budget it stops cleanly and leaves the rest');
}

/* ---- 8. max_batches -----------------------------------------------------------------------*/
{
  const h = harness({ hides: rows(20) });
  const t = await sweep(h.io, { ...OPTS, max_batches: 3 });
  eq([t.batches, t.rows_deleted, t.stopped_for], [3, 6, 'max_batches'],
     'the batch cap holds and says why it stopped');
}

/* ---- 9. last night's orphans are retried, first --------------------------------------------*/
{
  const h = harness({ hides: rows(2), orphans: ['old1.jpg', 'old2.jpg'] });
  const t = await sweep(h.io, OPTS);
  eq(t.retried, 2, 'orphans from an earlier night are swept again');
  eq(h.orph.length, 0, 'and cleared once the bucket takes them');
  eq(h.log[0], 'claimOrphans', 'the debt is paid before new work is claimed');
}
{
  /* The orphan pass is the optional half and must never cost the night's purge. */
  const h = harness({
    hides: rows(2), orphans: ['old1.jpg'],
    remove: (p) => (p[0] === 'old1.jpg'
      ? { ok: false, count: 0, error: 'nope' } : { ok: true, count: p.length, error: null }),
  });
  const t = await sweep(h.io, OPTS);
  eq([t.retried, t.rows_deleted], [0, 2], 'an orphan the bucket still refuses does not block tonight');
}

/* ---- 10. the chunker ---------------------------------------------------------------------- */
{
  eq(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]], 'chunk() splits to the Storage API limit');
  eq(chunk([], 100), [], 'and an empty list is no calls at all');
}

console.log('');
if (failed) { console.log(`${failed} FAILED\n`); process.exit(1); }
console.log('all good\n');
