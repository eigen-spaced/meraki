"""Native messaging host entrypoint (§2.2).

Reads length-prefixed JSON from stdin (Firefox's native messaging wire format:
a 4-byte little-endian uint32 length, then that many bytes of UTF-8 JSON),
dispatches, writes a framed JSON response to stdout.

Process lifecycle: with sendNativeMessage() the browser spawns a fresh process
per message and closes stdin after one message. We therefore hold NO in-memory
state between messages -- every handler reads config/db fresh, does its work,
and the sync happens immediately (no debounce; a timer couldn't outlive the
process anyway). The read loop still handles multiple messages so the same host
works if ever driven by connectNative() or a test harness.
"""

from __future__ import annotations

import base64
import binascii
import json
import os
import struct
import sys
import traceback
import uuid

# Allow running both as `python -m daemon.daemon` and as a direct script path
# (native messaging invokes the launcher which execs this file).
if __package__ in (None, ""):
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from daemon import config, db, org_export
else:
    from . import config, db, org_export

LOG_PATH = os.path.join(config.CONFIG_DIR, "daemon.log")

# Image formats we'll save; anything else falls back to .png. Guards against a
# malicious/oddball extension being used to build the on-disk filename.
_ALLOWED_IMAGE_EXTS = {"png", "jpg", "jpeg", "gif", "webp", "avif", "svg"}


def _safe_ext(ext: str | None) -> str:
    ext = (ext or "png").lower().lstrip(".")
    return ext if ext in _ALLOWED_IMAGE_EXTS else "png"


def log(msg: str) -> None:
    """Native messaging hosts have no visible stdout/stderr, so file logging
    is the only way to debug a failure (§2.2)."""
    try:
        os.makedirs(os.path.dirname(LOG_PATH), exist_ok=True)
        with open(LOG_PATH, "a", encoding="utf-8") as f:
            f.write(f"{db.now_iso()} {msg}\n")
    except OSError:
        pass


# --- native messaging wire format -------------------------------------------


def read_message(stream) -> dict | None:
    raw_len = stream.read(4)
    if len(raw_len) < 4:
        return None  # EOF / stdin closed
    (length,) = struct.unpack("<I", raw_len)
    data = stream.read(length)
    if len(data) < length:
        return None
    return json.loads(data.decode("utf-8"))


def write_message(stream, obj: dict) -> None:
    data = json.dumps(obj).encode("utf-8")
    stream.write(struct.pack("<I", len(data)))
    stream.write(data)
    stream.flush()


# --- message handlers -------------------------------------------------------


def handle(msg: dict) -> dict:
    """Dispatch one message, returning the response payload (ok/data/error)."""
    mtype = msg.get("type")
    cfg = config.load_config()

    if mtype == "get_db_path":
        return {"ok": True, "data": {
            "db_path": cfg["db_path"],
            "org_folder": cfg["org_folder"],
        }}

    if mtype == "set_db_path":
        path = os.path.expanduser(msg["path"])
        parent = os.path.dirname(path) or "."
        if not os.path.isdir(parent) or not os.access(parent, os.W_OK):
            return {"ok": False, "error": f"not writable: {parent}"}
        db.init_db(path)
        cfg["db_path"] = path
        config.save_config(cfg)
        return {"ok": True, "data": {"db_path": path}}

    if mtype == "set_org_folder":
        path = os.path.expanduser(msg["path"])
        try:
            os.makedirs(path, exist_ok=True)
        except OSError as e:
            return {"ok": False, "error": f"cannot create folder: {e}"}
        if not os.access(path, os.W_OK):
            return {"ok": False, "error": f"not writable: {path}"}
        cfg["org_folder"] = path
        config.save_config(cfg)
        return {"ok": True, "data": {"org_folder": path}}

    # Everything below needs the DB.
    db.init_db(cfg["db_path"])
    conn = db.connect(cfg["db_path"])
    try:
        result = _handle_db(mtype, msg, conn, cfg)
        conn.commit()
        return result
    finally:
        conn.close()


def _handle_db(mtype: str, msg: dict, conn, cfg: dict) -> dict:
    if mtype == "get_annotations":
        norm = config.normalize_url(msg["url"], cfg["tracking_params"])
        row = conn.execute(
            "SELECT id, title, custom_title, subtitle FROM documents WHERE url = ?",
            (norm,)
        ).fetchone()
        if row is None:
            return {"ok": True, "data": {
                "annotations": [], "document_tags": [],
                "title": None, "custom_title": None, "subtitle": None,
                "dirty": False, "missing": False}}
        doc_id = row["id"]
        return {"ok": True, "data": {
            "annotations": db.get_annotations_for_document(conn, doc_id),
            "document_tags": db.get_document_tags(conn, doc_id),
            "title": row["title"],
            "custom_title": row["custom_title"],
            "subtitle": row["subtitle"],
            # Flag a hand-edited generated file so the UI can nudge toward
            # freezing before the next write overwrites it (a backup is kept
            # regardless). `missing` = the .org was deleted on disk; the DB still
            # has the annotations, so the UI can explain it instead of silently
            # regenerating. Mutually exclusive (dirty requires the file present).
            "dirty": org_export.is_dirty(conn, doc_id, cfg["org_folder"]),
            "missing": org_export.file_missing(conn, doc_id, cfg["org_folder"]),
        }}

    if mtype == "set_document_meta":
        norm = config.normalize_url(msg["url"], cfg["tracking_params"])
        doc_id = db.get_or_create_document(
            conn, norm, msg["url"], msg.get("title"))
        db.set_document_meta(
            conn, doc_id, msg.get("custom_title"), msg.get("subtitle"))
        _sync(conn, doc_id, cfg)
        return {"ok": True, "data": {}}

    if mtype == "create_annotation":
        norm = config.normalize_url(msg["url"], cfg["tracking_params"])
        doc_id = db.get_or_create_document(
            conn, norm, msg["url"], msg.get("title"))
        annot_id = db.create_annotation(
            conn, doc_id, msg["quote"], msg.get("prefix"), msg.get("suffix"),
            msg.get("color", "yellow"), msg.get("note"), msg.get("tags", []),
            msg.get("position"))
        _sync(conn, doc_id, cfg)
        return {"ok": True, "data": {"id": annot_id}}

    if mtype == "create_image_annotation":
        # Note is mandatory for image annotations (a bare image isn't useful in
        # the org file). The content script fetches the image and sends it as
        # base64; we decode and write it before inserting the row so a failed
        # write never leaves a dangling annotation.
        note = (msg.get("note") or "").strip()
        if not note:
            return {"ok": False, "error": "a note is required for image annotations"}
        try:
            raw = base64.b64decode(msg.get("data", ""), validate=True)
        except (binascii.Error, ValueError):
            return {"ok": False, "error": "invalid image data"}
        if not raw:
            return {"ok": False, "error": "empty image data"}
        norm = config.normalize_url(msg["url"], cfg["tracking_params"])
        doc_id = db.get_or_create_document(
            conn, norm, msg["url"], msg.get("title"))
        annot_id = str(uuid.uuid4())
        image_file = f"{annot_id}.{_safe_ext(msg.get('ext'))}"
        images_dir = os.path.join(cfg["org_folder"], "images")
        try:
            os.makedirs(images_dir, exist_ok=True)
            with open(os.path.join(images_dir, image_file), "wb") as f:
                f.write(raw)
        except OSError as e:
            return {"ok": False, "error": f"cannot write image: {e}"}
        db.create_image_annotation(
            conn, annot_id, doc_id, msg.get("src"), note,
            msg.get("tags", []), msg.get("position"), image_file)
        _sync(conn, doc_id, cfg)
        return {"ok": True, "data": {"id": annot_id, "image_file": image_file}}

    if mtype == "set_annotation_positions":
        # Content script reports each annotation's current page position after
        # re-anchoring, so the export can match the sidebar's document order.
        # Only regenerate the .org file if a position actually moved.
        norm = config.normalize_url(msg["url"], cfg["tracking_params"])
        row = conn.execute(
            "SELECT id FROM documents WHERE url = ?", (norm,)
        ).fetchone()
        if row is None:
            return {"ok": True, "data": {}}
        doc_id = row["id"]
        changed = False
        for annot_id, position in (msg.get("positions") or {}).items():
            if db.set_annotation_position(conn, annot_id, doc_id, position):
                changed = True
        if changed:
            _sync(conn, doc_id, cfg)
        return {"ok": True, "data": {}}

    if mtype == "update_annotation":
        db.update_annotation(
            conn, msg["id"], msg.get("note"), msg.get("color"),
            msg.get("tags"))
        row = conn.execute(
            "SELECT document_id FROM annotations WHERE id = ?", (msg["id"],)
        ).fetchone()
        if row:
            _sync(conn, row["document_id"], cfg)
        return {"ok": True, "data": {"id": msg["id"]}}

    if mtype == "delete_annotation":
        # Grab the image filename (if any) before the row goes, so we can remove
        # the orphaned file from disk too.
        row = conn.execute(
            "SELECT image_file FROM annotations WHERE id = ?", (msg["id"],)
        ).fetchone()
        doc_id = db.delete_annotation(conn, msg["id"])
        if doc_id >= 0:
            if row and row["image_file"]:
                try:
                    os.remove(os.path.join(
                        cfg["org_folder"], "images", row["image_file"]))
                except OSError:
                    pass
            _sync(conn, doc_id, cfg)
        return {"ok": True, "data": {"id": msg["id"]}}

    if mtype == "freeze_document":
        # One-way archive. Regenerate the .org one last time (with the frozen
        # stamp), then release the URL so the next visit to this page starts a
        # fresh document. The frozen file is never rewritten again.
        norm = config.normalize_url(msg["url"], cfg["tracking_params"])
        row = conn.execute(
            "SELECT id FROM documents WHERE url = ?", (norm,)
        ).fetchone()
        if row is None:
            return {"ok": False, "error": "nothing to freeze for this page"}
        doc_id = row["id"]
        frozen_at = db.freeze_document(conn, doc_id)
        try:
            # Call the exporter directly, not _sync -- _sync now refuses frozen
            # docs, and this is the one intentional final write.
            path = org_export.sync_document(
                conn, doc_id, cfg["org_folder"], log=log)
        except Exception as e:
            log(f"freeze final sync failed for document {doc_id}: {e}")
            return {"ok": False, "error": f"freeze failed: {e}"}
        return {"ok": True, "data": {
            "frozen_at": frozen_at, "org_filename": os.path.basename(path)}}

    if mtype == "restore_document":
        # Regenerate a .org that was deleted on disk, from the DB (the source of
        # truth). The counterpart to delete_document in the missing-file modal.
        norm = config.normalize_url(msg["url"], cfg["tracking_params"])
        row = conn.execute(
            "SELECT id, org_filename FROM documents WHERE url = ?", (norm,)
        ).fetchone()
        if row is None:
            return {"ok": False, "error": "nothing to restore for this page"}
        _sync(conn, row["id"], cfg)
        return {"ok": True, "data": {"org_filename": row["org_filename"]}}

    if mtype == "delete_document":
        # The intentional "throw this page away" action (vs deleting the .org by
        # hand, which only regenerates). Removes the doc + its annotations from
        # SQLite and cleans up the .org file and any saved images.
        norm = config.normalize_url(msg["url"], cfg["tracking_params"])
        row = conn.execute(
            "SELECT id FROM documents WHERE url = ?", (norm,)
        ).fetchone()
        if row is None:
            return {"ok": True, "data": {}}   # already gone
        org_filename, images = db.delete_document(conn, row["id"])
        if org_filename:
            try:
                os.remove(os.path.join(cfg["org_folder"], org_filename))
            except OSError:
                pass
        for image_file in images:
            try:
                os.remove(os.path.join(cfg["org_folder"], "images", image_file))
            except OSError:
                pass
        return {"ok": True, "data": {}}

    if mtype == "update_document_tags":
        norm = config.normalize_url(msg["url"], cfg["tracking_params"])
        doc_id = db.get_or_create_document(
            conn, norm, msg["url"], msg.get("title"))
        db.set_document_tags(conn, doc_id, msg.get("tags", []))
        _sync(conn, doc_id, cfg)
        return {"ok": True,
                "data": {"document_tags": db.get_document_tags(conn, doc_id)}}

    return {"ok": False, "error": f"unknown message type: {mtype}"}


def _sync(conn, doc_id: int, cfg: dict) -> None:
    """Immediate org regeneration for the affected document (§6.3). Frozen
    documents are archives -- never regenerate them (the URL release already
    keeps normal url-keyed paths from reaching a frozen doc; this guards the
    id-keyed paths too)."""
    frozen = conn.execute(
        "SELECT frozen_at FROM documents WHERE id = ?", (doc_id,)
    ).fetchone()
    if frozen and frozen["frozen_at"]:
        log(f"skip sync: document {doc_id} is frozen")
        return
    try:
        path = org_export.sync_document(
            conn, doc_id, cfg["org_folder"], log=log)
        log(f"synced document {doc_id} -> {path}")
    except Exception as e:  # a sync failure must not lose the DB write
        log(f"sync failed for document {doc_id}: {e}")


def main() -> None:
    # First line every invocation writes -- if this never appears after a
    # browser reload, the browser is failing to *execute* the host at all
    # (permissions / interpreter / TCC), not failing the protocol.
    log(f"daemon started (pid {os.getpid()}, python {sys.executable})")
    stdin = sys.stdin.buffer
    stdout = sys.stdout.buffer
    while True:
        try:
            msg = read_message(stdin)
        except Exception as e:
            log(f"failed to read message: {e}")
            break
        if msg is None:
            break
        log(f"received: {msg.get('type')}")
        try:
            resp = handle(msg)
        except Exception as e:
            log(f"handler error: {e}\n{traceback.format_exc()}")
            resp = {"ok": False, "error": str(e)}
        write_message(stdout, resp)


if __name__ == "__main__":
    main()
