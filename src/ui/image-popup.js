// Popup for image annotations: a thumbnail, a required note, and tags. Two
// modes -- create (Save enabled once a note is typed; the actual persist is a
// callback into images.js so this stays UI-only) and edit (auto-saves note/tags
// like the comment popup, with Delete). Images aren't highlighted, so there's no
// color or quote block here.

import { send } from "../daemon.js";
import { emit } from "../bus.js";
import { state, changed } from "../store.js";

let imagePopup = null;
let mode = null;         // "create" | "edit"
let createCb = null;     // create mode: (note, tags) => void
let editingId = null;    // edit mode
let saveTimer = null;

export function buildImagePopup(shadow) {
  imagePopup = document.createElement("div");
  imagePopup.className = "popup image-popup hidden";
  imagePopup.innerHTML = `
    <img class="thumb" alt="" />
    <textarea class="note-input" placeholder="Add a note… (required)"></textarea>
    <input class="tags-input" placeholder="tags, comma separated" />
    <div class="popup-actions">
      <span class="save-status" data-role="status"></span>
      <button data-role="save">Save</button>
      <button data-role="delete" class="danger">Delete</button>
    </div>
  `;
  shadow.appendChild(imagePopup);

  const noteEl = imagePopup.querySelector(".note-input");
  const saveBtn = imagePopup.querySelector('[data-role="save"]');
  noteEl.addEventListener("input", () => {
    if (mode === "create") saveBtn.disabled = !noteEl.value.trim();
    else scheduleEditSave();
  });
  imagePopup.querySelector(".tags-input").addEventListener("input", () => {
    if (mode === "edit") scheduleEditSave();
  });
  saveBtn.addEventListener("click", commitCreate);
  imagePopup.querySelector('[data-role="delete"]').addEventListener("click", () => {
    if (editingId) { emit("remove", editingId); hideImagePopup(); }
  });
}

export function openImageCreate(img, onSave) {
  mode = "create";
  createCb = onSave;
  editingId = null;
  fill(img.currentSrc || img.src, "", []);
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
  imagePopup.querySelector(".thumb").src = src;
  imagePopup.querySelector(".note-input").value = note;
  imagePopup.querySelector(".tags-input").value = tags.join(", ");
}

function show({ save, saveEnabled = true, del }) {
  const saveBtn = imagePopup.querySelector('[data-role="save"]');
  saveBtn.classList.toggle("hidden", !save);
  saveBtn.disabled = !saveEnabled;
  imagePopup.querySelector('[data-role="delete"]').classList.toggle("hidden", !del);
  imagePopup.classList.remove("hidden");
}

function position(rect) {
  const h = imagePopup.offsetHeight || 220;
  let top = rect.bottom + 8;
  if (top + h > window.innerHeight - 4) top = Math.max(4, rect.top - h - 8);
  let left = Math.max(4, rect.left);
  left = Math.min(left, window.innerWidth - imagePopup.offsetWidth - 4);
  imagePopup.style.top = `${top}px`;
  imagePopup.style.left = `${left}px`;
}

function readTags() {
  return imagePopup.querySelector(".tags-input").value
    .split(",").map((t) => t.trim()).filter(Boolean);
}

function commitCreate() {
  if (mode !== "create") return;
  const note = imagePopup.querySelector(".note-input").value.trim();
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
  const note = imagePopup.querySelector(".note-input").value;
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
