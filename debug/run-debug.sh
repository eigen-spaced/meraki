#!/bin/sh
# Autonomous debug harness for the native-messaging handshake.
#
# Launches Firefox via web-ext with the extension auto-loaded and Firefox's
# internal nativeMessaging logging enabled. The content script pings the daemon
# on page load, so simply opening the test page triggers the full path:
#   content.js -> background.js -> sendNativeMessage -> launcher.sh -> daemon.py
#
# All three log sources land in debug/ for inspection:
#   - moz-native.log*      Firefox's internal reason for a launch failure
#   - daemon.log           proof the daemon actually executed (or not)
#   - web-ext.log          the extension's own console output (relayed by web-ext)
#
# Runs until killed. Intended to be launched in the background.

set -u
# Resolve the repo root from this script's location (debug/ -> repo root).
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT" || exit 1

PORT=8777
FIREFOX="${FIREFOX:-/Applications/Firefox.app/Contents/MacOS/firefox}"

# Fresh logs each run.
rm -f "$HOME/.config/meraki-annotator/daemon.log"
rm -f debug/web-ext.log

# Serve the test page over http (file:// doesn't match <all_urls> cleanly).
python3 -m http.server "$PORT" --directory debug >/dev/null 2>&1 &
HTTP_PID=$!
trap 'kill $HTTP_PID 2>/dev/null' EXIT

# Native messaging is JS-implemented, so MOZ_LOG can't see it. The real
# launch-failure reason goes to the Browser Console. These prefs redirect BOTH
# privileged (chrome: background/platform) and content console output to
# Firefox's stdout, which web-ext relays into debug/web-ext.log -- giving us
# the extension's [meraki] logs AND Firefox's own "failed to launch" line.
exec ./node_modules/.bin/web-ext run \
  --source-dir extension \
  --firefox "$FIREFOX" \
  --start-url "http://localhost:$PORT/test-page.html" \
  --no-reload \
  --verbose \
  --pref devtools.console.stdout.chrome=true \
  --pref devtools.console.stdout.content=true \
  --pref browser.dom.window.dump.enabled=true \
  > debug/web-ext.log 2>&1
