// A minimal, dependency-free toast used only for the "this page has
// annotations" nudge shown while the plugin is off. Deliberately NOT part of
// the annotation shadow UI: when the plugin is off we build none of that -- no
// shadow root, no highlights, no sidebar -- just this one transient element.
// `all: initial` sheds inherited page styles so a bare <div> is enough.

let toastEl = null;
let fadeTimer = null;
let killTimer = null;

export function showToast(message, timeout = 6000) {
  dismissToast();
  const el = document.createElement("div");
  toastEl = el;
  el.textContent = message;
  el.style.cssText = [
    "all: initial",
    "position: fixed",
    "bottom: 20px",
    "right: 20px",
    "z-index: 2147483647",
    "max-width: 300px",
    "padding: 12px 14px",
    "background: #1f2430",
    "color: #e6e6e6",
    "font: 13px/1.45 system-ui, sans-serif",
    "border: 1px solid #3a4152",
    "border-radius: 8px",
    "box-shadow: 0 4px 18px rgba(0,0,0,0.35)",
    "opacity: 0",
    "transition: opacity 0.2s ease",
    "pointer-events: none", // never intercept clicks meant for the page
  ].join(";");
  document.documentElement.appendChild(el);

  // Fade in on the next frame (the element must be in the DOM first).
  requestAnimationFrame(() => { if (toastEl === el) el.style.opacity = "1"; });

  fadeTimer = setTimeout(() => {
    if (toastEl !== el) return;
    el.style.opacity = "0";
    killTimer = setTimeout(() => { if (toastEl === el) dismissToast(); }, 250);
  }, timeout);
}

export function dismissToast() {
  if (fadeTimer) { clearTimeout(fadeTimer); fadeTimer = null; }
  if (killTimer) { clearTimeout(killTimer); killTimer = null; }
  if (toastEl) { toastEl.remove(); toastEl = null; }
}
