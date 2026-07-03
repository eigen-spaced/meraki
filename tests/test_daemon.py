"""End-to-end test of the daemon over its real native-messaging wire format.

Spawns `python -m daemon.daemon` as a subprocess, frames JSON messages exactly
as Firefox would (4-byte little-endian length prefix), and asserts the daemon's
responses plus the resulting SQLite rows and .org files.

Run: python -m tests.test_daemon   (from the meraki/ repo root)
No pytest dependency -- plain asserts so it runs anywhere Python does.
"""

from __future__ import annotations

import json
import os
import struct
import subprocess
import sys
import tempfile

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, REPO_ROOT)

from daemon import config, db  # noqa: E402


def frame(obj: dict) -> bytes:
    data = json.dumps(obj).encode("utf-8")
    return struct.pack("<I", len(data)) + data


def read_frame(stream) -> dict:
    raw_len = stream.read(4)
    assert len(raw_len) == 4, "daemon closed without responding"
    (length,) = struct.unpack("<I", raw_len)
    return json.loads(stream.read(length).decode("utf-8"))


def run_conversation(messages: list[dict], env: dict) -> list[dict]:
    """Send all messages in one daemon invocation, collect all responses."""
    proc = subprocess.Popen(
        [sys.executable, "-m", "daemon.daemon"],
        cwd=REPO_ROOT, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
        stderr=subprocess.PIPE, env=env)
    payload = b"".join(frame(m) for m in messages)
    out, err = proc.communicate(input=payload, timeout=30)
    if err:
        sys.stderr.write(err.decode("utf-8", "replace"))
    responses = []
    from io import BytesIO
    buf = BytesIO(out)
    for _ in messages:
        responses.append(read_frame(buf))
    return responses


def _org_path_for(org_folder: str, db_path: str, url: str) -> str:
    """Absolute path of the .org file the daemon generated for a URL (fresh conn
    so it always sees the latest committed write)."""
    conn = db.connect(db_path)
    try:
        norm = config.normalize_url(url)
        row = conn.execute(
            "SELECT org_filename FROM documents WHERE url = ?", (norm,)
        ).fetchone()
    finally:
        conn.close()
    assert row and row["org_filename"], f"no org file for {url}"
    return os.path.join(org_folder, row["org_filename"])


def _org_for(org_folder: str, db_path: str, url: str) -> str:
    """Read the .org file the daemon generated for a URL."""
    with open(_org_path_for(org_folder, db_path, url)) as f:
        return f.read()


def main() -> None:
    tmp = tempfile.mkdtemp(prefix="annot-test-")
    db_path = os.path.join(tmp, "annotations.db")
    org_folder = os.path.join(tmp, "org")

    # Point the daemon's config at our temp dirs via a temp HOME.
    fake_home = os.path.join(tmp, "home")
    cfg_dir = os.path.join(fake_home, ".config", "meraki-annotator")
    os.makedirs(cfg_dir, exist_ok=True)
    with open(os.path.join(cfg_dir, "config.json"), "w") as f:
        json.dump({"db_path": db_path, "org_folder": org_folder}, f)

    env = dict(os.environ)
    env["HOME"] = fake_home

    # --- URL normalization: tracker-laden and clean collapse to one doc ---
    url_dirty = "https://www.Example.com/Article/?utm_source=twitter&fbclid=abc"
    url_clean = "https://example.com/Article"
    assert config.normalize_url(url_dirty) == config.normalize_url(url_clean), \
        "tracker/clean URLs must normalize equal"
    print("PASS: URL normalization collapses tracker params")

    # --- conversation ---
    msgs = [
        {"type": "get_db_path"},
        {"type": "create_annotation", "url": url_dirty, "title": "Test Article",
         "quote": "the exact highlighted text", "prefix": "before ",
         "suffix": " after", "color": "blue", "note": "my note",
         "tags": ["important", "review"]},
        {"type": "create_annotation", "url": url_clean, "title": "Test Article",
         "quote": "second passage", "color": "green"},
        {"type": "update_document_tags", "url": url_clean,
         "title": "Test Article", "tags": ["marketing", "stats"]},
        {"type": "get_annotations", "url": url_clean},
    ]
    responses = run_conversation(msgs, env)
    for r in responses:
        assert r.get("ok"), f"message failed: {r}"

    first_annot_id = responses[1]["data"]["id"]
    get_data = responses[4]["data"]
    n_annots = len(get_data["annotations"])
    assert n_annots == 2, \
        f"both annotations should attach to one document, got {n_annots}"
    assert set(get_data["document_tags"]) == {"marketing", "stats"}
    print("PASS: two URLs -> one document, both annotations returned")

    # --- SQLite reflects the writes ---
    conn = db.connect(db_path)
    doc_count = conn.execute("SELECT COUNT(*) c FROM documents").fetchone()["c"]
    assert doc_count == 1, f"expected 1 document, got {doc_count}"
    (ver,) = conn.execute("PRAGMA user_version").fetchone()
    assert ver == db.SCHEMA_VERSION, \
        f"init_db must stamp user_version={db.SCHEMA_VERSION}, got {ver}"
    print("PASS: SQLite has exactly one document row (schema version stamped)")

    # --- org file exists, valid-ish, scoped to one file ---
    org_files = [f for f in os.listdir(org_folder) if f.endswith(".org")]
    assert len(org_files) == 1, f"expected 1 org file, got {org_files}"
    with open(os.path.join(org_folder, org_files[0])) as f:
        org = f.read()
    assert "#+TITLE: Test Article" in org
    assert "#+FILETAGS: :marketing:stats:" in org
    assert f":ANNOT_ID: {first_annot_id}" in org
    assert "#+BEGIN_QUOTE" in org and "#+END_QUOTE" in org
    assert "the exact highlighted text" in org
    print(f"PASS: org file '{org_files[0]}' has title, filetags, annot id, quote")

    # --- custom title / subtitle override the export header ---
    run_conversation([{
        "type": "set_document_meta", "url": url_clean, "title": "Test Article",
        "custom_title": "My Custom Title", "subtitle": "a subtitle"}], env)
    with open(os.path.join(org_folder, org_files[0])) as f:
        org_meta = f.read()
    assert "#+TITLE: My Custom Title" in org_meta, "custom title must override #+TITLE"
    assert "#+SUBTITLE: a subtitle" in org_meta, "subtitle must appear as #+SUBTITLE"
    print("PASS: custom title/subtitle land in the export header")

    # --- export ordering follows page position, not creation order ---
    url_order = "https://example.com/ordering"
    order_msgs = [
        {"type": "create_annotation", "url": url_order, "title": "Ordered",
         "quote": "gamma near the end", "color": "yellow", "position": 500},
        {"type": "create_annotation", "url": url_order, "title": "Ordered",
         "quote": "alpha at the top", "color": "yellow", "position": 100},
        {"type": "create_annotation", "url": url_order, "title": "Ordered",
         "quote": "beta in the middle", "color": "yellow", "position": 300},
    ]
    for r in run_conversation(order_msgs, env):
        assert r.get("ok"), f"ordered create failed: {r}"
    org_ord = _org_for(org_folder, db_path, url_order)
    seen = [org_ord.index(q) for q in
            ("alpha at the top", "beta in the middle", "gamma near the end")]
    assert seen == sorted(seen), \
        f"annotations must export in page-position order, got {seen}"
    print("PASS: export orders annotations by page position, not creation time")

    # --- set_annotation_positions reorders an existing export ---
    beta_id = run_conversation(
        [{"type": "get_annotations", "url": url_order}], env
    )[0]["data"]["annotations"]
    beta_id = next(a["id"] for a in beta_id if a["quote"] == "beta in the middle")
    run_conversation([{"type": "set_annotation_positions", "url": url_order,
                       "positions": {beta_id: 10}}], env)
    org_ord2 = _org_for(org_folder, db_path, url_order)
    assert org_ord2.index("beta in the middle") < org_ord2.index("alpha at the top"), \
        "set_annotation_positions must move beta ahead of alpha in the export"
    print("PASS: set_annotation_positions reorders the org export")

    # --- image annotation: writes a file + links it from the export ---
    tiny_png = ("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4"
                "2mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==")
    url_img = "https://example.com/gallery"
    img_resps = run_conversation([
        {"type": "create_image_annotation", "url": url_img, "title": "Gallery",
         "note": "a diagram worth keeping", "src": "https://example.com/d.png",
         "ext": "png", "position": 250, "data": tiny_png, "tags": ["diagram"]},
        {"type": "create_image_annotation", "url": url_img, "title": "Gallery",
         "note": "", "ext": "png", "data": tiny_png},   # no note -> rejected
    ], env)
    assert img_resps[0].get("ok"), f"image create failed: {img_resps[0]}"
    assert not img_resps[1].get("ok"), "image without a note must be rejected"
    image_file = img_resps[0]["data"]["image_file"]
    assert os.path.isfile(os.path.join(org_folder, "images", image_file)), \
        "image bytes must be written under org_folder/images/"
    org_img = _org_for(org_folder, db_path, url_img)
    assert f"[[file:images/{image_file}]]" in org_img, "export must link the image"
    assert ":KIND: image" in org_img, "image annotation must carry :KIND:"
    assert "a diagram worth keeping" in org_img, "note must appear in the export"
    print("PASS: image annotation writes a file and links it from the export")

    # --- get_image serves a saved image back as a data URL (sidebar preview) ---
    gi = run_conversation([
        {"type": "get_image", "file": image_file},
        {"type": "get_image", "file": "does-not-exist.png"},
        {"type": "get_image", "file": "../../etc/passwd"},   # traversal neutralized
    ], env)
    assert gi[0].get("ok"), f"get_image failed: {gi[0]}"
    assert gi[0]["data"]["data_url"].startswith("data:image/png;base64,"), \
        "get_image must return a png data URL"
    assert gi[0]["data"]["data_url"].endswith(tiny_png), \
        "get_image must return the stored bytes"
    assert not gi[1].get("ok"), "get_image on a missing file must fail"
    assert not gi[2].get("ok"), "get_image must stay inside the images folder"
    print("PASS: get_image serves a saved image as a data URL")

    # --- deleting an image annotation removes its file from disk ---
    run_conversation(
        [{"type": "delete_annotation", "id": img_resps[0]["data"]["id"]}], env)
    assert not os.path.isfile(os.path.join(org_folder, "images", image_file)), \
        "deleting an image annotation must remove its file"
    print("PASS: deleting an image annotation removes its file")

    # --- freeze: stamped final archive, then the URL releases to a blank slate ---
    url_freeze = "https://example.com/freeze-me"
    assert run_conversation([
        {"type": "create_annotation", "url": url_freeze, "title": "Freeze Me",
         "quote": "keep this forever", "color": "blue", "position": 100},
    ], env)[0].get("ok")
    fz = run_conversation(
        [{"type": "freeze_document", "url": url_freeze, "title": "Freeze Me"}],
        env)[0]
    assert fz.get("ok"), f"freeze failed: {fz}"
    frozen_name = fz["data"]["org_filename"]
    frozen_path = os.path.join(org_folder, frozen_name)
    with open(frozen_path) as f:
        frozen_org = f.read()
    assert "#+PROPERTY: FROZEN" in frozen_org, "frozen file must carry a FROZEN stamp"
    assert "keep this forever" in frozen_org
    print("PASS: freeze writes a final stamped archive")

    # Revisiting the frozen URL is a blank slate; a new annotation there starts a
    # NEW document + file and never disturbs the frozen archive.
    after = run_conversation(
        [{"type": "get_annotations", "url": url_freeze}], env)[0]["data"]
    assert after["annotations"] == [], "a frozen page must revisit blank"
    with open(frozen_path, "rb") as f:
        frozen_bytes = f.read()
    assert run_conversation([
        {"type": "create_annotation", "url": url_freeze, "title": "Freeze Me",
         "quote": "a brand new note", "color": "green", "position": 100},
    ], env)[0].get("ok")
    with open(frozen_path, "rb") as f:
        assert f.read() == frozen_bytes, \
            "frozen archive must not change after new activity"
    new_org = _org_for(org_folder, db_path, url_freeze)
    assert "a brand new note" in new_org, "fresh visit must start a new doc/file"
    assert "keep this forever" not in new_org, \
        "the fresh doc must not inherit the frozen annotations"
    new_path = _org_path_for(org_folder, db_path, url_freeze)
    assert os.path.basename(new_path) != frozen_name, \
        "the fresh doc must get its own filename, not the frozen one"
    print("PASS: revisiting a frozen page is a blank slate; the archive is untouched")

    # --- dirty-file safety net: a hand-edited generated file is backed up ---
    url_edit = "https://example.com/dirty-edit"
    assert run_conversation([
        {"type": "create_annotation", "url": url_edit, "title": "Dirty",
         "quote": "original highlight", "color": "yellow", "position": 100},
    ], env)[0].get("ok")
    dirty_path = _org_path_for(org_folder, db_path, url_edit)
    with open(dirty_path, "a") as f:      # simulate a manual Emacs edit
        f.write("\n* My hand-written heading\n  precious prose\n")
    ga = run_conversation(
        [{"type": "get_annotations", "url": url_edit}], env)[0]["data"]
    assert ga.get("dirty") is True, "a hand-edited generated file must report dirty"
    # The next write regenerates -- but must back up the hand edit first.
    assert run_conversation([
        {"type": "create_annotation", "url": url_edit, "title": "Dirty",
         "quote": "second highlight", "color": "green", "position": 200},
    ], env)[0].get("ok")
    backup_dir = os.path.join(fake_home, ".config", "meraki-annotator", "backups")
    fname = os.path.basename(dirty_path)
    backups = ([b for b in os.listdir(backup_dir) if b.startswith(fname)]
               if os.path.isdir(backup_dir) else [])
    assert backups, "a dirty file must be backed up before overwrite"
    with open(os.path.join(backup_dir, backups[0])) as f:
        assert "precious prose" in f.read(), "backup must preserve the hand edit"
    with open(dirty_path) as f:
        regen = f.read()
    assert "precious prose" not in regen, "regenerated file drops the hand edit"
    assert "original highlight" in regen and "second highlight" in regen
    ga2 = run_conversation(
        [{"type": "get_annotations", "url": url_edit}], env)[0]["data"]
    assert ga2.get("dirty") is False, "a freshly regenerated file is clean again"
    print("PASS: dirty (hand-edited) file is backed up before overwrite")

    # --- delete_document: the intentional "throw this page away" action ---
    url_del = "https://example.com/delete-me"
    dd = run_conversation([
        {"type": "create_annotation", "url": url_del, "title": "Del",
         "quote": "a text note", "color": "yellow", "position": 100},
        {"type": "create_image_annotation", "url": url_del, "title": "Del",
         "note": "an image note", "src": "https://example.com/z.png",
         "ext": "png", "position": 200, "data": tiny_png},
    ], env)
    assert all(r.get("ok") for r in dd), f"delete_document setup failed: {dd}"
    del_img = dd[1]["data"]["image_file"]
    del_org = _org_path_for(org_folder, db_path, url_del)
    assert os.path.isfile(del_org)
    assert os.path.isfile(os.path.join(org_folder, "images", del_img))
    assert run_conversation(
        [{"type": "delete_document", "url": url_del}], env)[0].get("ok")
    assert not os.path.exists(del_org), "delete_document must remove the .org file"
    assert not os.path.exists(os.path.join(org_folder, "images", del_img)), \
        "delete_document must remove saved images"
    after_del = run_conversation(
        [{"type": "get_annotations", "url": url_del}], env)[0]["data"]
    assert after_del["annotations"] == [], "delete_document must clear the DB rows"
    print("PASS: delete_document removes the doc, its .org, and its images")

    # --- deleting the .org by hand is reported 'missing', not silently lost ---
    url_miss = "https://example.com/missing-file"
    assert run_conversation([
        {"type": "create_annotation", "url": url_miss, "title": "Miss",
         "quote": "still in the db", "color": "blue", "position": 100},
    ], env)[0].get("ok")
    miss_path = _org_path_for(org_folder, db_path, url_miss)
    os.remove(miss_path)      # user deletes the generated file on disk
    gm = run_conversation(
        [{"type": "get_annotations", "url": url_miss}], env)[0]["data"]
    assert gm.get("missing") is True, "a deleted .org must report missing"
    assert gm.get("dirty") is False, "missing and dirty are mutually exclusive"
    assert len(gm["annotations"]) == 1, \
        "annotations survive a file deletion (the DB is the source of truth)"
    assert run_conversation([
        {"type": "create_annotation", "url": url_miss, "title": "Miss",
         "quote": "a new one", "color": "green", "position": 200},
    ], env)[0].get("ok")
    assert os.path.isfile(miss_path), "the next write regenerates the .org"
    gm2 = run_conversation(
        [{"type": "get_annotations", "url": url_miss}], env)[0]["data"]
    assert gm2.get("missing") is False, "a regenerated file is no longer missing"
    print("PASS: a hand-deleted .org reports missing; DB stays the source of truth")

    # --- restore_document regenerates a deleted .org from the DB ---
    url_restore = "https://example.com/restore-me"
    assert run_conversation([
        {"type": "create_annotation", "url": url_restore, "title": "Restore",
         "quote": "bring me back", "color": "pink", "position": 100},
    ], env)[0].get("ok")
    restore_path = _org_path_for(org_folder, db_path, url_restore)
    os.remove(restore_path)
    rr = run_conversation(
        [{"type": "restore_document", "url": url_restore}], env)[0]
    assert rr.get("ok"), f"restore failed: {rr}"
    assert os.path.isfile(restore_path), "restore_document must recreate the .org"
    with open(restore_path) as f:
        assert "bring me back" in f.read(), "restored file must reflect the DB"
    grr = run_conversation(
        [{"type": "get_annotations", "url": url_restore}], env)[0]["data"]
    assert grr.get("missing") is False, "a restored file is no longer missing"
    print("PASS: restore_document regenerates a deleted .org from the DB")

    # --- delete removes it from the next regeneration ---
    run_conversation([{"type": "delete_annotation", "id": first_annot_id}], env)
    with open(os.path.join(org_folder, org_files[0])) as f:
        org2 = f.read()
    assert first_annot_id not in org2, "deleted annotation must vanish from org"
    assert "second passage" in org2, "surviving annotation must remain"
    print("PASS: delete removes annotation from regenerated org file")

    # --- clear_database wipes every row but leaves .org files on disk (last:
    #     it nukes everything the earlier assertions built) ---
    orgs_before = [f for f in os.listdir(org_folder) if f.endswith(".org")]
    assert orgs_before, "there should be .org files before clearing"
    cd = run_conversation([{"type": "clear_database"}], env)[0]
    assert cd.get("ok"), f"clear_database failed: {cd}"
    assert cd["data"]["cleared"] >= 1, "clear_database should report removed docs"
    probe = db.connect(db_path)
    try:
        counts = {
            t: probe.execute(f"SELECT COUNT(*) AS c FROM {t}").fetchone()["c"]
            for t in ("documents", "annotations", "tags",
                      "annotation_tags", "document_tags")
        }
    finally:
        probe.close()
    assert all(v == 0 for v in counts.values()), f"DB must be empty, got {counts}"
    ga_cleared = run_conversation(
        [{"type": "get_annotations", "url": url_clean}], env)[0]["data"]
    assert ga_cleared["annotations"] == [], "a cleared DB returns no annotations"
    orgs_after = [f for f in os.listdir(org_folder) if f.endswith(".org")]
    assert set(orgs_after) == set(orgs_before), \
        "clear_database must leave generated .org files on disk"
    print("PASS: clear_database wipes the DB but keeps .org files")

    conn.close()
    print("\nALL DAEMON TESTS PASSED")


if __name__ == "__main__":
    main()
