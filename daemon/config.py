"""Config + URL normalization for the annotator daemon.

Config lives at ~/.config/meraki-annotator/config.json:
    { "db_path": "...", "org_folder": "...", "tracking_params": [...] }

URL normalization implements §2.5's aggressive-normalize decision so that
tracker-laden and clean URLs for the same page collapse to one documents row.
The tracking-param denylist is stored in config so it can be extended without
a code change.
"""

from __future__ import annotations

import json
import os
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

CONFIG_DIR = os.path.expanduser("~/.config/meraki-annotator")
CONFIG_PATH = os.path.join(CONFIG_DIR, "config.json")

# Default denylist. Extendable via config["tracking_params"].
DEFAULT_TRACKING_PARAMS = [
    "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
    "utm_id", "utm_reader", "utm_name", "utm_social", "utm_brand",
    "fbclid", "gclid", "gclsrc", "dclid", "msclkid", "yclid",
    "mc_cid", "mc_eid",
    "ref", "ref_src", "ref_url", "referrer",
    "igshid", "igsh",
    "si",          # YouTube / Spotify share param
    "spm", "scm",  # common on some large sites
    "_hsenc", "_hsmi", "hsCtaTracking",
    "vero_id", "vero_conv",
    "wickedid", "oly_anon_id", "oly_enc_id",
]

DEFAULTS = {
    "db_path": os.path.join(CONFIG_DIR, "annotations.db"),
    "org_folder": os.path.expanduser("~/org/meraki-annotations"),
    "tracking_params": DEFAULT_TRACKING_PARAMS,
}


def load_config() -> dict:
    """Read config, filling in any missing keys with defaults. Never raises
    for a missing file -- returns defaults so a fresh install just works."""
    cfg = dict(DEFAULTS)
    try:
        with open(CONFIG_PATH, encoding="utf-8") as f:
            cfg.update(json.load(f))
    except (FileNotFoundError, json.JSONDecodeError):
        pass
    # A user-supplied config may omit tracking_params; keep the defaults then.
    if not cfg.get("tracking_params"):
        cfg["tracking_params"] = DEFAULT_TRACKING_PARAMS
    return cfg


def save_config(cfg: dict) -> None:
    os.makedirs(CONFIG_DIR, exist_ok=True)
    tmp = CONFIG_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2)
    os.replace(tmp, CONFIG_PATH)


def normalize_url(raw_url: str, tracking_params: list[str] | None = None) -> str:
    """Apply §2.5 normalization rules. Best-effort; on any parse failure the
    raw url is returned so we never lose an annotation over a weird URL."""
    if tracking_params is None:
        tracking_params = DEFAULT_TRACKING_PARAMS
    deny = set(tracking_params)
    try:
        parts = urlsplit(raw_url)

        scheme = parts.scheme.lower()
        host = parts.hostname or ""
        host = host.lower()
        if host.startswith("www."):
            host = host[4:]

        # Reassemble netloc, preserving a non-default port but dropping any
        # userinfo (not meaningful as a dedup key).
        netloc = host
        if parts.port:
            netloc = f"{host}:{parts.port}"

        # Rule 3: drop known trackers. Rule 4: keep genuine params, drop the
        # '?' entirely if nothing survives.
        kept = [(k, v) for (k, v) in parse_qsl(parts.query, keep_blank_values=True)
                if k.lower() not in deny]
        query = urlencode(kept)

        # Rule 6: strip a single trailing slash except on root.
        path = parts.path
        if len(path) > 1 and path.endswith("/"):
            path = path[:-1]
        if path == "":
            path = "/"

        # Rule 5: strip fragment (fragment routing is an unhandled edge case).
        fragment = ""

        return urlunsplit((scheme, netloc, path, query, fragment))
    except Exception:
        return raw_url
