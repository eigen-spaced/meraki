#!/bin/sh
# One-command dev loop for Meraki. Run this and forget about the plumbing:
#
#   ./dev.sh                       # test page (auto-activates the annotator)
#   ./dev.sh https://github.com    # start on any real site
#
# It does, in one go, everything you used to do by hand:
#   1. deploys the daemon to ~/.local/share/meraki + writes the native-
#      messaging manifest  (was: python3 -m daemon.install_host)
#   2. launches Firefox with the extension loaded, and AUTO-RELOADS it on every
#      save to extension/  (was: manual reload in about:debugging)
#   3. watches daemon/ and AUTO-REDEPLOYS on save. The daemon spawns a fresh
#      process per native message, so a redeploy alone means the next message
#      runs new code -- no Firefox reload required for daemon edits.
#   4. serves debug/ over http so the auto-activating test page is available.
#
# A dedicated, persistent Firefox profile keeps logins/history across runs so
# you can test on real sites you're signed into. Ctrl-C stops everything.

set -u
# Resolve the repo root from this script's own location so it runs from anywhere.
ROOT=$(cd "$(dirname "$0")" && pwd)
cd "$ROOT" || exit 1

FIREFOX="${FIREFOX:-/Applications/Firefox.app/Contents/MacOS/firefox}"
WEB_EXT="./node_modules/.bin/web-ext"
PROFILE="$HOME/.local/share/meraki/dev-profile"
PORT=8777
START_URL="${1:-http://localhost:$PORT/test-page.html}"

# 1. Deploy daemon + native-messaging manifest.
echo "[dev] deploying daemon…"
python3 -m daemon.install_host || { echo "[dev] deploy failed"; exit 1; }

# 2. Serve debug/ (harmless if you navigate elsewhere).
python3 -m http.server "$PORT" --directory debug >/dev/null 2>&1 &
HTTP_PID=$!

# 3. Redeploy the daemon whenever a daemon/*.py file changes. No extra tools:
#    poll mtimes against a stamp file once a second.
STAMP="$(mktemp)"; touch "$STAMP"
(
  while sleep 1; do
    if [ -n "$(find daemon -name '*.py' -newer "$STAMP" 2>/dev/null)" ]; then
      touch "$STAMP"
      if python3 -m daemon.install_host >/dev/null 2>&1; then
        echo "[dev] daemon change → redeployed."
      else
        echo "[dev] daemon change → redeploy FAILED (check syntax)."
      fi
    fi
  done
) &
WATCH_PID=$!

# 3b. Bundle the content script (src/ -> extension/content.js) now, then rebuild
#     on every save to src/. web-ext reloads the add-on when the bundle changes.
ESBUILD="$ROOT/node_modules/.bin/esbuild"
ESBUILD_ARGS="src/content.js --bundle --format=iife --target=firefox140 --outfile=extension/content.js"
echo "[dev] bundling content script…"
# shellcheck disable=SC2086
$ESBUILD $ESBUILD_ARGS || { echo "[dev] content build failed"; exit 1; }
# shellcheck disable=SC2086
$ESBUILD $ESBUILD_ARGS --watch >/dev/null 2>&1 &
ESBUILD_PID=$!

trap 'kill $HTTP_PID $WATCH_PID $ESBUILD_PID 2>/dev/null; rm -f "$STAMP"' EXIT INT TERM

# 4. Run Firefox. Omitting --no-reload lets web-ext watch extension/ and reload
#    the add-on on every save. --keep-profile-changes + a fixed profile path
#    persist your logins between runs.
echo "[dev] launching Firefox — extension auto-reloads on save; Ctrl-C to quit."
exec "$WEB_EXT" run \
  --source-dir extension \
  --firefox "$FIREFOX" \
  --firefox-profile "$PROFILE" \
  --profile-create-if-missing \
  --keep-profile-changes \
  --start-url "$START_URL"
