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
  // This can appear with no shadow UI (the off-state nudge), so it can't rely on
  // the themed wrapper or bundled fonts -- pick the editorial palette by the OS
  // scheme and use system fonts (the design's declared fallback).
  const dark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  const bg = dark ? "#241E15" : "#FBF7EE";
  const fg = dark ? "#F0E7D3" : "#201A12";
  const border = dark ? "#3B3325" : "#E0D6BE";
  const shadow = dark ? "0 16px 44px rgba(0,0,0,0.55)" : "0 12px 32px rgba(80,62,30,0.18)";
  el.style.cssText = [
    "all: initial",
    "position: fixed",
    "bottom: 24px",
    "left: 50%",
    "transform: translateX(-50%)",
    "z-index: 2147483647",
    "max-width: 420px",
    "padding: 12px 16px",
    `background: ${bg}`,
    `color: ${fg}`,
    "font: 13px/1.45 -apple-system, 'Helvetica Neue', sans-serif",
    `border: 1px solid ${border}`,
    "border-radius: 10px",
    `box-shadow: ${shadow}`,
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
