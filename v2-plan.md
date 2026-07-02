# Meraki Annotator — v2 Plan

v1 shipped: overlay highlight/annotate on live pages + SQLite store + org export
(one file per document, full regeneration, git-diffable). This document is the
working plan for v2. It supersedes `annotator-plan.md` (removed).

**Legend:** ✅ shipped · 🎯 near-term (building now) · 🧊 designed, deferred ·
💤 backlog. *(Nothing is 🎯 right now — Item 5 shipped, Item 1 deferred; the
backlog is pull-based.)*

---

## Carried-over design constraints (still hold in v2)

These v1 decisions shape what v2 can do cheaply:

- **MV3 + `sendNativeMessage()`** — stateless, fresh daemon process per message.
  Keeps Chrome portability essentially free (item 6).
- **`:ANNOT_ID:` drawer on every heading** — present since day one specifically
  so incremental org patching (item 3) is possible later without re-export.
- **Full regeneration per document** — cheap at personal volume; the org file is
  derived output, not hand-editable (freeze changes that).
- **Text-quote + prefix/suffix anchoring** (Hypothesis-style) — robustness lives
  here; ordering (`position`) is a cheap layer on top. Any new surface (reader
  mode, EPUB) that produces stable text can reuse this directly.
- **Modular content script** (`src/`: bus/store/session, highlights, ui/*,
  selection, lifecycle) — new surfaces plug in as new render targets + anchoring
  strategies without touching the core.

---

## ✅ Item 5 — Image annotations (shipped)

Click an image → a note popup (distinct from the text popup; images aren't
highlighted). Note is **required** — an image can't be saved without one. The
image file is copied into `{org_folder}/images/` and linked from the export.

**Status:** built and smoke-tested. Content-script → background fetch (page CORS
blocks a content-script fetch) → daemon writes `images/<id>.<ext>`. Daemon tests
cover file write, `[[file:images/…]]` link, `:KIND:` drawer, note-required
rejection, and file cleanup on delete.

**Feasibility: Medium. Self-contained — no new rendering engine.** The main new
plumbing is getting image bytes to disk.

**Design:**
- **Interaction:** while the annotator is active, clicking an `<img>` (in the
  hit-test path, before the text hit-test) opens an image-note popup. Reuse the
  comment popup shell, minus color/quote, plus a thumbnail preview. Save disabled
  until a note is typed.
- **Anchoring:** by image `src` (+ DOM index as a tiebreaker for repeated srcs,
  + `alt` for reference). Re-find on load by matching `src`. Much simpler and
  more stable than text anchoring.
- **Getting the bytes:** the **content script** fetches the image (`fetch(src)` →
  blob → base64) so the page's cookies/CORS context are preserved, then sends it
  to the daemon to write. Fetch the original bytes (no canvas re-encode — canvas
  taints on cross-origin and strips fidelity). **Cap size** (e.g. skip/warn over
  ~5 MB) since native messaging framing isn't meant for huge payloads; downscale
  as a later option.
- **Daemon:** new `create_image_annotation` writes `images/<annot_id>.<ext>`
  (ext from content-type/src) and stores the row. Add `images/` under
  `org_folder`.
- **Schema:** add `kind TEXT NOT NULL DEFAULT 'text'` ('text' | 'image') and
  `image_file TEXT` to `annotations` (simple `ADD COLUMN` migration). Image rows:
  `kind='image'`, `image_file` set, `note` required, `quote` = alt/src for the
  heading.
- **Export:** image heading renders the note + an inline `[[file:images/<id>.ext]]`
  link so Emacs shows the image inline. Ordering: image annotations get a
  `position` too (DOM offset of the `<img>`), so they interleave with text
  annotations in document order.
- **Sidebar:** image items show a thumbnail + note instead of a quote swatch.

**Scope:** `<img>` elements only. CSS background-images and `<canvas>` are **out
of scope** — not deferred, not covered (and no canvas-based fetch fallback).

**Open decisions:** size cap value + downscale-or-skip on oversize.

---

## 💤 Item 1 — In-app reader mode (HTML only) — deferred

**Deferred to the backlog** (was near-term). It improves *reading*, not
*annotating*, and sits outside Meraki's core capture→export loop: the target is
stable reading pages (usually already clean) and the results are consumed in
Emacs/org anyway. Its one unique pull — annotating a decluttered view, which
Firefox's native Reader View can't do since extensions don't run on `about:reader`
— isn't a recurring pain right now. Revisit only if cluttered-page annotating
becomes real, regular friction. Design below is kept for when/if that happens.

Annotate inside a stripped-down view instead of only the live page — the "Reader"
half of the original Diigo+Reader ask. **Scoped to HTML (Readability.js).**

**PDF and EPUB are out of scope** — not deferred, dropped. Those are better served
inside Emacs (`pdf-tools`, the built-in reader) where mature packages already
exist; no reason to reimplement a PDF/EPUB reader + a second anchoring model in
the extension.

**Feasibility: Medium.** Reuses the existing stack directly — the CSS Custom
Highlight API and text-quote anchoring both work on the Readability-cleaned DOM.
**Note:** render in the **light DOM**, not a shadow-DOM overlay — in Firefox
`window.getSelection()` doesn't descend into shadow roots and the Custom Highlight
API paints at document scope, so a shadow reader would break both selecting and
highlighting. A light-DOM overlay keeps both working (tradeoff: some page-CSS
bleed, mitigated with a scoped reset).

**Design:**
- **Trigger:** a "Reader" toggle (toolbar or sidebar). On enable, run Readability
  on `document.cloneNode(true)` (Readability mutates its input, so clone).
- **Render target:** a full-screen **shadow-DOM overlay** on top of the page
  (not DOM replacement, not a separate extension page). Same URL ⇒ same daemon
  document, so annotations stay tied to the same `.org` file. The existing
  highlight/selection/sidebar modules retarget onto the reader DOM.
- **Anchoring across views:** annotations are one set per document, re-anchored
  per view via text-quote search. A highlight made on the live page whose text
  also appears in the reader view re-anchors there automatically; page chrome
  (nav/footer) that isn't in the reader view simply orphans — consistent with the
  existing graceful-degradation model. No separate annotation context.
- **Bundle:** `@mozilla/readability` is small and MIT — bundle via esbuild like
  the content script.

**Open decisions:** (a) confirm overlay vs dedicated reader page (overlay
recommended — keeps URL/doc identity). (b) does reader mode auto-detect
article-y pages or is it purely manual? (manual first).

---

## ✅ Freeze / archive page (shipped)

Graduate a page's annotations from derived output into a permanent, hand-owned
`.org` the daemon never rewrites again — insurance against link-rot / content
drift. **Locked decisions (both honored):**
- **One-way**, with a confirmation warning. No un-freeze.
- **Blank-slate revisit:** after freezing, revisiting the URL shows no old
  highlights and starts a fresh session into a *new* document + new `.org`; the
  frozen file stays untouched as the archive. Revisiting *is* the restart.

**As built:** `documents.frozen_at` column (`ADD COLUMN`, no rebuild). A
`freeze_document` message does one final stamped regeneration (`#+PROPERTY:
FROZEN [date]`), then `db.freeze_document` releases the UNIQUE `url` by appending
a `#meraki-frozen-<id>` sentinel (keeping `raw_url`) so the next visit's
`get_or_create_document` makes a *new* doc → new id → new filename, no collision.
`daemon._sync` skips `frozen_at IS NOT NULL` as belt-and-suspenders (the URL
release already keeps url-keyed paths away; the guard also covers id-keyed
paths). Sidebar has a two-step confirm footer button; on success it emits
`document:reload`, which re-runs `loadExisting()` and comes back blank. Multiple
freezes over time = a natural version history of a page. Covered by
`tests/test_daemon.py` (stamp, blank-slate revisit, untouched archive).

---

## 💤 Backlog (deferred, order TBD)

- **Item 2 — eww integration (`eww-annotate.el`).** Elisp minor mode writing
  straight to the same SQLite file so browser and Emacs highlights converge on one
  store. No native-messaging bridge (Emacs isn't sandboxed) — one of the *simpler*
  advanced items. Needs: a stable SQLite contract (schema is the API) and matching
  the WAL/busy-timeout access pattern so concurrent daemon + Emacs writes don't
  clash.
- **Item 3 — Incremental org patching.** Replace full regeneration with
  diff-based patches keyed on `:ANNOT_ID:` drawers, so hand-edits survive sync and
  edits can flow org → SQLite. Only worth it once regeneration is slow or direct
  org editing is wanted. (The `:ANNOT_ID:` drawers already exist for this.)
  *Less urgent now:* the **dirty-file safety net** (shipped) already prevents
  silent data loss on hand-edited managed files — the daemon hashes what it wrote
  (`documents.org_sha`), backs up a diverged file to
  `~/.config/meraki-annotator/backups/` before overwriting, and the sidebar warns
  on load. That covers the *loss* risk; Item 3 would add true round-trip *merge*,
  which is the heavy part and still deferred.
- **Item 4 — Vault / db switching UI.** v1 has one `db_path`; named switchable
  vaults (work vs personal). Mostly options-page + config work.
- **Item 6 — Chrome Web Store packaging.** Architecture already portable (MV3 +
  `sendNativeMessage()`); mostly packaging / store listing / testing, not new
  design. Native-messaging host manifest differs per browser.
- **Item 7 — Multi-device concurrent writes.** If `db_path` is in a synced folder,
  two machines writing near-simultaneously can conflict on the SQLite file itself
  (file-level sync conflict, not row-level). Not solved; flagged. Real fix likely
  means a sync-aware layer or CRDT-ish merge, or documenting "one writer at a
  time." Out of near-term scope.

---

## Near-term build order

1. **Item 5 (image annotations)** — ✅ **shipped** (built, smoke-tested, daemon
   tests cover it). Exercised the "non-text annotation" path + `images/` folder +
   schema `kind` column that later features can reuse.
2. **Item 1 (HTML reader mode)** — **deferred to backlog** (see above). It's not
   load-bearing for the capture→export loop; revisit only if annotating cluttered
   pages becomes a real recurring pain.

With Item 5 done and Item 1 deferred, there's **no near-term item queued** — the
backlog (Items 1, 2, 3, 4, 6, 7 + Freeze) is pull-based from here. Each future
item ships behind its own build → `make debug` smoke test; daemon changes covered
by `tests/test_daemon.py`.
