# AGENTS.md

Notes for coding agents (Claude Code, etc.) working on Meraki. See
[`DEVELOPMENT.md`](DEVELOPMENT.md) for the human dev loop and repo layout.

## Build & verify

- Content-script source lives in `src/` and is **bundled by esbuild** to
  `extension/content.js` — a generated file, never edit it directly. Run
  **`make build`** after editing anything under `src/`.
- The daemon lives in `daemon/`. Run **`make deploy`** (or
  `python3 -m daemon.install_host`) after editing it to redeploy to
  `~/.local/share/meraki/`. Firefox spawns a fresh daemon per message, so daemon
  changes need no browser reload — but they do need the redeploy.
- Before finishing a change, run: `make build`, `python3 -m tests.test_daemon`,
  and `ruff check daemon tests`. `node --check extension/content.js` catches
  bundle syntax errors.
- The extension must be reloaded in `about:debugging` to pick up manifest, asset,
  or bundle changes.

## Autonomous harness (`debug/run-debug.sh`)

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
cat ~/.config/meraki-annotator/daemon.log   # did the host launch + receive?
grep meraki debug/web-ext.log               # extension-side console
```

Note: Firefox's native messaging is JS-implemented, so `MOZ_LOG` does **not**
capture launch failures — the extension console (relayed to `web-ext.log`) and
`daemon.log` are the two sources that matter.
