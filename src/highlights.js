// Highlight rendering via the CSS Custom Highlight API (§2.4): highlights are
// Range objects registered in CSS.highlights and painted by ::highlight() rules
// injected into the page -- never DOM nodes. This module owns the paint; it
// subscribes to "annotations:changed" and rebuilds from current state.

import { COLORS, COLOR_CSS } from "./constants.js";
import { on } from "./bus.js";
import { state } from "./store.js";
import { session } from "./session.js";

// Inject the per-color ::highlight() rules once.
export function ensureHighlightStyles() {
  if (document.getElementById("meraki-highlight-styles")) return;
  if (!("highlights" in CSS)) {
    console.warn("[meraki] CSS Custom Highlight API unavailable; need Firefox >= 140.");
    return;
  }
  const style = document.createElement("style");
  style.id = "meraki-highlight-styles";
  let css = "";
  for (const c of COLORS) {
    css += `::highlight(meraki-${c}) { background-color: ${COLOR_CSS[c]}; }\n`;
  }
  css += `::highlight(meraki-flash) { background-color: rgba(255,140,0,0.85); color: #000; }\n`;
  style.textContent = css;
  document.head.appendChild(style);
}

// Rebuild every CSS.highlights registry entry from current state.ranges.
export function renderAllHighlights() {
  if (!("highlights" in CSS)) return;
  if (!session.highlightsEnabled) { clearHighlights(); return; }
  ensureHighlightStyles();
  for (const c of COLORS) {
    const hl = new Highlight();
    for (const entry of state.values()) {
      if (entry.orphaned) continue;
      if (entry.data.color !== c) continue;
      for (const r of entry.ranges) hl.add(r);
    }
    CSS.highlights.set(`meraki-${c}`, hl);
  }
}

export function flashRange(range) {
  if (!("highlights" in CSS) || !range || !session.highlightsEnabled) return;
  const hl = new Highlight(range);
  CSS.highlights.set("meraki-flash", hl);
  setTimeout(() => CSS.highlights.delete("meraki-flash"), 1200);
}

export function clearHighlights() {
  if (!("highlights" in CSS)) return;
  for (const c of COLORS) CSS.highlights.delete(`meraki-${c}`);
  CSS.highlights.delete("meraki-flash");
}

// Geometric hit-test: is (x, y) inside a rectangle the highlight actually
// paints? Using the range's client rects (not caretPositionFromPoint) avoids
// false hits in blank space near the highlight.
export function pointInRange(range, x, y) {
  const rects = range.getClientRects();
  for (const rect of rects) {
    if (x >= rect.left && x <= rect.right &&
        y >= rect.top && y <= rect.bottom) {
      return true;
    }
  }
  return false;
}

// Two ranges overlap iff a.start < b.end AND a.end > b.start.
export function rangesOverlap(a, b) {
  try {
    return a.compareBoundaryPoints(Range.END_TO_START, b) < 0 &&
           a.compareBoundaryPoints(Range.START_TO_END, b) > 0;
  } catch (_) {
    return false;
  }
}

// Rebuild highlights whenever the annotation set changes. Registered at import
// time -- before the content IIFE runs -- so highlights repaint before the
// sidebar list (which subscribes later), preserving the original call order.
on("annotations:changed", renderAllHighlights);
