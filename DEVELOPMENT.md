# Development

Build, layout, testing, and debugging. For install/usage see the
[README](README.md); for coding-agent notes see [`AGENTS.md`](AGENTS.md).

## Build & dev loop

The content script is authored in `src/` and **bundled by esbuild** to
`extension/content.js` (generated — don't edit it directly). `make build` bundles
once; `make dev` bundles then watches.

`make dev` runs the full loop: deploys the daemon, launches Firefox with the
extension **auto-reloading on save**, **re-bundles the content script** when you
edit `src/*.js`, and **auto-redeploys the daemon** when you edit `daemon/*.py`
(the host re-spawns per message, so no browser reload is needed). Pass a start
URL with `make dev URL=https://github.com`. Run `make` alone to list all targets.

## Layout

```
daemon/
  db.py            SQLite schema + CRUD (WAL + busy_timeout)
  config.py        config file + URL normalization
  org_export.py    SQLite -> .org full regeneration, atomic write
  daemon.py        native-messaging stdio entrypoint + dispatch
  install_host.py  deploys the daemon to ~/.local/share/meraki + registers the host
  migrate.py       one-shot legacy 'annotator' -> 'meraki-annotator' data migration
extension/
  manifest.json    MV3, strict_min_version 140.0
  background.js    service worker; relays messages via sendNativeMessage
  content.js       generated bundle (esbuild) — do not edit; source is src/
  popup.html/js    daemon status + Settings link; per-site enable toggle; clear-db
  options.html/js  db path / org folder + theme + annotation-notification settings
  mk-page.css      shared editorial tokens/components for the popup + options pages
  theme-page.js    applies the Manuscript/Ink theme to the extension pages
  fonts.css        @font-face for the pages (bundled Lora + JetBrains Mono)
  fonts/           bundled web fonts (Lora, JetBrains Mono; OFL)
  icons/           plugin icon set (Manuscript / Ink, PNG + SVG)
  vendor/          webextension-polyfill
src/                content-script source, bundled to extension/content.js by esbuild
  content.js       thin entry: wires page input events, calls lifecycle.init()
  bus.js           tiny pub/sub that decouples the modules below
  store.js         annotation state + doc tags; emits "annotations:changed"
  session.js       active / highlightsEnabled / reconciling flags
  site-rules.js    per-site on/off keying + blocklist (mirrored in popup.js)
  theme.js         resolves the Manuscript/Ink theme (auto|manuscript|ink)
  constants.js     colors + tuning; helpers.js  small string utils
  daemon.js        send() relay to background; styles.js  shadow-DOM CSS + icons
  text-index.js    page text indexing; anchoring.js  text-quote (re)anchoring
  highlights.js    CSS Custom Highlight API rendering + hit-test geometry
  selection.js     select→highlight, click→edit orchestration
  images.js        click→image/diagram note; rasterise + re-anchor
  lifecycle.js     activate/mute/teardown + per-site switch reactor
  ui/root.js       shadow host + themed wrapper + font-face injection
  ui/action-popup.js / comment-popup.js / image-popup.js / sidebar.js / toast.js
tests/
  test_daemon.py   end-to-end test over the real native-messaging wire format
Makefile           dev shortcuts: make dev / deploy / test / debug
dev.sh             one-command dev loop used by `make dev`
```

## Testing

```sh
# Backend end-to-end (no Firefox needed): frames JSON exactly as Firefox does,
# spawns the daemon, checks SQLite rows + generated .org files.
python3 -m tests.test_daemon

# Initialize a DB standalone:
python3 -m daemon.db /tmp/annotations.db
```

## Debugging

**Reset everything:** the toolbar popup has a **Danger zone → "Clear entire
database"** (two-step confirm) that wipes every annotation for every page from
SQLite — for debugging or recovering from a broken DB. It's **irreversible** and
leaves generated `.org` files on disk as-is (they're derived; delete the org
folder separately if you want a full reset). Reload open tabs afterward.

The daemon logs to `~/.config/meraki-annotator/daemon.log` (native messaging hosts
have no visible stdout/stderr). Check it first when a write seems to vanish —
if it stays empty after a browser action, Firefox never launched the host
(usually the TCC/deploy issue described in the README; re-run the installer).

For the autonomous extension↔daemon harness (`debug/run-debug.sh`), see
[`AGENTS.md`](AGENTS.md).
