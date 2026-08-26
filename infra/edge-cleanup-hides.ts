/**
 * THE NIGHTLY PURGE, DONE THROUGH THE DOOR SUPABASE LEAVES OPEN.
 *
 * `cleanup_expired_hides()` opened with a plain `delete from storage.objects` and had done so
 * since it was written. Supabase later put a trigger in front of that table —
 * `storage.protect_delete()` — so the statement now raises, and because it was the FIRST
 * statement in the function, the whole function aborted with it. Twenty scheduled runs since
 * 2026-08-07, twenty failures, zero successes, and not one of them told anybody: pg_cron
 * records the error in `cron.job_run_details` and nothing reads `cron.job_run_details`.
 *
 * The trigger is right and this file is the way round it, not a bypass. Deleting the ROW in
 * `storage.objects` never deleted the BYTES in S3 — it only detached them, which is precisely
 * the "orphaned objects" the HINT warns about. The bucket is 48 250 objects / 3.9 GB; the only
 * thing that can actually shrink it is the Storage API, and the only place we can call the
 * Storage API from is here.
 *
 * WHY AN EDGE FUNCTION AND NOT MORE SQL. There is no supported SQL entry point for deleting an
 * object — that is the entire point of the trigger. pg_net could in principle issue the
 * `DELETE /storage/v1/object/hides` itself, but it is fire-and-forget: it cannot see the
 * response, so it cannot know which keys went, cannot retry, and cannot decide anything on the
 * result. Every property asked of this job — idempotent, partial failure tolerated, the outcome
 * written down — needs the reply. So: pg_cron → pg_net → this, the same shape as
 * notify-creator, with the same shared-secret-checked-by-the-database posture.
 *
 * verify_jwt is OFF, as with notify-creator. pg_net sends `x-kamo-secret` and the secret is
 * validated inside Postgres by the three RPCs below, so a leaked function URL on its own buys
 * nothing — every RPC re-checks it, not just the first.
 *
 * IT ANSWERS 202 AND KEEPS WORKING. pg_net's timeout would otherwise have to cover the whole
 * sweep, which means holding a pg_net worker for a minute-plus every night — the same worker
 * every push notification queues through. So the secret is checked, 202 goes back inside a
 * second, and `EdgeRuntime.waitUntil` keeps the isolate alive for the rest. Nothing downstream
 * reads the body; the record of what happened is `public.ops_cleanup`, written from in here.
 *
 * A HIDE IS THREE OBJECTS. `chUploadReveal()` posts `<base>_b.jpg` and `<base>_w.jpg` beside
 * the camouflaged photo — the seeker's snap and A/B flip — at names derived from `img_path` and
 * recorded in no column at all. They are 27 918 of the bucket's 48 371 objects and more than
 * half its bytes. A purge that deletes only `img_path` reclaims 40% of a hide and lets the
 * bucket grow anyway, so the claim RPC hands back all three names per row, or none.
 *
 * ⚠️ AND IT DOES NOT SWEEP BY "NO ROW NAMES THIS OBJECT". 27 912 of the 30 028 unreferenced
 * objects are the reveal frames of LIVE hides — unreferenced by construction. Deleting them
 * would take the payoff frame off every current hide in the product.
 *
 * ⚠️ DELETING A HIDE DELETES ITS ATTEMPTS. `attempts` and `seek_traces` both carry ON DELETE
 * CASCADE, so this destroys the history behind every retention figure in CLAUDE.md, computed
 * over exactly the thirty-day window being purged. Nobody has seen it because the job has never
 * worked. Changing that is a schema decision and not this file's to take on the way past, so
 * what happens instead is that every run RECORDS what it cascaded — see cleanup_settle_batch.
 *
 * Deploy:  supabase functions deploy cleanup-hides --no-verify-jwt
 * Mirror:  this file. The function lives in Supabase and deploying does not touch this repo,
 *          so diff the two before believing either — same rule as edge-h.ts.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const BUCKET = "hides";

/* ══ CORE ══════════════════════════════════════════════════════════════════════════════════
   Everything between these two markers is plain JavaScript on purpose — no type annotations —
   because scripts/test-edge-cleanup.mjs slices this exact region out of this file and runs it
   under Node with fake I/O. A test that re-implemented the loop would pass while this drifted;
   this one fails when the behaviour here changes. Keep the region annotation-free. */

/** The Storage API takes a list per call; this is what decides how long that list is. */
function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/**
 * One night's work. Every side effect arrives through `io` so the decisions can be tested
 * without a database, a bucket, or a clock.
 *
 * io.claimOrphans(n)             -> [path]        paths whose row is already gone
 * io.clearOrphans(paths)         -> void
 * io.claimBatch(n)               -> [{id, paths}]   paths: every object this hide owns
 * io.settleBatch(ids, removed, failedPaths) -> {deleted, remaining}
 * io.removeObjects(paths)        -> {ok, count, error}
 * io.now()                       -> ms
 */
async function sweep(io, opts) {
  const t = {
    batches: 0, claimed: 0, objects_removed: 0, objects_missing: 0, objects_shared: 0,
    rows_deleted: 0, orphaned: 0, retried: 0, remaining: null, stopped_for: null, notes: [],
  };
  const deadline = io.now() + opts.budget_ms;

  /* ── LAST NIGHT'S ORPHANS FIRST ──────────────────────────────────────────────────────────
     A path lands in ops_cleanup_orphans when the Storage API refused it and its `hides` row
     was deleted anyway. Nothing else in the system will ever look at that file again — the
     row that named it is gone — so if this does not come back for it, those bytes are billed
     forever. It runs before the new work because a night that runs out of budget should spend
     what it had on the debt, not add to it. */
  try {
    const stale = await io.claimOrphans(opts.orphan_limit);
    for (const part of chunk(stale, opts.api_chunk)) {
      if (io.now() > deadline) { t.stopped_for = "time"; break; }
      const r = await io.removeObjects(part);
      /* A key that is no longer there comes back as a success with a shorter list, not as an
         error — which is what makes retrying an orphan safe however many times it takes. */
      if (!r.ok) { t.notes.push("orphan_retry: " + r.error); break; }
      await io.clearOrphans(part);
      t.retried += part.length;
    }
  } catch (e) {
    /* The orphan pass is the optional half. It must never cost us tonight's purge. */
    t.notes.push("orphan_retry: " + String(e).slice(0, 200));
  }

  /* ── TONIGHT'S CANDIDATES ────────────────────────────────────────────────────────────────
     Claim, delete the objects, then delete the rows — in that order, and never the reverse.
     The row is the only thing that knows the path: delete it first and a failed object delete
     is unrecoverable. Done this way, a crash anywhere leaves the row in place and tomorrow
     claims it again. */
  while (t.batches < opts.max_batches) {
    if (io.now() > deadline) { t.stopped_for = "time"; break; }

    const rows = await io.claimBatch(opts.batch);
    if (!rows.length) break;
    t.batches++;
    t.claimed += rows.length;

    /* `paths` is decided in SQL, not here — all three names a hide owns, or an EMPTY LIST when
       a surviving hide still points at the same file. 323 img_paths are shared that way,
       because a re-hide reuses the object it was made from; taking the file because the older
       row expired blanks out a hide still in the feed. Those rows are still deleted; only their
       files stay. An empty list here is a decision, never a missing value. */
    const paths = [...new Set(rows.flatMap((r) => r.paths || []))];
    t.objects_shared += rows.filter((r) => !(r.paths && r.paths.length)).length;

    let removed = 0;
    const failed = [];
    for (const part of chunk(paths, opts.api_chunk)) {
      let r = await io.removeObjects(part);
      if (!r.ok) r = await io.removeObjects(part);   // one retry; a blip is not a verdict
      if (r.ok) {
        removed += r.count;
        t.objects_missing += part.length - r.count;  // already gone: the idempotent case
      } else {
        failed.push(...part);
        t.notes.push("remove: " + r.error);
      }
    }
    t.objects_removed += removed;
    t.orphaned += failed.length;

    /* THE ROWS GO EITHER WAY, and that is the requirement this whole file exists to satisfy.
       A bucket that refuses a delete must not be able to stop `hides` from being purged —
       that is how twenty nights of nothing happened. The paths it refused are written down in
       ops_cleanup_orphans by settleBatch, so "deleted anyway" is not the same as "forgotten". */
    const s = await io.settleBatch(rows.map((r) => r.id), removed, failed);
    t.rows_deleted += s.deleted;
    t.remaining = s.remaining;

    /* Claimed rows that did not delete would be claimed again next iteration, forever. A
       permission change or a foreign key added later is exactly how that happens; cap it here
       rather than discovering it as forty identical batches. */
    if (s.deleted === 0) { t.stopped_for = "no_progress"; break; }
    if (rows.length < opts.batch) break;             // short page: that was the last of them
  }
  if (t.batches >= opts.max_batches && t.stopped_for === null) t.stopped_for = "max_batches";
  return t;
}

/* ══ END CORE ══════════════════════════════════════════════════════════════════════════════ */

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function ioFor(sb: any, secret: string, run: number) {
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await sb.rpc(fn, { p_secret: secret, p_run: run, ...args });
    if (error) throw new Error(fn + ": " + error.message);
    return data;
  };
  return {
    now: () => Date.now(),
    claimOrphans: async (n: number) => (await rpc("cleanup_claim_orphans", { p_limit: n })) ?? [],
    clearOrphans: async (paths: string[]) => { await rpc("cleanup_clear_orphans", { p_paths: paths }); },
    claimBatch: async (n: number) => (await rpc("cleanup_claim_batch", { p_limit: n })) ?? [],
    settleBatch: async (ids: string[], removed: number, failed: string[]) => {
      const d = await rpc("cleanup_settle_batch", { p_ids: ids, p_removed: removed, p_failed: failed });
      return { deleted: d?.deleted ?? 0, remaining: d?.remaining ?? null };
    },
    removeObjects: async (paths: string[]) => {
      try {
        const { data, error } = await sb.storage.from(BUCKET).remove(paths);
        if (error) return { ok: false, count: 0, error: String(error.message).slice(0, 200) };
        return { ok: true, count: Array.isArray(data) ? data.length : 0, error: null };
      } catch (e) {
        return { ok: false, count: 0, error: String(e).slice(0, 200) };
      }
    },
  };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method" }, 405);

  const secret = req.headers.get("x-kamo-secret") || "";
  if (!secret) return json({ error: "forbidden" }, 403);

  let run = 0;
  let opts = { batch: 200, api_chunk: 100, max_batches: 40, budget_ms: 90000, orphan_limit: 500 };
  try {
    const b = await req.json();
    run = Number(b?.run_id || 0);
    opts = { ...opts, ...(b?.opts && typeof b.opts === "object" ? b.opts : {}) };
  } catch (_) {
    return json({ error: "bad_body" }, 400);
  }
  if (!run) return json({ error: "bad_body" }, 400);

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  /* The secret is checked by the database, not by this process — and checked again inside
     every RPC below. A rejected secret and a broken call are different events with different
     fixes, so they do not share a status code; that distinction cost a full diagnostic cycle
     the first time notify-creator deployed against a stale PostgREST cache. */
  const { error: authErr } = await sb.rpc("cleanup_ping", { p_secret: secret, p_run: run });
  if (authErr) {
    const denied = /forbidden/i.test(authErr.message || "");
    return json({ error: denied ? "forbidden" : "rpc_failed", detail: authErr.message }, denied ? 403 : 502);
  }

  const io = ioFor(sb, secret, run);
  const work = (async () => {
    let t: any = null;
    let status = "ok";
    let err: string | null = null;
    try {
      t = await sweep(io, opts);
      if (t.orphaned > 0 || t.stopped_for === "no_progress") status = "partial";
      else if (t.notes.length) status = "partial";
    } catch (e) {
      status = "failed";
      err = String(e).slice(0, 500);
    }
    try {
      await sb.rpc("cleanup_close_run", {
        p_secret: secret, p_run: run, p_status: status,
        p_error: err, p_summary: t ?? {},
      });
    } catch (_) {
      /* The run row stays at 'dispatched'. That is not a lost signal: cleanup_expired_hides()
         reads the previous row before dispatching and alerts on anything it did not close. */
    }
  })();

  // @ts-ignore EdgeRuntime is provided by the Supabase runtime, absent when run locally.
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) EdgeRuntime.waitUntil(work);
  else await work;

  return json({ accepted: true, run }, 202);
});
