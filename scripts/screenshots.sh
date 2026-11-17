#!/usr/bin/env bash
# Regenerates docs/screenshots/*.jpg from demo mode (fictional titles, no API key needed).
# Needs Google Chrome (set CHROME to override the macOS default) and python3.
set -euo pipefail
cd "$(dirname "$0")/.."

CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
PORT="${PORT:-5199}"
OUT="docs/screenshots"
TMP="$(mktemp -d)"
mkdir -p "$OUT"

python3 -m http.server "$PORT" >/dev/null 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null; rm -rf "$TMP"' EXIT
sleep 1

# name | query string | width | height | extra chrome flags
shoot() {
  local name="$1" query="$2" w="${3:-1512}" h="${4:-900}" extra="${5:-}"
  # shellcheck disable=SC2086
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-prefers-reduced-motion $extra \
    --window-size="$w,$h" --virtual-time-budget=6000 --screenshot="$TMP/$name.png" \
    "http://localhost:$PORT/?demo&$query" >/dev/null 2>&1
  if command -v sips >/dev/null; then
    sips -s format jpeg -s formatOptions 84 "$TMP/$name.png" --out "$OUT/$name.jpg" >/dev/null
  else
    cp "$TMP/$name.png" "$OUT/$name.png"
  fi
  echo "  $OUT/$name"
}

echo "Capturing (1512x900 = a 14-inch MacBook's default scaled resolution)..."
shoot cinemas        "mode=cinema"
shoot streaming-soon "mode=soon&open=genre&genres=Action,Sci-Fi"
shoot release-filter "mode=cinema&open=when&certs=M,MA15%2B"
shoot calendar       "mode=cinema&view=calendar&cal=2026-12"
shoot streaming-now  "mode=now&services=netflix,stan&genres=Comedy"
shoot detail         "mode=soon&detail=2"
shoot light          "mode=now" 1512 900 "--blink-settings=preferredColorScheme=1"
shoot mobile         "mode=soon" 500 900
echo "Done."
