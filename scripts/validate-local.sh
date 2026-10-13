#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
PYTHON_BIN="${SACOCAST_PYTHON:-python3}"
if ! "$PYTHON_BIN" -c 'import playwright, PIL' >/dev/null 2>&1; then
  echo 'Browser checks require Playwright and Pillow. Install with: python3 -m pip install playwright pillow && python3 -m playwright install chromium' >&2
  exit 2
fi
"$PYTHON_BIN" -m unittest discover -s tests -v
node --test tests/*.mjs alerts/test/*.test.mjs
for file in js/*.js js/*.mjs alerts/src/*.mjs; do node --check "$file"; done
node --check push-sw.js
"$PYTHON_BIN" scripts/build_validation_artifact.py dist
"$PYTHON_BIN" scripts/verify_site_artifact.py dist
python3 -m http.server 8765 --directory dist >/tmp/sacocast-local-server.log 2>&1 & server_pid=$!
trap 'kill "$server_pid" 2>/dev/null || true' EXIT
for attempt in {1..30}; do
  if curl -fsS http://127.0.0.1:8765/index.html >/dev/null; then break; fi
  sleep 1
done
curl -fsS http://127.0.0.1:8765/index.html >/dev/null
"$PYTHON_BIN" tests/map_smoke.py
"$PYTHON_BIN" tests/tide_outlook_smoke.py
"$PYTHON_BIN" tests/eastcast_smoke.py
"$PYTHON_BIN" tests/push_ui_smoke.py
printf '%s\n' 'Local deterministic validation and Chromium desktop/mobile smoke tests passed.' 'This command does not deploy the Worker, apply D1 migrations, modify Cloudflare, or publish GitHub Pages.'
