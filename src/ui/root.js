// The shadow-DOM host: a single zero-footprint element anchored at the viewport
// origin, with an open shadow root that all Meraki UI (popups + sidebar) lives
// in. Isolating the UI here keeps host-page CSS out and our CSS in.

import { SHADOW_CSS } from "../styles.js";
import { initTheme, resolveTheme } from "../theme.js";

let shadowHost = null;
let shadowRoot = null;
let scope = null;   // themed wrapper all UI lives inside

// Bundled web fonts (Lora, JetBrains Mono). @font-face is ignored inside shadow
// roots, so register them at document level from the extension's URLs (the files
// are web_accessible_resources). Fallbacks (Georgia / ui-monospace) cover the
// rare page whose CSP blocks the load.
function injectFontFaces() {
  if (document.getElementById("meraki-fonts")) return;
  const url = (f) => browser.runtime.getURL("fonts/" + f);
  const face = (family, file, weight, style) =>
    `@font-face{font-family:'${family}';src:url('${url(file)}') format('woff2');` +
    `font-weight:${weight};font-style:${style};font-display:swap;}`;
  const css = [
    face("Lora", "Lora-400.woff2", 400, "normal"),
    face("Lora", "Lora-500.woff2", 500, "normal"),
    face("Lora", "Lora-600.woff2", 600, "normal"),
    face("Lora", "Lora-400-italic.woff2", 400, "italic"),
    face("Lora", "Lora-500-italic.woff2", 500, "italic"),
    face("Lora", "Lora-600-italic.woff2", 600, "italic"),
    face("JetBrains Mono", "JetBrainsMono-400.woff2", 400, "normal"),
    face("JetBrains Mono", "JetBrainsMono-500.woff2", 500, "normal"),
    face("JetBrains Mono", "JetBrainsMono-600.woff2", 600, "normal"),
  ].join("");
  const el = document.createElement("style");
  el.id = "meraki-fonts";
  el.textContent = css;
  (document.head || document.documentElement).appendChild(el);
}

// Create the host + shadow root, inject the stylesheet, and return the themed
// wrapper so the popup/sidebar builders can append into it.
export function initShadow() {
  injectFontFaces();
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

  // All UI lives inside this wrapper; it carries the theme tokens. Set a
  // synchronous default from the OS scheme to avoid a flash, then initTheme
  // refines it from the stored setting and keeps it live.
  scope = document.createElement("div");
  scope.className = "mk-scope";
  scope.setAttribute("data-meraki-theme", resolveTheme("auto"));
  shadowRoot.appendChild(scope);
  initTheme(scope);

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

  return scope;
}

export function getShadow() {
  return scope;
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
