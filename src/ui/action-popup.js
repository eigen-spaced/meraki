// The small popup that appears above a fresh selection: color swatches + a
// "+ note" button. It doesn't create anything itself -- clicking a choice emits
// "create" on the bus, which the selection orchestrator turns into a highlight.

import { COLORS, COLOR_CSS } from "../constants.js";
import { emit } from "../bus.js";

let actionPopup = null;

export function buildActionPopup(shadow) {
  actionPopup = document.createElement("div");
  actionPopup.className = "popup action-popup hidden";
  const swatches = COLORS.map(
    (c) => `<button class="swatch" data-color="${c}" style="background:${COLOR_CSS[c]}" title="${c}"></button>`
  ).join("");
  actionPopup.innerHTML = `
    <div class="swatches">${swatches}</div>
    <button class="note-btn" title="Highlight and add a note">+ note</button>
  `;
  shadow.appendChild(actionPopup);

  actionPopup.querySelectorAll(".swatch").forEach((b) => {
    b.addEventListener("mousedown", (e) => e.preventDefault());
    b.addEventListener("click", () =>
      emit("create", { color: b.dataset.color, withNote: false }));
  });
  const noteBtn = actionPopup.querySelector(".note-btn");
  noteBtn.addEventListener("mousedown", (e) => e.preventDefault());
  noteBtn.addEventListener("click", () =>
    emit("create", { color: "yellow", withNote: true }));
}

export function showActionPopup(rect) {
  // Popups are position:fixed, so use viewport coordinates from
  // getBoundingClientRect directly -- no scroll offset. Prefer placing the
  // popup above the selection; drop below if there isn't room.
  actionPopup.classList.remove("hidden");
  const h = actionPopup.offsetHeight || 40;
  let top = rect.top - h - 8;
  if (top < 4) top = rect.bottom + 8;   // no room above -> below
  let left = Math.max(4, rect.left);
  left = Math.min(left, window.innerWidth - actionPopup.offsetWidth - 4);
  actionPopup.style.top = `${top}px`;
  actionPopup.style.left = `${left}px`;
}

export function hideActionPopup() {
  if (actionPopup) actionPopup.classList.add("hidden");
}
