"""One-shot data migration from the legacy 'annotator' names to the
'meraki-annotator' identifiers (v2 rename).

This moves:
  ~/.config/annotator/            -> ~/.config/meraki-annotator/
  ~/org/meraki-test/              -> ~/org/meraki-annotations/
and rewrites the absolute paths stored inside config.json to match.

It is idempotent -- safe to run any number of times, a no-op once done. It is
called from install_host (a single, non-concurrent process), NOT from the
daemon: the daemon spawns a fresh process per native message and several can run
at once, so filesystem moves there would race.
"""

from __future__ import annotations

import json
import os
import shutil

from . import config

LEGACY_CONFIG_DIR = os.path.expanduser("~/.config/annotator")
LEGACY_ORG_SUFFIX = "/org/meraki-test"
NEW_ORG_SUFFIX = "/org/meraki-annotations"


def ensure_migrated() -> list[str]:
    """Perform any pending migration. Returns a list of human-readable actions
    taken (empty if nothing needed doing)."""
    actions: list[str] = []

    # 1. Move the config directory (carries config.json + the .db + daemon.log).
    if os.path.isdir(LEGACY_CONFIG_DIR) and not os.path.exists(config.CONFIG_DIR):
        os.makedirs(os.path.dirname(config.CONFIG_DIR), exist_ok=True)
        shutil.move(LEGACY_CONFIG_DIR, config.CONFIG_DIR)
        actions.append(f"moved {LEGACY_CONFIG_DIR} -> {config.CONFIG_DIR}")

    # 2. Rewrite absolute paths inside config.json, moving the org folder too.
    if os.path.isfile(config.CONFIG_PATH):
        try:
            with open(config.CONFIG_PATH, encoding="utf-8") as f:
                cfg = json.load(f)
        except (OSError, json.JSONDecodeError):
            return actions
        changed = False

        db_path = cfg.get("db_path") or ""
        if "/.config/annotator/" in db_path:
            cfg["db_path"] = db_path.replace(
                "/.config/annotator/", "/.config/meraki-annotator/")
            changed = True

        org = (cfg.get("org_folder") or "").rstrip("/")
        if org.endswith(LEGACY_ORG_SUFFIX):
            new_org = org[: -len(LEGACY_ORG_SUFFIX)] + NEW_ORG_SUFFIX
            if os.path.isdir(org) and not os.path.exists(new_org):
                shutil.move(org, new_org)
                actions.append(f"moved {org} -> {new_org}")
            cfg["org_folder"] = new_org
            changed = True

        if changed:
            config.save_config(cfg)
            actions.append(f"rewrote paths in {config.CONFIG_PATH}")

    return actions


def main() -> None:
    actions = ensure_migrated()
    if actions:
        print("Migration applied:")
        for a in actions:
            print(f"  - {a}")
    else:
        print("Nothing to migrate (already on meraki-annotator paths).")


if __name__ == "__main__":
    main()
