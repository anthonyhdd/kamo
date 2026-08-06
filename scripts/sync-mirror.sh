#!/usr/bin/env bash
#
# SYNC THE MIRROR — kamo → kamo-mirror.
#
# Two repos serve the same app on two domains:
#
#   anthonyhdd.github.io/kamo/   (repo: kamo)         ← what the INSTALLED APP loads
#   kamo.bliss-coach.com/        (repo: kamo-mirror)  ← where SHARE LINKS point
#
# They are separate on purpose. Attaching the custom domain to `kamo` makes GitHub Pages
# 301 github.io → http://kamo.bliss-coach.com, WKWebView refuses the cleartext hop, and the
# app is dead for everyone. That is the 2026-08-06 outage, 08:00–12:25. Do not "simplify"
# this by moving the domain onto `kamo`.
#
# The cost of two repos is drift, and drift is silent: the mirror sat 27 KB behind for weeks
# — no challenge card, old seeker screen, the reveal seam — and would have served that to
# anyone following a link. It drifted AGAIN within the hour, which is why this is a script
# and not a habit.
#
# Usage:  scripts/sync-mirror.sh ["commit subject"]
#
set -euo pipefail

KAMO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIRROR="$(cd "$KAMO/../kamo-mirror" 2>/dev/null && pwd || true)"

if [ -z "$MIRROR" ]; then
  echo "✗ kamo-mirror not found next to kamo — clone it first" >&2
  exit 1
fi

# The gate first. Pushing a broken index.html to two origins is twice the damage.
echo "→ running the pre-push gate"
node "$KAMO/scripts/check.mjs"

echo "→ copying the served files"
# index.html is copied last, after the patch below, so a half-synced mirror never serves.
for f in privacy.html terms.html icon.png; do
  cp "$KAMO/$f" "$MIRROR/$f"
done
cp "$KAMO"/vendor/* "$MIRROR/vendor/"

# THE ONE INTENTIONAL DIVERGENCE. og:image must be an absolute URL, so each origin points
# at its own copy. Everything else is byte-identical — if this ever needs a second exception,
# put it here rather than hand-editing the mirror, or the drift starts over.
sed 's#<meta property="og:image" content="https://anthonyhdd.github.io/kamo/icon.png" />#<meta property="og:image" content="https://kamo.bliss-coach.com/icon.png" />#' \
  "$KAMO/index.html" > "$MIRROR/index.html"

# Assert the divergence is exactly what we intended — one line, and the right one.
DIFF_LINES=$(diff "$KAMO/index.html" "$MIRROR/index.html" | grep -c '^[<>]' || true)
if [ "$DIFF_LINES" != "2" ]; then
  echo "✗ mirror differs from kamo on $((DIFF_LINES / 2)) lines, expected exactly 1 (og:image)" >&2
  diff "$KAMO/index.html" "$MIRROR/index.html" >&2 || true
  exit 1
fi
if ! grep -q 'og:image" content="https://kamo.bliss-coach.com/icon.png"' "$MIRROR/index.html"; then
  echo "✗ og:image rewrite did not apply — the tag in index.html must have changed" >&2
  exit 1
fi
echo "✓ mirror matches kamo (1 line diverges: og:image)"

# CNAME is the mirror's own and must survive. Losing it un-attaches the custom domain.
if [ ! -f "$MIRROR/CNAME" ] || [ "$(cat "$MIRROR/CNAME")" != "kamo.bliss-coach.com" ]; then
  echo "✗ CNAME missing or wrong in the mirror — refusing to push" >&2
  exit 1
fi
echo "✓ CNAME intact"

cd "$MIRROR"
if git diff --quiet && git diff --cached --quiet; then
  echo "✓ mirror already in sync — nothing to push"
  exit 0
fi

SUBJECT="${1:-Sync mirror with kamo@$(git -C "$KAMO" rev-parse --short HEAD)}"
git add -A
git commit -q -m "$SUBJECT"
git push -u origin HEAD
echo "✓ mirror pushed — Pages usually serves it within a couple of minutes"
