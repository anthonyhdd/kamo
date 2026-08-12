#!/usr/bin/env bash
# Put playkamo.com/h/* in front of the challenge-preview function, via the Cloudflare API.
#
# WHY A SCRIPT AND NOT THE DASHBOARD. The dashboard path is six screens and one of them has a
# trap that costs an hour: a DNS record left unproxied (grey cloud) bypasses Workers entirely,
# so the route silently never fires and every check keeps returning GitHub's 404. This script
# asserts that state instead of trusting it.
#
# Your token never leaves this machine — everything here runs locally against api.cloudflare.com.
#
# ---------------------------------------------------------------------------------------------
# BEFORE YOU START
#
#   Cloudflare → My Profile → API Tokens → Create Token → Edit Cloudflare Workers template,
#   then add these permissions (the template misses the first two):
#       Account · Workers Scripts   · Edit
#       Zone    · Workers Routes    · Edit
#       Zone    · DNS               · Edit
#       Zone    · Zone              · Edit
#   Zone Resources: All zones.  Account ID is on any Cloudflare dashboard page, right column.
#
#   export CF_API_TOKEN=...
#   export CF_ACCOUNT_ID=...
#
# RUN IT TWICE.
#   Pass 1  creates the zone and prints the two nameservers to paste into Hover.
#   -- change the nameservers at Hover, wait for Cloudflare to mark the zone active --
#   Pass 2  proxies DNS, uploads the Worker, adds the route, and verifies end to end.
# Re-running is safe at any point: every step checks for what it is about to create.
# ---------------------------------------------------------------------------------------------
set -euo pipefail

DOMAIN="playkamo.com"
WORKER="kamo-link-preview"
ROUTE="playkamo.com/h/*"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKER_FILE="$SCRIPT_DIR/playkamo-worker.js"
API="https://api.cloudflare.com/client/v4"

: "${CF_API_TOKEN:?set CF_API_TOKEN}"
: "${CF_ACCOUNT_ID:?set CF_ACCOUNT_ID}"
[ -f "$WORKER_FILE" ] || { echo "missing $WORKER_FILE"; exit 1; }

cf() { curl -sS -H "Authorization: Bearer $CF_API_TOKEN" -H "Content-Type: application/json" "$@"; }
jqr() { python3 -c "import sys,json;d=json.load(sys.stdin);print(eval(sys.argv[1]))" "$1" 2>/dev/null || true; }
ok()  { python3 -c "import sys,json;print('1' if json.load(sys.stdin).get('success') else '')" 2>/dev/null || true; }

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

# ---- zone -----------------------------------------------------------------------------------
say "1/5  zone"
ZONE_JSON=$(cf "$API/zones?name=$DOMAIN")
ZONE_ID=$(echo "$ZONE_JSON" | jqr "d['result'][0]['id'] if d.get('result') else ''")

if [ -z "$ZONE_ID" ]; then
  CREATE=$(cf -X POST "$API/zones" \
    --data "{\"name\":\"$DOMAIN\",\"account\":{\"id\":\"$CF_ACCOUNT_ID\"},\"type\":\"full\"}")
  ZONE_ID=$(echo "$CREATE" | jqr "d['result']['id'] if d.get('success') else ''")
  [ -n "$ZONE_ID" ] || { echo "$CREATE"; exit 1; }
  echo "  created"
else
  echo "  exists"
fi

STATUS=$(cf "$API/zones/$ZONE_ID" | jqr "d['result']['status']")
echo "  status: $STATUS"

if [ "$STATUS" != "active" ]; then
  say "STOP — point Hover at these nameservers, then run this script again:"
  cf "$API/zones/$ZONE_ID" | python3 -c "import sys,json;[print('   ',n) for n in json.load(sys.stdin)['result']['name_servers']]"
  echo
  echo "  Hover → playkamo.com → DNS/Nameservers → replace both. Propagation is usually minutes."
  echo "  Watch for it with:  curl -sI https://$DOMAIN/ | grep -i '^server:'"
  echo "  You want 'cloudflare'. While it says GitHub.com, the Worker can never run."
  exit 0
fi

# ---- dns ------------------------------------------------------------------------------------
# THE TRAP. A grey-cloud record serves GitHub Pages directly and never reaches the Worker.
say "2/5  dns must be proxied"
# The records go through a FILE, not a pipe. `python3 -` already reads its program from
# stdin, so a heredoc and a pipe on the same command fight over it: the heredoc wins, the
# piped JSON never arrives, and json.load hits EOF with "Expecting value: line 1 column 1".
cf "$API/zones/$ZONE_ID/dns_records?per_page=100" > /tmp/kamo_recs.json
python3 - <<'PY' > /tmp/kamo_unproxied.txt
import json
d = json.load(open("/tmp/kamo_recs.json"))
for r in d.get("result", []):
    if r["type"] in ("A", "AAAA", "CNAME") and r["name"] in ("playkamo.com",) and not r["proxied"]:
        print(r["id"], r["type"], r["name"], sep="\t")
PY
if [ -s /tmp/kamo_unproxied.txt ]; then
  while IFS=$'\t' read -r rid rtype rname; do
    cf -X PATCH "$API/zones/$ZONE_ID/dns_records/$rid" --data '{"proxied":true}' >/dev/null
    echo "  proxied $rtype $rname"
  done < /tmp/kamo_unproxied.txt
else
  echo "  already proxied"
fi
rm -f /tmp/kamo_unproxied.txt /tmp/kamo_recs.json

# ---- worker ---------------------------------------------------------------------------------
say "3/5  worker"
UP=$(curl -sS -X PUT "$API/accounts/$CF_ACCOUNT_ID/workers/scripts/$WORKER" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -F 'metadata={"main_module":"worker.js","compatibility_date":"2024-11-01"};type=application/json' \
  -F "worker.js=@$WORKER_FILE;filename=worker.js;type=application/javascript+module")
# `filename=` is load-bearing. Cloudflare resolves main_module against the FILENAME of the
# multipart part, not its field name, and curl defaults the filename to the file on disk —
# so the module arrived as "playkamo-worker.js" and main_module pointed at nothing:
# "Uncaught Error: No such module: worker.js".
[ -n "$(echo "$UP" | ok)" ] && echo "  uploaded" || { echo "$UP"; exit 1; }

# ---- route ----------------------------------------------------------------------------------
say "4/5  route"
HAVE=$(cf "$API/zones/$ZONE_ID/workers/routes" | jqr "'yes' if any(r.get('pattern')=='$ROUTE' for r in d.get('result',[])) else ''")
if [ -z "$HAVE" ]; then
  R=$(cf -X POST "$API/zones/$ZONE_ID/workers/routes" --data "{\"pattern\":\"$ROUTE\",\"script\":\"$WORKER\"}")
  [ -n "$(echo "$R" | ok)" ] && echo "  added $ROUTE" || { echo "$R"; exit 1; }
else
  echo "  exists"
fi

# ---- verify ---------------------------------------------------------------------------------
say "5/5  verify"
sleep 3
OUT=$(curl -s "https://$DOMAIN/h/71ff2f271f5b4fea" | grep -Eo 'og:(title|image)" content="[^"]*"' || true)
if [ -n "$OUT" ]; then
  echo "$OUT" | sed 's/^/  /'
  say "DONE — flip SHARE_HOST in index.html to https://playkamo.com/h"
else
  echo "  no og: tags yet. The landing page still resolving? Give DNS a minute and re-run."
  echo "  Check:  curl -sI https://$DOMAIN/ | grep -i '^server:'   → want 'cloudflare'"
fi
