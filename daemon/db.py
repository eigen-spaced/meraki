"""SQLite store for the web annotator.

Single source of truth. The daemon is the only thing that touches this file.
Every connection opens in WAL mode with a busy timeout so that near-simultaneous
daemon processes (Firefox spawns a fresh host per message via sendNativeMessage)
don't fail outright on "database is locked" -- they block briefly and retry.

This module is deliberately standalone: `python -m daemon.db /path/to.db`
creates the schema so it can be tested without the extension.
"""

from __future__ import annotations

import sqlite3
import uuid
from datetime import datetime, timezone

SCHEMA = """
CREATE TABLE IF NOT EXISTS documents (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    url           TEXT NOT NULL UNIQUE,   -- normalized (see config.normalize_url)
    raw_url       TEXT NOT NULL,          -- last-seen unnormalized URL, for reference
    title         TEXT,                   -- the page's own <title>, last seen
    custom_title  TEXT,                   -- user override for #+TITLE (nullable)
    subtitle      TEXT,                   -- user subtitle -> #+SUBTITLE (nullable)
    org_filename  TEXT,                   -- computed on first sync; never recomputed
    first_seen    TEXT NOT NULL,          -- ISO8601
    last_seen     TEXT NOT NULL,
    frozen_at     TEXT,                   -- ISO8601 archive time; NULL = live doc
    org_sha       TEXT                    -- sha256 of last written .org (dirty check)
);

CREATE TABLE IF NOT EXISTS annotations (
    id           TEXT PRIMARY KEY,        -- UUID, doubles as org :ANNOT_ID:
    document_id  INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    quote        TEXT NOT NULL,
    prefix       TEXT,
    suffix       TEXT,
    position     INTEGER,                 -- start offset in page text; orders export
    color        TEXT NOT NULL DEFAULT 'yellow',
    note         TEXT,
    kind         TEXT NOT NULL DEFAULT 'text',   -- 'text' | 'image'
    image_file   TEXT,                           -- filename under org_folder/images/
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL,
    synced_at    TEXT                     -- NULL = never reflected in org export
);

CREATE TABLE IF NOT EXISTS tags (
    id    INTEGER PRIMARY KEY AUTOINCREMENT,
    name  TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS annotation_tags (
    annotation_id TEXT NOT NULL REFERENCES annotations(id) ON DELETE CASCADE,
    tag_id        INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (annotation_id, tag_id)
);

CREATE TABLE IF NOT EXISTS document_tags (
    document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    tag_id      INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (document_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_annotations_document ON annotations(document_id);
CREATE INDEX IF NOT EXISTS idx_documents_url ON documents(url);
"""


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def connect(db_path: str) -> sqlite3.Connection:
    """Open a connection with the pragmas every caller needs."""
    conn = sqlite3.connect(db_path, timeout=5.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA busy_timeout=5000;")
    conn.execute("PRAGMA foreign_keys=ON;")
    return conn


# Bump when SCHEMA or _migrate changes. Stored in PRAGMA user_version so the
# daemon can skip the (write-locking) schema+migrate work on every message once a
# DB is current -- important because a fresh process runs per native message, so
# bursts of messages would otherwise all contend on the same schema writes.
SCHEMA_VERSION = 1


def init_db(db_path: str) -> None:
    """Create the schema if needed and migrate older DBs. Idempotent, and cheap
    on an already-current DB (one PRAGMA read, then return)."""
    conn = connect(db_path)
    try:
        (ver,) = conn.execute("PRAGMA user_version").fetchone()
        if ver == SCHEMA_VERSION:
            return   # already initialized + migrated; do no write-locking work
        conn.executescript(SCHEMA)
        _migrate(conn)
        conn.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
        conn.commit()
    finally:
        conn.close()


def _add_column(conn: sqlite3.Connection, table: str, name: str,
                coldef: str) -> None:
    """ALTER TABLE ADD COLUMN, but tolerant of a concurrent process having just
    added it. Fresh daemon processes can race on migration; the check alone is
    check-then-act, so also swallow the 'duplicate column' loser."""
    cols = {r["name"] for r in conn.execute(f"PRAGMA table_info({table})")}
    if name in cols:
        return
    try:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {coldef}")
    except sqlite3.OperationalError as e:
        if "duplicate column name" not in str(e).lower():
            raise


def _migrate(conn: sqlite3.Connection) -> None:
    """Add columns introduced after the first release. CREATE TABLE IF NOT
    EXISTS won't alter an existing table, so add missing columns explicitly."""
    _add_column(conn, "documents", "custom_title", "custom_title TEXT")
    _add_column(conn, "documents", "subtitle", "subtitle TEXT")
    _add_column(conn, "documents", "frozen_at", "frozen_at TEXT")
    _add_column(conn, "documents", "org_sha", "org_sha TEXT")
    _add_column(conn, "annotations", "position", "position INTEGER")
    _add_column(conn, "annotations", "kind",
                "kind TEXT NOT NULL DEFAULT 'text'")
    _add_column(conn, "annotations", "image_file", "image_file TEXT")


# --- document helpers -------------------------------------------------------


def set_document_meta(conn: sqlite3.Connection, doc_id: int,
                      custom_title: str | None, subtitle: str | None) -> None:
    """Set the user's custom title / subtitle. Empty strings are stored as NULL
    so the exporter's fallback to the page title kicks in."""
    conn.execute(
        "UPDATE documents SET custom_title = ?, subtitle = ? WHERE id = ?",
        (custom_title or None, subtitle or None, doc_id),
    )


def get_or_create_document(conn: sqlite3.Connection, norm_url: str,
                           raw_url: str, title: str | None) -> int:
    """Return documents.id for norm_url, inserting or touching last_seen."""
    row = conn.execute(
        "SELECT id FROM documents WHERE url = ?", (norm_url,)
    ).fetchone()
    ts = now_iso()
    if row is None:
        cur = conn.execute(
            "INSERT INTO documents (url, raw_url, title, first_seen, last_seen) "
            "VALUES (?, ?, ?, ?, ?)",
            (norm_url, raw_url, title, ts, ts),
        )
        return cur.lastrowid
    doc_id = row["id"]
    # Keep last_seen and the freshest title/raw_url current, but never touch url.
    conn.execute(
        "UPDATE documents SET last_seen = ?, raw_url = ?, "
        "title = COALESCE(?, title) WHERE id = ?",
        (ts, raw_url, title, doc_id),
    )
    return doc_id


def freeze_document(conn: sqlite3.Connection, doc_id: int) -> str:
    """Archive a document: stamp frozen_at and release its normalized URL so a
    fresh visit starts a brand-new document (blank slate). Returns frozen_at.

    The UNIQUE url is released by appending a per-doc sentinel; raw_url is kept
    intact for reference. The caller regenerates the .org one final time (with
    the frozen stamp) and the daemon never rewrites that file again -- see the
    frozen guard in daemon._sync. One-way: there is no un-freeze."""
    ts = now_iso()
    conn.execute(
        "UPDATE documents SET frozen_at = ?, url = url || ? WHERE id = ?",
        (ts, f"#meraki-frozen-{doc_id}", doc_id),
    )
    return ts


def clear_all(conn: sqlite3.Connection) -> int:
    """Wipe every row from the database (debug / reset escape hatch). Returns the
    number of documents removed. Deleting documents cascades to annotations and
    tag links via the foreign keys; tags are cleared separately. Generated .org
    files on disk are left untouched -- they're derived artifacts the user can
    remove on their own. One-way: there's no undo."""
    n = conn.execute("SELECT COUNT(*) AS c FROM documents").fetchone()["c"]
    conn.execute("DELETE FROM documents")   # cascades annotations + tag links
    conn.execute("DELETE FROM tags")
    return n


def delete_document(conn: sqlite3.Connection,
                    doc_id: int) -> tuple[str | None, list[str]]:
    """Delete a document and everything under it -- annotations, tag links, and
    doc tags cascade via the foreign keys (PRAGMA foreign_keys is ON). Returns
    (org_filename, image_files) so the caller can remove those from disk too.
    The explicit, intentional counterpart to deleting the .org by hand (which
    only regenerates, since SQLite is the source of truth)."""
    row = conn.execute(
        "SELECT org_filename FROM documents WHERE id = ?", (doc_id,)
    ).fetchone()
    if row is None:
        return (None, [])
    images = [
        r["image_file"] for r in conn.execute(
            "SELECT image_file FROM annotations "
            "WHERE document_id = ? AND image_file IS NOT NULL", (doc_id,)
        )
    ]
    conn.execute("DELETE FROM documents WHERE id = ?", (doc_id,))
    return (row["org_filename"], images)


# --- tag helpers ------------------------------------------------------------


def _tag_id(conn: sqlite3.Connection, name: str) -> int:
    name = name.strip()
    conn.execute("INSERT OR IGNORE INTO tags (name) VALUES (?)", (name,))
    return conn.execute(
        "SELECT id FROM tags WHERE name = ?", (name,)
    ).fetchone()["id"]


def set_annotation_tags(conn: sqlite3.Connection, annot_id: str,
                        tags: list[str]) -> None:
    conn.execute(
        "DELETE FROM annotation_tags WHERE annotation_id = ?", (annot_id,)
    )
    for name in tags:
        if name.strip():
            conn.execute(
                "INSERT OR IGNORE INTO annotation_tags (annotation_id, tag_id) "
                "VALUES (?, ?)",
                (annot_id, _tag_id(conn, name)),
            )


def set_document_tags(conn: sqlite3.Connection, doc_id: int,
                      tags: list[str]) -> None:
    conn.execute("DELETE FROM document_tags WHERE document_id = ?", (doc_id,))
    for name in tags:
        if name.strip():
            conn.execute(
                "INSERT OR IGNORE INTO document_tags (document_id, tag_id) "
                "VALUES (?, ?)",
                (doc_id, _tag_id(conn, name)),
            )


def get_annotation_tags(conn: sqlite3.Connection, annot_id: str) -> list[str]:
    rows = conn.execute(
        "SELECT t.name FROM tags t "
        "JOIN annotation_tags at ON at.tag_id = t.id "
        "WHERE at.annotation_id = ? ORDER BY t.name",
        (annot_id,),
    ).fetchall()
    return [r["name"] for r in rows]


def get_document_tags(conn: sqlite3.Connection, doc_id: int) -> list[str]:
    rows = conn.execute(
        "SELECT t.name FROM tags t "
        "JOIN document_tags dt ON dt.tag_id = t.id "
        "WHERE dt.document_id = ? ORDER BY t.name",
        (doc_id,),
    ).fetchall()
    return [r["name"] for r in rows]


# --- annotation CRUD --------------------------------------------------------


def create_annotation(conn: sqlite3.Connection, doc_id: int, quote: str,
                      prefix: str | None, suffix: str | None, color: str,
                      note: str | None, tags: list[str],
                      position: int | None = None) -> str:
    annot_id = str(uuid.uuid4())
    ts = now_iso()
    conn.execute(
        "INSERT INTO annotations "
        "(id, document_id, quote, prefix, suffix, position, color, note, "
        "created_at, updated_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (annot_id, doc_id, quote, prefix, suffix, position, color, note, ts, ts),
    )
    set_annotation_tags(conn, annot_id, tags)
    return annot_id


def create_image_annotation(conn: sqlite3.Connection, annot_id: str, doc_id: int,
                            src: str | None, note: str, tags: list[str],
                            position: int | None, image_file: str) -> None:
    """Insert an image annotation. The caller pre-generates annot_id + image_file
    (so the image file can be written to disk before the row exists) and requires
    a non-empty note. `src` (the page image URL) is stored in `quote` so the
    content script can re-find the <img> on reload; there's no color."""
    ts = now_iso()
    conn.execute(
        "INSERT INTO annotations "
        "(id, document_id, quote, prefix, suffix, position, color, note, "
        "kind, image_file, created_at, updated_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (annot_id, doc_id, src or "Image", None, None, position, "yellow",
         note, "image", image_file, ts, ts),
    )
    set_annotation_tags(conn, annot_id, tags)


def set_annotation_position(conn: sqlite3.Connection, annot_id: str,
                            doc_id: int, position: int) -> bool:
    """Update an annotation's page position. Returns True if it changed (so the
    caller knows whether the org export needs regenerating). Deliberately does
    NOT touch updated_at -- reordering isn't a user edit."""
    row = conn.execute(
        "SELECT position FROM annotations WHERE id = ? AND document_id = ?",
        (annot_id, doc_id),
    ).fetchone()
    if row is None or row["position"] == position:
        return False
    conn.execute(
        "UPDATE annotations SET position = ? WHERE id = ?", (position, annot_id)
    )
    return True


def update_annotation(conn: sqlite3.Connection, annot_id: str,
                      note: str | None, color: str | None,
                      tags: list[str] | None) -> None:
    sets, params = [], []
    if note is not None:
        sets.append("note = ?")
        params.append(note)
    if color is not None:
        sets.append("color = ?")
        params.append(color)
    sets.append("updated_at = ?")
    params.append(now_iso())
    params.append(annot_id)
    conn.execute(
        f"UPDATE annotations SET {', '.join(sets)} WHERE id = ?", params
    )
    if tags is not None:
        set_annotation_tags(conn, annot_id, tags)


def delete_annotation(conn: sqlite3.Connection, annot_id: str) -> int:
    """Hard delete. v1 uses full regeneration so no tombstone is needed (§6.4).
    Returns the affected document_id (or -1 if the annotation was gone)."""
    row = conn.execute(
        "SELECT document_id FROM annotations WHERE id = ?", (annot_id,)
    ).fetchone()
    if row is None:
        return -1
    conn.execute("DELETE FROM annotations WHERE id = ?", (annot_id,))
    return row["document_id"]


def get_annotations_for_document(conn: sqlite3.Connection,
                                 doc_id: int) -> list[dict]:
    # Order by page position (start offset) so the export matches the sidebar's
    # document order; annotations without a recorded position fall back to
    # creation order, after the positioned ones.
    rows = conn.execute(
        "SELECT * FROM annotations WHERE document_id = ? "
        "ORDER BY position IS NULL, position, created_at",
        (doc_id,),
    ).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        d["tags"] = get_annotation_tags(conn, r["id"])
        out.append(d)
    return out


if __name__ == "__main__":
    import sys

    if len(sys.argv) != 2:
        print("usage: python -m daemon.db /path/to/annotations.db",
              file=sys.stderr)
        sys.exit(1)
    init_db(sys.argv[1])
    print(f"initialized schema at {sys.argv[1]}")
