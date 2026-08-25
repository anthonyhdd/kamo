/**
 * "Someone found your hide." — and, since 2026-08-13, "they challenged you back."
 * Since 2026-08-16 it also carries the reaction: "someone sent 🔥 on your kamo."
 *
 * The ONE thing KAMO has never been able to say. Everything the app sends today is either a
 * daily reminder built a fortnight ahead — so it can only talk about hiding in the abstract —
 * or a blind three-hour timer that says "go look", which lands on an empty results card for
 * the 88% of hides nobody opens. This is the first notification that is about something that
 * actually happened.
 *
 * THREE CALLERS, ONE PIPELINE. An AFTER INSERT trigger on `attempts` (someone played your
 * hide), one on `hides` (someone answered it), and one on `hide_reactions` (someone reacted
 * in the feed). They are siblings on purpose: same shared secret, same throttle, same
 * 09:00-22:00 local window, same swallow-and-log posture. A second function would have
 * meant a second copy of all four, and the first one to drift would have done it silently.
 *
 * verify_jwt is off because pg_net sends a shared secret header rather than a JWT; the secret
 * is checked inside the database by the two RPCs below, so a leaked function URL on its own
 * buys nothing.
 *
 * DELIVERY IS VIA EXPO, NOT RAW APNs. KAMO is an Expo app built on EAS, so the APNs key lives
 * in EAS credentials and Expo's relay holds it. That keeps a .p8 out of this function's
 * environment entirely — the alternative is signing JWTs here and storing an Apple private
 * key in a Deno secret, for a payload this small.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

type Payload = {
  push_token: string;
  n_attempts: number;
  n_found: number;
  name: string | null;
};

/** The replier's handle, narrowed again here. It is written by one user's device and rendered
 *  on another's lock screen, which is the same trust boundary the seeker headline crosses. */
function handle(v: unknown): string {
  const s = String(v ?? "").replace(/[^A-Za-z0-9_.]/g, "").slice(0, 16);
  return s;
}

/** The reaction emoji, narrowed to the exact four react_to_hide accepts. Anything else — and
 *  this arrives through a body a leaked URL could post to — falls back to the flame rather
 *  than reaching a lock screen verbatim. */
function rxEmoji(v: unknown): string {
  const s = String(v ?? "");
  return ["🔥", "😂", "😱", "👏"].includes(s) ? s : "🔥";
}

/**
 * THREE FIELDS, because that is what iOS renders: title bold, subtitle bold-grey, body
 * underneath — the same split notifications.js uses for the daily reminder, so the two do not
 * end up looking like they came from different apps.
 *
 * KEPT HONEST, which is the house rule in notifications.js and matters more here: this fires
 * off a real event, so it must describe that event and nothing more. No "your hide is going
 * viral", no invented crowd. `missed` subtracts the finder's own failed taps the same way the
 * seeker's own ending screen does — a hide found on the third tap must not report "2 people
 * missed them" about one person.
 *
 * EMOJI ARE PAYLOAD HERE, NOT DECORATION, and the reaction line below is the cautionary tale.
 * The reply title still brackets itself with a repeated 🫥 and notif.json's daily title does
 * the same with ⚠️ — both are founder copy and deliberate, so they stay. The rule is that a
 * glyph must be earning something, not that one is too many.
 */
function compose(kind: string, hit: boolean, p: Payload, fromName: string, emoji: string) {
  /* THE REPLY. Named after the thing that happened rather than after the app: somebody the
     user challenged has hidden one back, and the only interesting fact is whose turn it is
     now. The handle is used when there is one — a dare with a person behind it is a stronger
     ask than an anonymous one — and "Someone" carries it when there is not, which is the
     majority case (117 of 3191 hides are signed). */
  if (kind === "reply") {
    return {
      title: "🫥 Challenged back 🫥",
      subtitle: fromName ? `@${fromName} challenged you back` : "They challenged you back",
      body: "Their turn to hide. Can you find them?",
    };
  }
  /* THE REACTION — the only signal a seeker can send without playing, finally reaching the
     person it was aimed at. One event, one emoji, no invented crowd: the trigger throttles
     per hide, so this line never claims more than the single reaction that fired it.
     ONE EMOJI, ONCE. This printed the glyph three times — twice bracketing the title and
     again inside the subtitle — and on a real lock screen (founder, 2026-08-25) it read as
     noise rather than news: 😱 On your kamo 😱 / Someone sent 😱 in the feed. The emoji IS
     the payload, so it leads the title where the eye lands first and the subtitle goes back
     to being a plain sentence. Same shape as the found line, which carries one 💀 and stops. */
  if (kind === "reaction") {
    return {
      title: `${emoji} On your kamo`,
      subtitle: "Someone reacted in the feed",
      body: "Your photo is getting played. See how it's doing.",
    };
  }
  const missed = Math.max(0, (p.n_attempts | 0) - (p.n_found | 0));
  if (hit) {
    /* FOUNDER'S COPY, 2026-08-13, replacing "⚠️ Found ⚠️". The warning triangles were the
       lock screen's own alarm vocabulary — they read like a system alert about the app rather
       than news from inside it. The skull is the game's own reaction to being spotted.
       THE FINDER IS NOT NAMED HERE and cannot be yet: this fires off an AFTER INSERT on
       `attempts`, and an attempt carries coordinates, a time and a verdict — never who was
       hunting. The handle rides the seek TRACE, which is written by a separate call that may
       land after this one. Naming them would mean putting the handle on submit_attempt, which
       is the hottest path in the product and not worth it for a lock screen line. "Someone"
       is the honest word until that changes. */
    return {
      title: "Your Kamo Found 💀",
      subtitle: "Someone found your hide",
      body: missed > 0
        ? `${missed} ${missed === 1 ? "person" : "people"} missed. Somebody didn't.`
        : "They spotted you. See how.",
    };
  }
  return {
    title: "Someone's hunting you 👀",
    subtitle: "Your hide just got opened",
    body: "Somebody is looking for you right now.",
  };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method" }, 405);

  const secret = req.headers.get("x-kamo-secret") || "";
  if (!secret) return json({ error: "forbidden" }, 403);

  let hideId = "";
  let hit = false;
  let kind = "found";
  let replyId = "";
  let fromName = "";
  let emoji = "🔥";
  try {
    const b = await req.json();
    hideId = String(b?.hide_id || "");
    hit = !!b?.hit;
    /* Defaults to the original behaviour on purpose: the attempts trigger sends no `kind`,
       and it must keep working unchanged whatever is added here later. */
    kind = String(b?.kind || "found");
    replyId = String(b?.reply_id || "").replace(/[^a-f0-9]/gi, "").slice(0, 16);
    fromName = handle(b?.from_name);
    emoji = rxEmoji(b?.emoji);
  } catch (_) {
    return json({ error: "bad_body" }, 400);
  }
  if (!hideId) return json({ error: "bad_body" }, 400);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // The secret is validated here, by the database, not by this process.
  const { data, error } = await supabase.rpc("push_dispatch_payload", {
    p_id: hideId,
    p_secret: secret,
  });

  /* A REJECTED SECRET AND A BROKEN CALL ARE NOT THE SAME EVENT, and collapsing them into one
     403 cost a full diagnostic cycle the first time this deployed: the RPC was fine and the
     secret was right, but PostgREST had not reloaded its schema cache yet, so every call came
     back looking exactly like an auth failure. `forbidden` is the only message the database
     raises on a bad secret; anything else is infrastructure and deserves a 502 and its own
     text, because the two have completely different fixes. */
  if (error) {
    const denied = /forbidden/i.test(error.message || "");
    return json({ error: denied ? "forbidden" : "rpc_failed", detail: error.message }, denied ? 403 : 502);
  }

  const p: Payload | undefined = Array.isArray(data) ? data[0] : data;
  // Not an error: the token can be cleared between the trigger firing and this running.
  if (!p?.push_token) return json({ sent: false, reason: "no_token" });

  const msg = compose(kind, hit, p, fromName, emoji);
  let ticket: Record<string, unknown> | undefined;
  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        to: p.push_token,
        sound: "default",
        ...msg,
        /* Read back by subscribeNotificationOpens in notifications.js, which attributes an
           open by `source`. Anything it does not recognise is counted as neither.
           `hide` NOW RIDES ON EVERY KIND. No released binary routes on it yet, so this
           changes nothing on its own; it is the half that can ship without an App Store
           review, so that the half that cannot is a one-line read when it does. The wrapper
           wants: on `key: "found"` or `key: "reaction"`, open the player card on `hide`. */
        data: kind === "reply"
          ? { source: "web_notif", key: "reply", hide: replyId }
          : kind === "reaction"
            ? { source: "web_notif", key: "reaction", hide: hideId }
            : { source: "web_notif", key: "found", hide: hideId },
      }),
    });
    const body = await res.json();
    ticket = Array.isArray(body?.data) ? body.data[0] : body?.data;
  } catch (e) {
    return json({ sent: false, reason: "expo_unreachable", detail: String(e).slice(0, 200) }, 502);
  }

  // A token survives an uninstall on Expo's side but stops being deliverable. Left in place
  // it is worse than useless: every later attempt re-queues a push that cannot land, and the
  // throttle keeps stamping last_notified_at, so a live token attached later
  // would be silenced by a dead one.
  if (ticket?.status === "error" && (ticket as any)?.details?.error === "DeviceNotRegistered") {
    await supabase.rpc("push_clear_token", { p_id: hideId, p_secret: secret });
    return json({ sent: false, reason: "device_not_registered" });
  }

  return json({ sent: ticket?.status === "ok", kind, ticket });
});
