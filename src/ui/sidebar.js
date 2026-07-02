// The right-edge sidebar: annotation list, page-level title/subtitle, page
// tags, and the highlights mute switch, plus the always-present tab that opens
// it. Rebuilds its list on "annotations:changed"; deletions go out as "remove"
// and the mute switch as "highlights:set" so it stays decoupled from the
// comment popup and the lifecycle coordinator.

import { COLOR_CSS } from "../constants.js";
import { truncate, escapeHtml } from "../helpers.js";
import { on, emit } from "../bus.js";
import { send } from "../daemon.js";
import { state, doc } from "../store.js";
import { session } from "../session.js";
import { flashRange } from "../highlights.js";
import { showToast } from "./toast.js";

let sidebar = null;
let sidebarOpen = false;
let docMetaTimer = null;

export function initSidebar(shadow) {
  buildSidebar(shadow);
  buildSidebarTab(shadow);
}

function buildSidebar(shadow) {
  sidebar = document.createElement("div");
  sidebar.className = "sidebar hidden";
  sidebar.innerHTML = `
    <div class="sidebar-header">
      <span>Annotations</span>
      <div class="header-actions">
        <label class="switch" title="Show/hide highlights (keeps this sidebar open)">
          <input type="checkbox" data-role="highlights-toggle" checked>
          <span class="slider"></span>
        </label>
        <button data-role="close" title="Close">×</button>
      </div>
    </div>
    <div class="doc-meta">
      <textarea class="doc-title" data-role="doc-title" rows="1" placeholder="Custom title…"></textarea>
      <textarea class="doc-subtitle" data-role="doc-subtitle" rows="1" placeholder="Subtitle…"></textarea>
    </div>
    <div class="doc-tags">
      <div class="section-label">Page tags</div>
      <div class="chips" data-role="doc-chips"></div>
      <input class="tag-add" data-role="doc-tag-add" placeholder="add tag…" />
    </div>
    <div class="annot-list" data-role="list"></div>
    <div class="sidebar-footer">
      <div class="footer-notice hidden" data-role="dirty-notice">
        <button class="notice-close" data-role="dirty-notice-close" title="Dismiss">×</button>
        <div class="notice-text">
          <b>⚠ Manual edits detected.</b> This page's <code>.org</code> has edits
          Meraki will overwrite on the next change — <b>Freeze</b> the page to keep
          them.
        </div>
      </div>
      <div class="footer-actions" data-role="footer-actions">
        <button class="footer-btn freeze-btn" data-role="freeze">🧊 Freeze</button>
        <button class="footer-btn delete-btn" data-role="delete-page">🗑 Delete page</button>
      </div>
      <div class="footer-confirm hidden" data-role="freeze-confirm">
        <div class="footer-warn">
          Archives this page's <code>.org</code> so the daemon never rewrites it
          again. <b>This can't be undone</b> — revisiting the page later starts a
          fresh, empty annotation set.
        </div>
        <div class="footer-confirm-actions">
          <button data-role="freeze-cancel">Cancel</button>
          <button class="danger" data-role="freeze-go">Freeze permanently</button>
        </div>
      </div>
      <div class="footer-confirm hidden" data-role="delete-confirm">
        <div class="footer-warn">
          Permanently removes this page's annotations, its <code>.org</code>
          file, and any saved images from Meraki. <b>This can't be undone.</b>
        </div>
        <div class="footer-confirm-actions">
          <button data-role="delete-cancel">Cancel</button>
          <button class="danger" data-role="delete-go">Delete permanently</button>
        </div>
      </div>
    </div>
    <div class="reconcile-overlay hidden" data-role="reconcile">
      <div class="reconcile-card">
        <div class="reconcile-title">⚠ This page's .org file is missing</div>
        <div class="reconcile-body">
          Its <code>.org</code> file was deleted on disk, but the annotations are
          still stored in Meraki. Choose what to do — <b>no new annotations can be
          made on this page until you resolve this</b>.
        </div>
        <div class="reconcile-actions">
          <button class="primary" data-role="reconcile-restore">Restore the .org file</button>
          <button class="danger" data-role="reconcile-delete">Delete the annotations</button>
        </div>
      </div>
    </div>
  `;
  shadow.appendChild(sidebar);

  sidebar.querySelector('[data-role="close"]').addEventListener("click", toggleSidebar);
  // Mutes highlighting (hides highlights + selection popup) but leaves the
  // sidebar open. The toolbar toggle is the master on/off that tears down the
  // whole on-page UI.
  sidebar
    .querySelector('[data-role="highlights-toggle"]')
    .addEventListener("change", (e) => {
      emit("highlights:set", e.target.checked);
    });
  // Custom title / subtitle: textareas so long text wraps and the field grows
  // in height. Auto-save debounced; export falls back to the page title when the
  // custom title is blank. Enter is suppressed so the stored value stays a single
  // line (it becomes #+TITLE: / #+SUBTITLE:), while long text still soft-wraps.
  for (const role of ["doc-title", "doc-subtitle"]) {
    const ta = sidebar.querySelector(`[data-role="${role}"]`);
    ta.addEventListener("input", () => {
      autoGrow(ta);
      scheduleDocMetaSave();
    });
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        ta.blur();
      }
    });
  }
  const tagAdd = sidebar.querySelector('[data-role="doc-tag-add"]');
  tagAdd.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && tagAdd.value.trim()) {
      addDocTag(tagAdd.value.trim());
      tagAdd.value = "";
    }
  });

  // Footer actions. Both freeze and delete are one-way and destroy the page's
  // live annotation set, so each uses a two-step confirm.
  sidebar.querySelector('[data-role="freeze"]').addEventListener("click", () => {
    if (state.size === 0) {
      showToast("Nothing to freeze on this page yet.");
      return;
    }
    showFooterConfirm("freeze-confirm");
  });
  sidebar.querySelector('[data-role="delete-page"]').addEventListener("click", () => {
    if (state.size === 0) {
      showToast("Nothing to delete on this page.");
      return;
    }
    showFooterConfirm("delete-confirm");
  });
  sidebar
    .querySelector('[data-role="freeze-cancel"]')
    .addEventListener("click", resetFooter);
  sidebar
    .querySelector('[data-role="delete-cancel"]')
    .addEventListener("click", resetFooter);
  sidebar.querySelector('[data-role="freeze-go"]').addEventListener("click", doFreeze);
  sidebar
    .querySelector('[data-role="delete-go"]')
    .addEventListener("click", doDeletePage);

  // Missing-file reconcile modal (blocking): restore regenerates the .org from
  // the DB; delete throws the annotations away. Either resolves the lock.
  sidebar
    .querySelector('[data-role="reconcile-restore"]')
    .addEventListener("click", doRestore);
  sidebar
    .querySelector('[data-role="reconcile-delete"]')
    .addEventListener("click", doDeletePage);

  // Dismissible dirty-file info notice (non-blocking, unlike the modal).
  sidebar
    .querySelector('[data-role="dirty-notice-close"]')
    .addEventListener("click", hideDirtyNotice);
}

// A persistent info banner in the footer (vs a toast that's easy to miss): the
// generated .org has manual edits that the next write will overwrite.
export function showDirtyNotice() {
  if (sidebar)
    sidebar.querySelector('[data-role="dirty-notice"]').classList.remove("hidden");
}

export function hideDirtyNotice() {
  if (sidebar)
    sidebar.querySelector('[data-role="dirty-notice"]').classList.add("hidden");
}

function showFooterConfirm(role) {
  sidebar.querySelector('[data-role="footer-actions"]').classList.add("hidden");
  sidebar.querySelector(`[data-role="${role}"]`).classList.remove("hidden");
}

function resetFooter() {
  if (!sidebar) return;
  sidebar.querySelector('[data-role="freeze-confirm"]').classList.add("hidden");
  sidebar.querySelector('[data-role="delete-confirm"]').classList.add("hidden");
  sidebar.querySelector('[data-role="footer-actions"]').classList.remove("hidden");
}

async function doFreeze() {
  const goBtn = sidebar.querySelector('[data-role="freeze-go"]');
  goBtn.disabled = true;
  const res = await send({
    type: "freeze_document",
    url: location.href,
    title: document.title,
  });
  goBtn.disabled = false;
  if (!res || !res.ok) {
    showToast(res && res.error ? `Freeze failed: ${res.error}` : "Freeze failed.");
    return;
  }
  resetFooter();
  emit("document:reload"); // the page comes back blank; annotations archived
  showToast(`Page frozen → ${res.data.org_filename}. Starting fresh.`);
}

async function doDeletePage() {
  const goBtn = sidebar.querySelector('[data-role="delete-go"]');
  goBtn.disabled = true;
  const res = await send({ type: "delete_document", url: location.href });
  goBtn.disabled = false;
  if (!res || !res.ok) {
    showToast(res && res.error ? `Delete failed: ${res.error}` : "Delete failed.");
    return;
  }
  resetFooter();
  hideReconcile(); // also resolves the missing-file modal, if open
  emit("document:reload"); // the page comes back blank; annotations removed
  showToast("Deleted this page's annotations.");
}

// A tiny always-present tab on the right edge to open the sidebar.
function buildSidebarTab(shadow) {
  const tab = document.createElement("button");
  tab.className = "sidebar-tab";
  tab.textContent = "✍";
  tab.title = "Annotations";
  tab.addEventListener("click", toggleSidebar);
  shadow.appendChild(tab);
}

function toggleSidebar() {
  if (session.reconciling) return; // a blocking modal owns the sidebar
  sidebarOpen = !sidebarOpen;
  sidebar.classList.toggle("hidden", !sidebarOpen);
  // A textarea's scrollHeight is 0 while display:none, so (re)fit the title /
  // subtitle heights once the sidebar is actually visible.
  if (sidebarOpen) refreshDocMetaSizes();
}

// Grow a textarea to fit its content (used by the title / subtitle fields).
function autoGrow(el) {
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

function refreshDocMetaSizes() {
  if (!sidebar) return;
  for (const role of ["doc-title", "doc-subtitle"]) {
    const ta = sidebar.querySelector(`[data-role="${role}"]`);
    if (ta) autoGrow(ta);
  }
}

// Close + reset (used when the whole UI is torn down on deactivate).
export function hideSidebar() {
  hideReconcile(); // clear the lock so a re-activate re-evaluates cleanly
  sidebarOpen = false;
  if (sidebar) sidebar.classList.add("hidden");
}

// The blocking "your .org file is missing" modal. Forces the sidebar open,
// covers it, and locks annotation creation (session.reconciling) until the user
// picks Restore or Delete. This is deliberately unmissable, unlike a toast.
export function showReconcile() {
  if (!sidebar) return;
  session.reconciling = true;
  sidebarOpen = true;
  sidebar.classList.remove("hidden");
  resetFooter(); // don't leave a footer confirm open behind the overlay
  sidebar.querySelector('[data-role="reconcile"]').classList.remove("hidden");
}

function hideReconcile() {
  session.reconciling = false;
  if (sidebar) {
    sidebar.querySelector('[data-role="reconcile"]').classList.add("hidden");
  }
}

async function doRestore() {
  const btn = sidebar.querySelector('[data-role="reconcile-restore"]');
  btn.disabled = true;
  const res = await send({ type: "restore_document", url: location.href });
  btn.disabled = false;
  if (!res || !res.ok) {
    showToast(res && res.error ? `Restore failed: ${res.error}` : "Restore failed.");
    return;
  }
  hideReconcile();
  emit("document:reload");
  showToast(`Restored this page's annotations → ${res.data.org_filename}.`);
}

export function setHighlightsToggle(checked) {
  const t = sidebar && sidebar.querySelector('[data-role="highlights-toggle"]');
  if (t) t.checked = checked;
}

// Populate the title/subtitle inputs and page tags from a freshly loaded page.
export function applyLoadedMeta({ customTitle, subtitle, pageTitle }) {
  sidebar.querySelector('[data-role="doc-title"]').value = customTitle || "";
  // Placeholder is the full page title (untruncated) -- it's the default that
  // export falls back to, and the textarea wraps/grows to show all of it.
  sidebar.querySelector('[data-role="doc-title"]').placeholder =
    pageTitle || "Custom title…";
  sidebar.querySelector('[data-role="doc-subtitle"]').value = subtitle || "";
  refreshDocMetaSizes(); // fit heights to the freshly loaded text
  renderDocTags();
}

// Order by where the highlight sits in the page (document order), not by
// creation order, so the list mirrors the reading flow. Works across text
// (range start node) and image (the <img> element) annotations via
// compareDocumentPosition; orphaned annotations (no located node) sink to the
// bottom.
function nodeOf(entry) {
  if (entry.el) return entry.el; // image
  if (entry.ranges[0]) return entry.ranges[0].startContainer; // text
  return null;
}

function byPageOrder(a, b) {
  const na = nodeOf(a);
  const nb = nodeOf(b);
  if (!na && !nb) return 0;
  if (!na) return 1;
  if (!nb) return -1;
  if (na === nb) return 0;
  const rel = na.compareDocumentPosition(nb);
  if (rel & Node.DOCUMENT_POSITION_FOLLOWING) return -1; // na precedes nb
  if (rel & Node.DOCUMENT_POSITION_PRECEDING) return 1;
  return 0;
}

function renderSidebarList() {
  const list = sidebar.querySelector('[data-role="list"]');
  const entries = [...state.values()].sort(byPageOrder);
  if (entries.length === 0) {
    list.innerHTML = `<div class="empty">No annotations on this page yet.</div>`;
    return;
  }
  list.innerHTML = "";
  for (const entry of entries) {
    const item = document.createElement("div");
    item.className = "annot-item" + (entry.orphaned ? " orphaned" : "");
    const tags = (entry.data.tags || [])
      .map((t) => `<span class="chip">${escapeHtml(t)}</span>`)
      .join("");
    if (entry.data.kind === "image") {
      item.innerHTML = `
        <button class="annot-del" title="Delete annotation">×</button>
        <img class="annot-thumb" src="${escapeHtml(entry.data.quote)}" alt="" />
        ${entry.data.note ? `<div class="annot-note">${escapeHtml(entry.data.note)}</div>` : ""}
        <div class="annot-tags">${tags}</div>
        ${entry.orphaned ? `<div class="orphan-tag">⚠ image not on page</div>` : ""}
      `;
      item.addEventListener("click", () => {
        if (!entry.el) return;
        const rect = entry.el.getBoundingClientRect();
        window.scrollTo({ top: window.scrollY + rect.top - 120, behavior: "smooth" });
      });
    } else {
      const swatch = `<span class="mini-swatch" style="background:${COLOR_CSS[entry.data.color]}"></span>`;
      item.innerHTML = `
        <button class="annot-del" title="Delete annotation">×</button>
        <div class="annot-quote">${swatch}${escapeHtml(truncate(entry.data.quote, 120))}</div>
        ${entry.data.note ? `<div class="annot-note">${escapeHtml(entry.data.note)}</div>` : ""}
        <div class="annot-tags">${tags}</div>
        ${entry.orphaned ? `<div class="orphan-tag">⚠ couldn't locate on page</div>` : ""}
      `;
      item.addEventListener("click", () => {
        if (entry.orphaned || !entry.ranges[0]) return;
        const r = entry.ranges[0];
        const rect = r.getBoundingClientRect();
        window.scrollTo({ top: window.scrollY + rect.top - 120, behavior: "smooth" });
        flashRange(r);
      });
    }
    const del = item.querySelector(".annot-del");
    del.addEventListener("click", (e) => {
      e.stopPropagation(); // don't trigger the item's scroll-to
      emit("remove", entry.data.id);
    });
    list.appendChild(item);
  }
}

function renderDocTags() {
  const chips = sidebar.querySelector('[data-role="doc-chips"]');
  chips.innerHTML = doc.tags
    .map(
      (t, i) =>
        `<span class="chip removable" data-i="${i}">${escapeHtml(t)}<span class="x">×</span></span>`
    )
    .join("");
  chips.querySelectorAll(".removable").forEach((c) => {
    c.querySelector(".x").addEventListener("click", () =>
      removeDocTag(parseInt(c.dataset.i, 10))
    );
  });
}

async function addDocTag(tag) {
  if (doc.tags.includes(tag)) return;
  doc.tags.push(tag);
  await persistDocTags();
  renderDocTags();
}

async function removeDocTag(i) {
  doc.tags.splice(i, 1);
  await persistDocTags();
  renderDocTags();
}

function persistDocTags() {
  return send({
    type: "update_document_tags",
    url: location.href,
    title: document.title,
    tags: doc.tags,
  });
}

function scheduleDocMetaSave() {
  if (docMetaTimer) clearTimeout(docMetaTimer);
  docMetaTimer = setTimeout(persistDocMeta, 400);
}

function persistDocMeta() {
  if (docMetaTimer) {
    clearTimeout(docMetaTimer);
    docMetaTimer = null;
  }
  const custom_title =
    sidebar.querySelector('[data-role="doc-title"]').value.trim() || null;
  const subtitle =
    sidebar.querySelector('[data-role="doc-subtitle"]').value.trim() || null;
  return send({
    type: "set_document_meta",
    url: location.href,
    title: document.title,
    custom_title,
    subtitle,
  });
}

on("annotations:changed", renderSidebarList);
