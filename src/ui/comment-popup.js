// The editor popup for an existing annotation: colour dots, the selected-text
// excerpt, a note textarea, tags, delete, and an explicit Save. Note/tags are
// committed on Save (button, or Cmd/Ctrl+Enter in the note / Enter in tags) --
// not auto-saved. Colour changes still persist immediately so the on-page
// highlight updates as feedback. Opens on "editor:open"; deletions arrive as
// "remove".

import { COLORS, HL_VAR } from "../constants.js";
import { ICONS } from "../styles.js";
import { truncate, escapeHtml } from "../helpers.js";
import { on } from "../bus.js";
import { send } from "../daemon.js";
import { state, changed } from "../store.js";

let commentPopup = null;
let editingId = null;

export function buildCommentPopup(scope) {
  commentPopup = document.createElement("div");
  commentPopup.className = "mk-panel mk-editor mk-fixed hidden";
  commentPopup.innerHTML = `
    <div class="mk-dotrow" data-role="colors"></div>
    <div class="mk-excerpt" data-role="excerpt"></div>
    <textarea class="mk-input mk-input--note" data-role="note"
              placeholder="Add a note…"></textarea>
    <input class="mk-input mk-input--tags" data-role="tags"
           placeholder=":tags: comma, separated" />
    <div class="mk-panel-footer">
      <button class="mk-btn-icon mk-btn-icon--danger mk-tooltip" data-role="delete"
              data-tip="Delete" aria-label="Delete annotation">${ICONS.trash}</button>
      <div style="display:flex; align-items:center; gap:10px;">
        <span class="mk-status" data-role="status"></span>
        <button class="mk-btn-primary" data-role="save">Save <span aria-hidden="true">⏎</span></button>
      </div>
    </div>
  `;
  const colorRow = commentPopup.querySelector('[data-role="colors"]');
  colorRow.innerHTML = COLORS.map(
    (c) => `<button class="mk-dot mk-dot--sm" data-color="${c}" ` +
      `style="--dot: var(${HL_VAR[c]})" aria-label="${c}" title="${c}"></button>`,
  ).join("");
  scope.appendChild(commentPopup);

  commentPopup.querySelector('[data-role="save"]').addEventListener("click", () => save(true));
  commentPopup.querySelector('[data-role="delete"]').addEventListener("click", deleteCurrent);

  // Cmd/Ctrl+Enter saves from the (multi-line) note; plain Enter stays a newline.
  commentPopup.querySelector('[data-role="note"]').addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(false); }
  });
  // The tags field is single-line: plain Enter saves.
  commentPopup.querySelector('[data-role="tags"]').addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); save(false); }
  });
  // Typing invalidates the "Saved" status so it never looks stale.
  for (const role of ["note", "tags"]) {
    commentPopup.querySelector(`[data-role="${role}"]`).addEventListener("input", () => setStatus(""));
  }
}

export function openCommentPopup(id, rect) {
  const entry = state.get(id);
  if (!entry) return;
  editingId = id;
  commentPopup.querySelector('[data-role="note"]').value = entry.data.note || "";
  commentPopup.querySelector('[data-role="tags"]').value = (entry.data.tags || []).join(", ");
  const excerpt = commentPopup.querySelector('[data-role="excerpt"]');
  excerpt.textContent = truncate(entry.data.quote || "", 160);
  excerpt.classList.toggle("hidden", !entry.data.quote);
  applyColorSelection(entry.data.color);
  commentPopup.querySelectorAll(".mk-dot").forEach((s) => {
    s.onclick = () => selectCommentColor(s.dataset.color);
  });
  setStatus("");

  commentPopup.classList.remove("hidden");
  // Viewport coordinates (position:fixed). Place below the highlight, or above
  // if it would overflow the bottom edge.
  const h = commentPopup.offsetHeight || 200;
  let top = rect.bottom + 8;
  if (top + h > window.innerHeight - 4) top = Math.max(4, rect.top - h - 8);
  let left = Math.max(4, rect.left);
  left = Math.min(left, window.innerWidth - commentPopup.offsetWidth - 4);
  commentPopup.style.top = `${top}px`;
  commentPopup.style.left = `${left}px`;
  commentPopup.querySelector('[data-role="note"]').focus();
}

function applyColorSelection(color) {
  commentPopup.dataset.color = color;
  commentPopup.style.setProperty("--mk-hl-current", `var(${HL_VAR[color] || HL_VAR.yellow})`);
  commentPopup.querySelectorAll(".mk-dot").forEach((s) =>
    s.setAttribute("aria-pressed", String(s.dataset.color === color)));
}

function selectCommentColor(color) {
  applyColorSelection(color);
  save(false);   // colour changes persist immediately (and re-render the highlight)
}

export function hideCommentPopup() {
  if (!commentPopup) return;
  commentPopup.classList.add("hidden");
  editingId = null;
}

async function save(showSaved) {
  const id = editingId;                 // capture synchronously
  if (!id) return;
  const entry = state.get(id);
  if (!entry) return;
  const note = commentPopup.querySelector('[data-role="note"]').value;
  const color = commentPopup.dataset.color;
  const tags = commentPopup.querySelector('[data-role="tags"]').value
    .split(",").map((t) => t.trim()).filter(Boolean);
  // Update local state + re-render first so the UI feels instant; the note text
  // lives in the popup, which re-rendering leaves untouched, so focus is kept.
  entry.data.note = note;
  entry.data.color = color;
  entry.data.tags = tags;
  changed();
  setStatus("Saving…");
  const res = await send({ type: "update_annotation", id, note, color, tags });
  if (!res || !res.ok) { console.warn("[meraki] update failed", res); setStatus("Save failed"); return; }
  if (showSaved) setStatus("Saved"); else setStatus("");
}

function setStatus(text) {
  const el = commentPopup && commentPopup.querySelector('[data-role="status"]');
  if (!el) return;
  el.textContent = text;
  if (setStatus._t) clearTimeout(setStatus._t);
  if (text === "Saved") setStatus._t = setTimeout(() => { el.textContent = ""; }, 1500);
}

function deleteCurrent() {
  if (editingId) removeAnnotation(editingId);
}

// Delete one annotation by id -- reached from the popup's Delete button
// (directly) and the sidebar's per-item delete (via the "remove" bus event).
async function removeAnnotation(id) {
  if (editingId === id) {
    editingId = null;
    if (commentPopup) commentPopup.classList.add("hidden");
  }
  state.delete(id);
  changed();
  const res = await send({ type: "delete_annotation", id });
  if (!res || !res.ok) console.warn("[meraki] delete failed", res);
}

on("editor:open", ({ id, rect }) => openCommentPopup(id, rect));
on("remove", (id) => removeAnnotation(id));
