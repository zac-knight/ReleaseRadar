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

python3 scripts/serve.py "$PORT" >/dev/null 2>&1 &
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

echo "Capturing (1512x982 = a 14-inch MacBook's default scaled resolution)..."
shoot story-what     "guide=1"
shoot story-genre    "mode=soon&step=genre&genres=Action,Adventure"
shoot story-where    "mode=soon&step=where&services=netflix,stan"
shoot cinemas        "mode=cinema&genres=Action,Adventure"
shoot edit-phrase    "mode=soon&genres=Sci-Fi,Fantasy&when=3m&edit=genre"
shoot refine         "mode=cinema&refine=1&open=when&certs=M,MA15%2B"
shoot calendar       "mode=cinema&view=calendar&cal=2026-12"
shoot streaming-now  "mode=now&services=netflix,stan&genres=Comedy"
shoot detail         "mode=soon&detail=2"
shoot insights       "mode=cinema&view=insights&noml" 1512 1500
shoot ai-lab         "mode=cinema&lab=1" 1512 1000
shoot movie-night    "mode=cinema&night=run&noml" 1512 1100
shoot season-christmas "mode=cinema&season=christmas"
shoot season-halloween "mode=cinema&season=halloween"
shoot season-easter    "mode=cinema&season=easter"
shoot light          "mode=now" 1512 900 "--blink-settings=preferredColorScheme=1"
shoot mobile         "mode=soon&genres=Action" 500 900
echo "Done."
