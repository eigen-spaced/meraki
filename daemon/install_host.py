"""Register the daemon as a Firefox native messaging host (§5, step 3).

IMPORTANT (macOS): Firefox cannot execute or read a native messaging host that
lives under a TCC-protected folder (~/Documents, ~/Desktop, ~/Downloads). It can
read the host manifest (which lives in ~/Library) but the launch of the host --
and the Python subprocess's reads of the daemon package -- are silently denied,
surfacing only as "An unexpected error occurred" in the extension. So we DEPLOY
a copy of the daemon package to a non-protected location and register that.

Writes:
  1. A deployed copy of the daemon/ package under ~/.local/share/meraki/.
  2. A launcher shell script there, with the absolute interpreter path baked in
     (Firefox spawns hosts with a stripped PATH, so a bare `python3` fails).
  3. The native messaging host manifest JSON in Firefox's per-user hosts dir,
     pointing at the deployed launcher and allowing our extension id.

Re-run this after changing daemon code to redeploy. Run: python -m daemon.install_host
"""

from __future__ import annotations

import json
import os
import shutil
import stat
import sys

from . import migrate

# Native messaging host names must match \w+(\.\w+)* -- no hyphens allowed -- so
# this keeps the hyphen-free 'merakiannotator' form even though other identifiers
# use 'meraki-annotator'.
HOST_NAME = "org.merakiannotator.daemon"      # must match background.js HOST_NAME
EXTENSION_ID = "meraki-annotator@meraki.local"  # must match manifest.json gecko.id

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE_DAEMON = os.path.join(REPO_ROOT, "daemon")

# Deploy target: a plain, non-TCC-protected per-user data dir.
INSTALL_DIR = os.path.expanduser("~/.local/share/meraki")
DEPLOYED_LAUNCHER = os.path.join(INSTALL_DIR, "launcher.sh")


def _hosts_dir() -> str:
    """Per-user Firefox native messaging hosts directory, per-platform."""
    if sys.platform == "darwin":
        return os.path.expanduser(
            "~/Library/Application Support/Mozilla/NativeMessagingHosts")
    if sys.platform.startswith("linux"):
        return os.path.expanduser("~/.mozilla/native-messaging-hosts")
    if sys.platform.startswith("win"):
        # On Windows the path is registry-based; print guidance instead.
        raise SystemExit(
            "Windows registers native messaging hosts via the registry. "
            "See the Firefox docs; this installer supports macOS/Linux.")
    raise SystemExit(f"unsupported platform: {sys.platform}")


def _deploy_daemon() -> None:
    """Copy the daemon package to INSTALL_DIR, excluding caches."""
    os.makedirs(INSTALL_DIR, exist_ok=True)
    dest = os.path.join(INSTALL_DIR, "daemon")
    if os.path.exists(dest):
        shutil.rmtree(dest)
    shutil.copytree(
        SITE_DAEMON, dest,
        ignore=shutil.ignore_patterns("__pycache__", "*.pyc", "launcher.sh"))


def _write_launcher() -> None:
    # Absolute interpreter path (stripped-PATH safe) + cd into the deployed dir.
    python = sys.executable
    script = (
        "#!/bin/sh\n"
        f'cd "{INSTALL_DIR}" || exit 1\n'
        f'exec "{python}" -m daemon.daemon\n'
    )
    with open(DEPLOYED_LAUNCHER, "w", encoding="utf-8") as f:
        f.write(script)
    mode = os.stat(DEPLOYED_LAUNCHER).st_mode
    os.chmod(DEPLOYED_LAUNCHER, mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)


def _write_manifest() -> str:
    hosts_dir = _hosts_dir()
    os.makedirs(hosts_dir, exist_ok=True)
    manifest = {
        "name": HOST_NAME,
        "description": "Meraki web annotator daemon",
        "path": DEPLOYED_LAUNCHER,
        "type": "stdio",
        "allowed_extensions": [EXTENSION_ID],
    }
    manifest_path = os.path.join(hosts_dir, f"{HOST_NAME}.json")
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)
    return manifest_path


def main() -> None:
    for action in migrate.ensure_migrated():
        print(f"[migrate] {action}")
    _deploy_daemon()
    _write_launcher()
    manifest_path = _write_manifest()
    print("Installed native messaging host:")
    print(f"  host name : {HOST_NAME}")
    print(f"  deployed  : {INSTALL_DIR}/daemon  (copied from {SITE_DAEMON})")
    print(f"  launcher  : {DEPLOYED_LAUNCHER}")
    print(f"  manifest  : {manifest_path}")
    print(f"  extension : {EXTENSION_ID}")
    if os.path.commonpath([REPO_ROOT, os.path.expanduser("~/Documents")]) == \
            os.path.expanduser("~/Documents"):
        print("\nNote: your source lives under ~/Documents, which Firefox cannot")
        print("execute from (macOS TCC). That's why the daemon is deployed to")
        print(f"{INSTALL_DIR} instead. Re-run this installer after code changes.")
    print("\nLoad the extension in Firefox via about:debugging "
          "(Load Temporary Add-on -> extension/manifest.json).")


if __name__ == "__main__":
    main()
