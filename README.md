# Meraki Annotator

A Firefox extension that overlays highlight/annotate on any web page, backed by
a local SQLite database, exported to human-readable, git-diffable `.org` files.

v1 (overlay highlight/annotate + SQLite + org export) is built. See
[`v2-plan.md`](v2-plan.md) for what's next.

## Architecture

```
Firefox extension  ──native messaging (stdio JSON)──►  Python daemon  ──►  SQLite  ──sync──►  .org files
```

- **Extension** captures selections and renders highlights via the CSS Custom
  Highlight API (no DOM mutation). It has no filesystem/DB access.
- **Daemon** is the only thing that touches disk. Firefox spawns a fresh daemon
  process per message (`sendNativeMessage`), so it holds no in-memory state and
  syncs the affected `.org` file immediately after every write.
- **SQLite** is the source of truth; **`.org` files** are the readable artifact
  (one file per document).

### Annotation ordering

Headings in a `.org` file are ordered by where each highlight sits **on the
page** (document order), matching the sidebar — not by creation time. The daemon
has no DOM, so the content script supplies the order: it records each
annotation's start offset in the page text as a `position`, sent when a highlight
is created and re-recorded on every load (which also back-fills highlights made
before this existed). The export sorts by `position`, falling back to creation
order for any annotation without one; orphaned annotations (can't be re-located)
keep their last position and sort last.

The daemon only regenerates a file when a position actually changes, so ordinary
re-visits don't churn git history. This is tuned for **stable reading pages**;
on highly dynamic pages the offset can drift, but the tradeoff is deliberate —
re-anchoring (text-quote + prefix/suffix) is where robustness lives, and
ordering is a cheap layer on top of it.

## Requirements

- Firefox **140+** (the CSS Custom Highlight API and its `strict_min_version`).
- Python **3.10+** (standard library only — no third-party packages).

## Install

From the project root (`meraki/`):

```sh
# 1. Install JS deps + bundle the content script (src/ -> extension/content.js).
npm install
make build

# 2. Deploy + register the native messaging host with Firefox. This copies the
#    daemon package to ~/.local/share/meraki/ and writes the host manifest into
#    Firefox's per-user NativeMessagingHosts dir pointing there.
python3 -m daemon.install_host   # or: make deploy

# 3. Load the extension:
#    Firefox -> about:debugging#/runtime/this-firefox
#    -> "Load Temporary Add-on…" -> pick extension/manifest.json
```

**Why it deploys a copy (macOS):** Firefox cannot execute a native messaging
host that lives under a TCC-protected folder (`~/Documents`, `~/Desktop`,
`~/Downloads`) — the launch is silently denied and the extension only sees "An
unexpected error occurred". Since this repo lives under `~/Documents`, the
installer deploys the daemon to `~/.local/share/meraki/` and registers that.
**Re-run `python3 -m daemon.install_host` after any daemon code change** to
redeploy. (The extension half runs inside Firefox, so it loads fine from the
repo.)

The extension id (`meraki-annotator@meraki.local`) and host name
(`org.merakiannotator.daemon`) must match between `extension/manifest.json`,
`extension/background.js`, and `daemon/install_host.py`. They do by default;
only change them together. (The host name stays hyphen-free because Firefox
native-messaging names must match `\w+(\.\w+)*`.)

On first run the daemon uses defaults (`~/.config/meraki-annotator/annotations.db`
and `~/org/meraki-annotations/`). Change the DB path or org folder from the
extension's **Settings** page (popup → Settings…), which sends the typed path to
the daemon to validate.

## Development

The content script is authored in `src/` and **bundled by esbuild** to
`extension/content.js` (generated — don't edit it directly). `make build` bundles
once; `make dev` bundles then watches.

`make dev` runs the full loop: deploys the daemon, launches Firefox with the
extension **auto-reloading on save**, **re-bundles the content script** when you
edit `src/*.js`, and **auto-redeploys the daemon** when you edit `daemon/*.py`
(the host re-spawns per message, so no browser reload is needed). Pass a start
URL with `make dev URL=https://github.com`. Run `make` alone to list all targets.

There are two independent switches:

- **Master enable/disable** (toolbar popup) — a single global setting, off by
  default. Persists across refresh, tab close/open, and browser restart, and
  applies to every page; toggling it updates all open tabs live. While off, a
  page is untouched — except a small timed toast nudges you if the page has
  saved annotations (toggle that off under Settings).
- **Annotation mute** (sidebar switch) — hides highlights and suppresses the
  selection popup while keeping the sidebar open. Only present when enabled.

Once enabled:

- **Highlight:** select text → pick a color from the floating popup.
- **Highlight + note:** select text → "+ note" → write a note, add comma-tags.
- **Annotate an image:** click an `<img>` → write a required note (+ tags). The
  image file is copied into the org folder's `images/` and linked from the
  export; the sidebar shows a thumbnail.
- **Edit/delete:** click an existing highlight → the comment popup opens.
- **Sidebar:** click the ✍ tab on the right edge. Lists all annotations for the
  page in document order (click one to scroll to it and flash), and has a
  page-level tag input at the top that becomes `#+FILETAGS:` in the export.
- **Freeze / archive:** the sidebar footer's "🧊 Freeze" button (two-step
  confirm) graduates the page's `.org` into a permanent archive the daemon never
  rewrites again — stamped `#+PROPERTY: FROZEN`. It's **one-way**: revisiting the
  page later starts a fresh, empty annotation set into a new `.org`, leaving the
  frozen file untouched. Repeated freezes build a version history of a page.
- **Delete page:** the footer's "🗑 Delete page" button (two-step confirm)
  permanently removes the page's annotations from SQLite along with its `.org`
  file and any saved images. This is the intentional "throw it away" action —
  **SQLite is the source of truth, so deleting the `.org` file by hand does *not*
  delete the annotations** (they stay in the DB).
- **Missing `.org` (deleted on disk):** if you delete a page's generated `.org`
  file by hand, the next time you open that page Meraki puts up a **blocking modal
  over the sidebar** and **locks new annotations** until you choose: **Restore the
  `.org`** (regenerate it from the DB) or **Delete the annotations** (remove them
  for good). No silent snap-back, no easy-to-miss toast.

Each `.org` file is **generated output** — hand-edits are overwritten on the
next sync — *until you freeze it* (above), after which it's yours to own and edit
in Emacs. If you do hand-edit a still-managed file, nothing is lost silently: the
sidebar warns you the file has manual edits, and the daemon **backs up the
edited version** to `~/.config/meraki-annotator/backups/` before overwriting.
(That backup is a safety net, not a merge — freeze the page if you mean to keep
editing it.) Put `~/org/meraki-annotations/` (and the `.db`) inside a git repo /
Dropbox / Syncthing folder if you want history or sync.

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
  popup.html/js    daemon status + link to Settings; global enable/disable toggle
  options.html/js  db path / org folder + annotation-notification setting
  vendor/          webextension-polyfill
src/                content-script source, bundled to extension/content.js by esbuild
  content.js       thin entry: wires page input events, calls lifecycle.init()
  bus.js           tiny pub/sub that decouples the modules below
  store.js         annotation state + doc tags; emits "annotations:changed"
  session.js       active / highlightsEnabled flags
  constants.js     colors + tuning; helpers.js  small string utils
  daemon.js        send() relay to background; styles.js  shadow-DOM CSS
  text-index.js    page text indexing; anchoring.js  text-quote (re)anchoring
  highlights.js    CSS Custom Highlight API rendering + hit-test geometry
  selection.js     select→highlight, click→edit orchestration
  images.js        click→image note; background fetch + re-anchor by src
  lifecycle.js     activate/mute/teardown + global master-switch reactor
  ui/root.js       shadow host; action-popup.js / comment-popup.js / sidebar.js
  ui/image-popup.js  image note create/edit popup
  ui/toast.js      off-state "page has annotations" nudge (no shadow DOM)
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

The daemon logs to `~/.config/meraki-annotator/daemon.log` (native messaging hosts
have no visible stdout/stderr). Check it first when a write seems to vanish —
if it stays empty after a browser action, Firefox never launched the host
(usually the TCC/deploy issue above; re-run the installer).

### Autonomous harness (`debug/run-debug.sh`)

Reproduces the full extension↔daemon path without manual clicking. It:

- starts a local http server for `debug/test-page.html`,
- launches Firefox via `web-ext` with the extension auto-loaded (`--verbose`
  plus `devtools.console.stdout.*` prefs so the extension's console output is
  relayed to `debug/web-ext.log`),
- the content script pings the daemon on page load, exercising
  `content.js → background.js → sendNativeMessage → launcher → daemon.py`.

```sh
npm install --no-save web-ext   # one-time
sh debug/run-debug.sh           # runs until killed; open a GUI Firefox window
# then, in another shell:
cat ~/.config/meraki-annotator/daemon.log          # did the host launch + receive?
grep meraki debug/web-ext.log               # extension-side console
```

Note: Firefox's native messaging is JS-implemented, so `MOZ_LOG` does **not**
capture launch failures — the extension console (relayed to `web-ext.log`) and
`daemon.log` are the two sources that matter.

## Known limitations (v1)

- Firefox-only; no reader mode, eww, git automation, or multi-vault switching
  (all deferred — see the plan's §4).
- Concurrent writes from two machines on a synced folder can conflict.
- Highlights that can't be re-anchored after a page changes are shown as
  "orphaned" in the sidebar rather than dropped.
