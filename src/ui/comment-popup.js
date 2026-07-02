// The editor popup for an existing annotation: note textarea, tags, color
// swatches, delete. Note/tags typing auto-saves (debounced); color changes save
// immediately. Opens in response to the "editor:open" bus event; deletions from
// the sidebar arrive as "remove".

import { COLORS, COLOR_CSS } from "../constants.js";
import { on } from "../bus.js";
import { send } from "../daemon.js";
import { state, changed } from "../store.js";

let commentPopup = null;
let editingId = null;
let saveTimer = null;

export function buildCommentPopup(shadow) {
  commentPopup = document.createElement("div");
  commentPopup.className = "popup comment-popup hidden";
  commentPopup.innerHTML = `
    <div class="swatches" data-role="colors"></div>
    <textarea class="note-input" placeholder="Add a note… (saves automatically)"></textarea>
    <input class="tags-input" placeholder="tags, comma separated" />
    <div class="popup-actions">
      <span class="save-status" data-role="status"></span>
      <button data-role="delete" class="danger">Delete</button>
    </div>
  `;
  const colorRow = commentPopup.querySelector('[data-role="colors"]');
  colorRow.innerHTML = COLORS.map(
    (c) => `<button class="swatch" data-color="${c}" style="background:${COLOR_CSS[c]}" title="${c}"></button>`
  ).join("");
  shadow.appendChild(commentPopup);

  // Auto-save: note/tags typing is debounced; color changes save immediately
  // (see selectCommentColor). Attach once -- the popup element is reused.
  commentPopup.querySelector(".note-input").addEventListener("input", scheduleSave);
  commentPopup.querySelector(".tags-input").addEventListener("input", scheduleSave);
}

export function openCommentPopup(id, rect) {
  const entry = state.get(id);
  if (!entry) return;
  editingId = id;
  commentPopup.querySelector(".note-input").value = entry.data.note || "";
  commentPopup.querySelector(".tags-input").value = (entry.data.tags || []).join(", ");
  commentPopup.querySelectorAll(".swatch").forEach((s) => {
    s.classList.toggle("selected", s.dataset.color === entry.data.color);
    s.onclick = () => selectCommentColor(s.dataset.color);
  });
  commentPopup.dataset.color = entry.data.color;
  setSaveStatus("");

  commentPopup.querySelector('[data-role="delete"]').onclick = deleteCurrent;

  commentPopup.classList.remove("hidden");
  // Viewport coordinates (position:fixed). Place below the highlight, or
  // above if it would overflow the bottom edge.
  const h = commentPopup.offsetHeight || 160;
  let top = rect.bottom + 8;
  if (top + h > window.innerHeight - 4) top = Math.max(4, rect.top - h - 8);
  let left = Math.max(4, rect.left);
  left = Math.min(left, window.innerWidth - commentPopup.offsetWidth - 4);
  commentPopup.style.top = `${top}px`;
  commentPopup.style.left = `${left}px`;
}

function selectCommentColor(color) {
  commentPopup.dataset.color = color;
  commentPopup.querySelectorAll(".swatch").forEach((s) =>
    s.classList.toggle("selected", s.dataset.color === color));
  flushSave();   // color changes persist immediately (and re-render the highlight)
}

export function hideCommentPopup() {
  if (!commentPopup) return;
  if (editingId) flushSave();   // persist any pending edits before closing
  commentPopup.classList.add("hidden");
  editingId = null;
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  setSaveStatus("Saving…");
  saveTimer = setTimeout(flushSave, 400);
}

async function flushSave() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  const id = editingId;                 // capture synchronously
  if (!id) return;
  const entry = state.get(id);
  if (!entry) return;
  const note = commentPopup.querySelector(".note-input").value;
  const color = commentPopup.dataset.color;
  const tags = commentPopup.querySelector(".tags-input").value
    .split(",").map((t) => t.trim()).filter(Boolean);
  // Update local state + re-render first so the UI feels instant; the note
  // text lives in the popup, which re-rendering the sidebar/highlights leaves
  // untouched, so typing focus is preserved.
  entry.data.note = note;
  entry.data.color = color;
  entry.data.tags = tags;
  changed();
  const res = await send({ type: "update_annotation", id, note, color, tags });
  if (!res || !res.ok) { console.warn("[meraki] update failed", res); return; }
  setSaveStatus("Saved");
}

function setSaveStatus(text) {
  const el = commentPopup && commentPopup.querySelector('[data-role="status"]');
  if (!el) return;
  el.textContent = text;
  if (setSaveStatus._t) clearTimeout(setSaveStatus._t);
  if (text === "Saved") {
    setSaveStatus._t = setTimeout(() => { el.textContent = ""; }, 1500);
  }
}

function deleteCurrent() {
  if (editingId) removeAnnotation(editingId);
}

// Delete one annotation by id -- reached from the popup's Delete button
// (directly) and the sidebar's per-item delete (via the "remove" bus event).
async function removeAnnotation(id) {
  // If it's the one open in the editor, close WITHOUT flushing a save (that
  // would resurrect the row we're about to delete).
  if (editingId === id) {
    editingId = null;
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    if (commentPopup) commentPopup.classList.add("hidden");
  }
  state.delete(id);
  changed();
  const res = await send({ type: "delete_annotation", id });
  if (!res || !res.ok) console.warn("[meraki] delete failed", res);
}

on("editor:open", ({ id, rect }) => openCommentPopup(id, rect));
on("remove", (id) => removeAnnotation(id));
