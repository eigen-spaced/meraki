"""SQLite -> .org regeneration (§3, §4).

v1 strategy: full regeneration per dirty document, atomic write. An edit to
one page only rewrites that page's file, so git diffs stay scoped. Each .org
file is generated output -- not meant to be hand-edited (it gets overwritten).
"""

from __future__ import annotations

import hashlib
import os
import re
import shutil
import sqlite3
from datetime import datetime

from . import config, db


def _slug(title: str | None) -> str:
    """Lowercase, hyphenate, strip to a filesystem-safe stub (~50 chars)."""
    base = (title or "untitled").lower()
    base = re.sub(r"[^\w\s-]", "", base)      # drop punctuation
    base = re.sub(r"[\s_]+", "-", base).strip("-")
    base = re.sub(r"-{2,}", "-", base)
    if not base:
        base = "untitled"
    return base[:50].strip("-") or "untitled"


def org_filename_for(doc: sqlite3.Row) -> str:
    """{slug}-{short_id}.org. short_id makes it unique even for dup titles.
    Computed once and stored; callers persist the return value."""
    short_id = f"{doc['id']:06x}"[-6:]
    return f"{_slug(doc['title'])}-{short_id}.org"


def _org_ts(iso: str | None) -> str:
    """ISO8601 -> org inactive timestamp [2026-07-02 Thu]."""
    if not iso:
        return ""
    try:
        dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
        return dt.strftime("[%Y-%m-%d %a]")
    except ValueError:
        return ""


def _filetags(tags: list[str]) -> str:
    if not tags:
        return ""
    return ":" + ":".join(tags) + ":"


def _heading(note: str | None, quote: str, maxlen: int = 120) -> str:
    """A short, single-line heading: the note if there is one, else the quote.
    Truncated so the outline stays scannable no matter how long the highlight
    is -- the full quote lives in the BEGIN_QUOTE block and the full note in the
    body below, so truncation here never loses data."""
    src = (note or quote or "").strip()
    src = " ".join(src.split())          # collapse newlines/runs of whitespace
    if len(src) > maxlen:
        src = src[:maxlen - 1].rstrip() + "…"
    return src or "Highlight"


def _escape_quote_body(text: str) -> str:
    """Keep #+END_QUOTE lines in the body from prematurely closing the block.
    Rare, but a highlighted passage could literally contain that text."""
    lines = []
    for line in text.splitlines() or [text]:
        if line.strip().lower().startswith("#+end"):
            line = "," + line   # org's literal-line comma escape
        lines.append(line)
    return "\n".join(lines)


def render_document(conn: sqlite3.Connection, doc_id: int) -> str:
    doc = conn.execute(
        "SELECT * FROM documents WHERE id = ?", (doc_id,)
    ).fetchone()
    if doc is None:
        raise ValueError(f"no document {doc_id}")

    doc_tags = db.get_document_tags(conn, doc_id)
    annots = db.get_annotations_for_document(conn, doc_id)

    out = []
    out.append(f"#+TITLE: {doc['custom_title'] or doc['title'] or doc['raw_url']}")
    if doc["subtitle"]:
        out.append(f"#+SUBTITLE: {doc['subtitle']}")
    if doc_tags:
        out.append(f"#+FILETAGS: {_filetags(doc_tags)}")
    out.append(f"#+PROPERTY: URL {doc['raw_url']}")
    first_seen = _org_ts(doc["first_seen"])
    if first_seen:
        out.append(f"#+PROPERTY: FIRST_SEEN {first_seen}")
    # Frozen files carry a provenance stamp; once frozen the daemon never
    # regenerates the file, so this is the archive's permanent marker.
    if doc["frozen_at"]:
        frozen = _org_ts(doc["frozen_at"])
        if frozen:
            out.append(f"#+PROPERTY: FROZEN {frozen}")
    out.append("")

    for a in annots:
        is_image = a["kind"] == "image"
        out.append(f"* {_heading(a['note'], a['quote'])}")
        out.append("  :PROPERTIES:")
        out.append(f"  :ANNOT_ID: {a['id']}")
        # Image annotations carry :KIND: instead of :COLOR:; text output is left
        # byte-identical to before so existing .org files don't churn.
        if is_image:
            out.append("  :KIND: image")
        else:
            out.append(f"  :COLOR: {a['color']}")
        if a["tags"]:
            out.append(f"  :TAGS: {' '.join(a['tags'])}")
        out.append("  :END:")
        if is_image:
            out.append(f"  [[file:images/{a['image_file']}]]")
        else:
            out.append("  #+BEGIN_QUOTE")
            for line in _escape_quote_body(a["quote"]).splitlines() or [""]:
                out.append(f"  {line}")
            out.append("  #+END_QUOTE")
        if a["note"]:
            out.append("")
            for line in a["note"].splitlines():
                out.append(f"  {line}")
        out.append("")

    return "\n".join(out).rstrip() + "\n"


def _atomic_write(path: str, content: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(content)
    os.replace(tmp, path)   # atomic on POSIX; no truncated-file corruption


def _sha_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _sha_file(path: str) -> str:
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def _backup_dirty_file(path: str, filename: str) -> str:
    """Copy a hand-edited generated file aside before we overwrite it, so manual
    edits to a not-yet-frozen file are never silently lost. Backups live outside
    the (often git-tracked) org folder so they don't pollute it."""
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup_dir = os.path.join(config.CONFIG_DIR, "backups")
    os.makedirs(backup_dir, exist_ok=True)
    dest = os.path.join(backup_dir, f"{filename}.{stamp}.bak")
    shutil.copy2(path, dest)
    return dest


def is_dirty(conn: sqlite3.Connection, doc_id: int, org_folder: str) -> bool:
    """True if the on-disk .org has diverged from what the daemon last wrote --
    i.e. it was hand-edited. Frozen docs are hand-owned, so never 'dirty'; docs
    with no baseline sha (never synced / pre-upgrade) can't be judged."""
    row = conn.execute(
        "SELECT org_filename, org_sha, frozen_at FROM documents WHERE id = ?",
        (doc_id,),
    ).fetchone()
    if row is None or row["frozen_at"] or not row["org_filename"] \
            or not row["org_sha"]:
        return False
    path = os.path.join(org_folder, row["org_filename"])
    if not os.path.exists(path):
        return False
    try:
        return _sha_file(path) != row["org_sha"]
    except OSError:
        return False


def file_missing(conn: sqlite3.Connection, doc_id: int, org_folder: str) -> bool:
    """True if a document we've written before has had its .org deleted on disk.
    The DB stays the source of truth (the file regenerates on the next write),
    but this lets the UI surface the divergence instead of silently snapping the
    file back. Frozen docs are excluded (their URL is released; not revisited)."""
    row = conn.execute(
        "SELECT org_filename, frozen_at FROM documents WHERE id = ?", (doc_id,)
    ).fetchone()
    if row is None or row["frozen_at"] or not row["org_filename"]:
        return False
    return not os.path.exists(os.path.join(org_folder, row["org_filename"]))


def sync_document(conn: sqlite3.Connection, doc_id: int,
                  org_folder: str, log=None) -> str:
    """Regenerate one document's .org file and mark its annotations synced.
    Returns the absolute path written. Before overwriting, if the file on disk
    has been hand-edited since we last wrote it (dirty), back it up first so no
    manual edit to a not-yet-frozen file is ever silently lost."""
    doc = conn.execute(
        "SELECT * FROM documents WHERE id = ?", (doc_id,)
    ).fetchone()
    if doc is None:
        raise ValueError(f"no document {doc_id}")

    filename = doc["org_filename"]
    if not filename:
        filename = org_filename_for(doc)
        conn.execute(
            "UPDATE documents SET org_filename = ? WHERE id = ?",
            (filename, doc_id),
        )

    path = os.path.join(org_folder, filename)
    content = render_document(conn, doc_id)
    new_sha = _sha_text(content)

    # Dirty check: only meaningful when we have a baseline sha and the file is
    # actually present. Skip the backup when the on-disk file already matches
    # what we're about to write (nothing to lose).
    prev_sha = doc["org_sha"]
    if prev_sha and os.path.exists(path):
        try:
            current_sha = _sha_file(path)
        except OSError:
            current_sha = prev_sha
        if current_sha != prev_sha and current_sha != new_sha:
            try:
                dest = _backup_dirty_file(path, filename)
                if log:
                    log(f"dirty .org backed up before overwrite: {dest}")
            except OSError as e:
                if log:
                    log(f"could not back up dirty .org {path}: {e}")

    _atomic_write(path, content)
    conn.execute(
        "UPDATE documents SET org_sha = ? WHERE id = ?", (new_sha, doc_id)
    )
    conn.execute(
        "UPDATE annotations SET synced_at = ? WHERE document_id = ?",
        (db.now_iso(), doc_id),
    )
    return path
