// The small pill that appears above a fresh selection: colour dots + an
// icon-only "add note" button. It doesn't create anything itself -- clicking a
// choice emits "create" on the bus, which the selection orchestrator turns into
// a highlight.

import { COLORS, HL_VAR } from "../constants.js";
import { ICONS } from "../styles.js";
import { emit } from "../bus.js";

let actionPopup = null;

export function buildActionPopup(scope) {
  actionPopup = document.createElement("div");
  actionPopup.className = "mk-toolbar mk-fixed hidden";
  const dots = COLORS.map(
    (c) => `<button class="mk-dot" data-color="${c}" ` +
      `style="--dot: var(${HL_VAR[c]})" aria-label="Highlight ${c}" title="${c}"></button>`,
  ).join("");
  actionPopup.innerHTML = `
    <div class="mk-dotrow">${dots}</div>
    <div class="mk-divider"></div>
    <button class="mk-btn-icon mk-btn-icon--sm mk-tooltip" data-tip="Add note"
            aria-label="Highlight and add a note">${ICONS.pencil}</button>
  `;
  scope.appendChild(actionPopup);

  actionPopup.querySelectorAll(".mk-dot").forEach((b) => {
    b.addEventListener("mousedown", (e) => e.preventDefault());
    b.addEventListener("click", () =>
      emit("create", { color: b.dataset.color, withNote: false }));
  });
  const noteBtn = actionPopup.querySelector(".mk-btn-icon");
  noteBtn.addEventListener("mousedown", (e) => e.preventDefault());
  noteBtn.addEventListener("click", () =>
    emit("create", { color: "yellow", withNote: true }));
}

export function showActionPopup(rect) {
  // Popups are position:fixed, so use viewport coordinates from
  // getBoundingClientRect directly -- no scroll offset. Prefer placing the
  // popup above the selection; drop below if there isn't room.
  actionPopup.classList.remove("hidden");
  const h = actionPopup.offsetHeight || 44;
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
