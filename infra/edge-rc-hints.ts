import "jsr:@supabase/functions-js/edge-runtime.d.ts";

/**
 * KAMO — hint pack credit, from the RevenueCat webhook.
 *
 * THIS IS THE ONLY THING IN THE SYSTEM ALLOWED TO ADD HINTS. The client can spend
 * (hint_spend, granted to anon) and read (hint_state); it cannot credit. hint_credit is
 * revoked from anon and authenticated, so the service-role call below is the single door,
 * and the only actor that reaches it is a webhook that has seen a real Apple payment.
 * Keep it that way: the anon key ships in plain text inside index.html.
 *
 * verify_jwt is off because RevenueCat cannot mint a Supabase JWT. The auth is the shared
 * secret checked below, and it FAILS CLOSED — an unset RC_WEBHOOK_SECRET returns 503 rather
 * than accepting everything. An open credit endpoint is worse than a broken one: nobody
 * would notice the first, and the second shows up in RevenueCat's delivery log immediately.
 *
 * ⚠️ THIS FILE IS A COPY. The function lives in Supabase and deploying does not touch this
 * repo — the same posture as edge-h.ts and edge-notify-creator.ts. Diff the two before
 * believing either.
 */

const PACK_PRODUCT_ID = "com.blisscoach.kamo.hints5";
const HINTS_PER_PACK = 5;

/**
 * TRIMMED ON BOTH SIDES, AND THAT IS NOT LAXITY.
 *
 * The expected value is typed into a multi-line <textarea> in the Supabase dashboard
 * ("Supports multi-line values such as PEM keys"), which is exactly the control that
 * silently keeps a trailing newline off a paste. The received value comes from an HTTP
 * header, where leading and trailing whitespace is not significant per RFC 9110 anyway.
 * Comparing raw turned a correct secret into a 401 on the first test delivery.
 *
 * Whitespace is the ONLY thing forgiven — the comparison below is still exact, still
 * constant-time, and an empty secret still fails closed above.
 */
function sameSecret(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a.trim()), eb = new TextEncoder().encode(b.trim());
  if (ea.length !== eb.length) return false;
  let diff = 0;
  for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ eb[i];
  return diff === 0;
}

/**
 * Enough to diagnose a mismatch, not enough to reconstruct anything: the byte length and
 * the first 8 hex of a SHA-256. Two different lengths means truncation or stray whitespace;
 * same length with different digests means genuinely different values. The secret itself is
 * never written to a log line.
 */
async function fingerprint(s: string): Promise<string> {
  const t = s.trim();
  if (!t) return "len=0";
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t));
  const hex = Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return `len=${t.length} sha=${hex.slice(0, 8)}`;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  const secret = Deno.env.get("RC_WEBHOOK_SECRET") ?? "";
  if (!secret.trim()) return json(503, { error: "webhook_secret_not_configured" });

  const got = req.headers.get("Authorization") ?? "";
  if (!sameSecret(got, secret)) {
    /* Logged on the FAILURE path only, so a working webhook writes nothing about its own
       credentials. Read it with: select event_message from logs where source='function_logs'. */
    console.error(`auth mismatch — expected(${await fingerprint(secret)}) received(${await fingerprint(got)})`);
    return json(401, { error: "unauthorized" });
  }

  let payload: any;
  try { payload = await req.json(); } catch { return json(400, { error: "bad_json" }); }

  const e = payload?.event ?? {};
  const type = String(e.type ?? "");

  /* 200, NOT 500, FOR EVERYTHING WE DO NOT ACT ON. RevenueCat retries non-2xx responses with
     backoff, so answering 500 to a RENEWAL or a TEST ping would queue retries forever for
     events that will never be interesting. 2xx means "received", not "credited". */
  if (type === "TEST") return json(200, { ok: true, note: "test event acknowledged" });
  if (type !== "NON_RENEWING_PURCHASE") return json(200, { ok: true, ignored: type });

  const productId = String(e.product_id ?? "");
  if (productId !== PACK_PRODUCT_ID) return json(200, { ok: true, ignored_product: productId });

  /* app_user_id, not original_app_user_id: the wallet is keyed by the id the SDK is using
     right now, which is what the web reads back through hint_state. They are the same value
     unless an alias was created, and in that case the buyer is the current id. */
  const owner = String(e.app_user_id ?? "");
  const eventId = String(e.id ?? "");
  if (!owner || !eventId) return json(200, { ok: true, ignored: "missing_owner_or_event_id" });

  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return json(500, { error: "service_role_not_available" });

  /* SANDBOX purchases credit too, deliberately: without it the feature cannot be tested on a
     real device before release, and a sandbox purchase needs an Apple sandbox account that
     ordinary users do not have.
     ⚠️ IT IS NOW RECORDED, WHICH IT WAS NOT. The environment used to ride along in the
     RESPONSE only, so it reached the delivery log and nothing else — in the table a sandbox
     test and a real sale were the same row. On 2026-08-31 that produced a confident wrong
     answer out loud: the single grant on record was called a sandbox test, and RevenueCat
     says it is production, 1.16 USD gross, bought from France. Any question about sales has
     to be able to filter, so the value is written down now.
     ⚠️ THE 4-ARGUMENT OVERLOAD WAS ADDED BESIDE THE 3-ARGUMENT ONE, not in place of it.
     This function and the database deploy separately, so during a deploy both are live and
     a webhook in flight still calls the old signature — the same rule create_hide follows. */
  const environment = String(e.environment ?? "");
  const res = await fetch(`${url}/rest/v1/rpc/hint_credit`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: key, Authorization: `Bearer ${key}` },
    body: JSON.stringify({ p_event_id: eventId, p_owner: owner, p_units: HINTS_PER_PACK, p_environment: environment }),
  });

  const text = await res.text();
  /* A database failure DOES answer 500 — that one is worth retrying, and hint_credit is
     idempotent on event_id, so a retry after a partial failure cannot double-credit. */
  if (!res.ok) return json(500, { error: "credit_failed", status: res.status, body: text.slice(0, 400) });

  let result: unknown = text;
  try { result = JSON.parse(text); } catch { /* keep the raw body */ }
  return json(200, { ok: true, environment, result });
});
