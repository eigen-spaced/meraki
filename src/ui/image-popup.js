// Popup for image / diagram annotations: a thumbnail, a required note, and tags.
// Two modes -- create (Save enabled once a note is typed; the actual persist is a
// callback into images.js so this stays UI-only) and edit (auto-saves note/tags
// like a live field, with Delete). Images aren't highlighted, so there's no
// colour or excerpt block here.

import { ICONS } from "../styles.js";
import { send } from "../daemon.js";
import { emit } from "../bus.js";
import { state, changed } from "../store.js";

let imagePopup = null;
let mode = null;         // "create" | "edit"
let createCb = null;     // create mode: (note, tags) => void
let editingId = null;    // edit mode
let saveTimer = null;

export function buildImagePopup(scope) {
  imagePopup = document.createElement("div");
  imagePopup.className = "mk-panel mk-editor mk-fixed hidden";
  imagePopup.innerHTML = `
    <img class="mk-thumb" data-role="thumb" alt="" />
    <textarea class="mk-input mk-input--note" data-role="note"
              placeholder="Add a note… (required)"></textarea>
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
  scope.appendChild(imagePopup);

  const noteEl = imagePopup.querySelector('[data-role="note"]');
  const saveBtn = imagePopup.querySelector('[data-role="save"]');
  noteEl.addEventListener("input", () => {
    if (mode === "create") saveBtn.disabled = !noteEl.value.trim();
    else scheduleEditSave();
  });
  noteEl.addEventListener("keydown", (e) => {
    if (mode === "create" && e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault(); commitCreate();
    }
  });
  imagePopup.querySelector('[data-role="tags"]').addEventListener("input", () => {
    if (mode === "edit") scheduleEditSave();
  });
  saveBtn.addEventListener("click", commitCreate);
  imagePopup.querySelector('[data-role="delete"]').addEventListener("click", () => {
    if (editingId) { emit("remove", editingId); hideImagePopup(); }
  });
}

export function openImageCreate(img, onSave, previewSrc) {
  mode = "create";
  createCb = onSave;
  editingId = null;
  // Inline svgs have no URL, so callers pass a rasterised data-URL preview.
  fill(previewSrc || img.currentSrc || img.src, "", []);
  show({ save: true, saveEnabled: false, del: false });
  position(img.getBoundingClientRect());
}

export function openImageEditor(id) {
  const entry = state.get(id);
  if (!entry) return;
  mode = "edit";
  editingId = id;
  createCb = null;
  fill(entry.data.quote, entry.data.note || "", entry.data.tags || []);
  show({ save: false, del: true });
  setSaveStatus("");
  position(entry.el ? entry.el.getBoundingClientRect()
                    : { top: 80, bottom: 80, left: 40 });
}

function fill(src, note, tags) {
  // A raw "svg:" signature isn't a loadable image (an inline-svg annotation
  // being edited); show no thumbnail rather than a broken one.
  const thumb = imagePopup.querySelector('[data-role="thumb"]');
  const usable = src && !src.startsWith("svg:");
  thumb.classList.toggle("hidden", !usable);
  thumb.src = usable ? src : "";
  imagePopup.querySelector('[data-role="note"]').value = note;
  imagePopup.querySelector('[data-role="tags"]').value = tags.join(", ");
}

function show({ save, saveEnabled = true, del }) {
  const saveBtn = imagePopup.querySelector('[data-role="save"]');
  saveBtn.classList.toggle("hidden", !save);
  saveBtn.disabled = !saveEnabled;
  imagePopup.querySelector('[data-role="delete"]').classList.toggle("hidden", !del);
  imagePopup.classList.remove("hidden");
}

function position(rect) {
  const h = imagePopup.offsetHeight || 240;
  let top = rect.bottom + 8;
  if (top + h > window.innerHeight - 4) top = Math.max(4, rect.top - h - 8);
  let left = Math.max(4, rect.left);
  left = Math.min(left, window.innerWidth - imagePopup.offsetWidth - 4);
  imagePopup.style.top = `${top}px`;
  imagePopup.style.left = `${left}px`;
}

function readTags() {
  return imagePopup.querySelector('[data-role="tags"]').value
    .split(",").map((t) => t.trim()).filter(Boolean);
}

function commitCreate() {
  if (mode !== "create") return;
  const note = imagePopup.querySelector('[data-role="note"]').value.trim();
  if (!note) return;               // required
  const tags = readTags();
  const cb = createCb;
  hideImagePopup();
  if (cb) cb(note, tags);
}

function scheduleEditSave() {
  if (saveTimer) clearTimeout(saveTimer);
  setSaveStatus("Saving…");
  saveTimer = setTimeout(flushEditSave, 400);
}

async function flushEditSave() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  const id = editingId;
  if (!id) return;
  const entry = state.get(id);
  if (!entry) return;
  const note = imagePopup.querySelector('[data-role="note"]').value;
  const tags = readTags();
  entry.data.note = note;
  entry.data.tags = tags;
  changed();
  const res = await send({ type: "update_annotation", id, note, color: null, tags });
  if (!res || !res.ok) { console.warn("[meraki] image note save failed", res); return; }
  setSaveStatus("Saved");
}

function setSaveStatus(text) {
  const el = imagePopup && imagePopup.querySelector('[data-role="status"]');
  if (!el) return;
  el.textContent = text;
  if (setSaveStatus._t) clearTimeout(setSaveStatus._t);
  if (text === "Saved") {
    setSaveStatus._t = setTimeout(() => { el.textContent = ""; }, 1500);
  }
}

export function hideImagePopup() {
  if (!imagePopup) return;
  if (mode === "edit" && editingId) flushEditSave();   // persist pending edits
  imagePopup.classList.add("hidden");
  mode = null;
  editingId = null;
  createCb = null;
}
