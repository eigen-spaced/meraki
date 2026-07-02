// The shadow-DOM host: a single zero-footprint element anchored at the viewport
// origin, with an open shadow root that all Meraki UI (popups + sidebar) lives
// in. Isolating the UI here keeps host-page CSS out and our CSS in.

import { SHADOW_CSS } from "../styles.js";

let shadowHost = null;
let shadowRoot = null;

// Create the host + shadow root, inject the stylesheet, and return the root so
// the popup/sidebar builders can append into it.
export function initShadow() {
  const host = document.createElement("div");
  shadowHost = host;
  host.id = "meraki-annotator-root";
  // Anchor at the viewport origin with zero footprint so it never blocks the
  // page; the fixed-position popups/sidebar inside position themselves.
  host.style.cssText =
    "all: initial; position: fixed; top: 0; left: 0; width: 0; height: 0; z-index: 2147483647;";
  document.documentElement.appendChild(host);
  shadowRoot = host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = SHADOW_CSS;
  shadowRoot.appendChild(style);

  // Site hotkey libraries (e.g. GitHub's) listen for single-key shortcuts on
  // document in the bubble phase. Key events from our shadow UI bubble out
  // retargeted to the host -- which looks like a non-input element to the
  // page -- so the site treats our typing as hotkeys and steals focus (e.g.
  // to its search box). Keep events originating in our UI from reaching the
  // page. Our own inner listeners (deeper in the tree) have already fired by
  // the time propagation reaches the shadow root, so this doesn't break them.
  for (const type of ["keydown", "keypress", "keyup", "input"]) {
    shadowRoot.addEventListener(type, (e) => e.stopPropagation());
  }

  return shadowRoot;
}

export function getShadow() {
  return shadowRoot;
}

// True if node lives inside our shadow host, so page-level handlers can ignore
// interactions with our own UI.
export function isInOurUI(node) {
  return !!shadowHost && shadowHost.contains(node);
}

export function showHost() {
  if (shadowHost) shadowHost.style.display = "";
}

export function hideHost() {
  if (shadowHost) shadowHost.style.display = "none";
}
