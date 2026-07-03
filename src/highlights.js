// Highlight rendering via the CSS Custom Highlight API (§2.4): highlights are
// Range objects registered in CSS.highlights and painted by ::highlight() rules
// injected into the page -- never DOM nodes. This module owns the paint; it
// subscribes to "annotations:changed" and rebuilds from current state.

import { COLORS, HL } from "./constants.js";
import { on } from "./bus.js";
import { state } from "./store.js";
import { session } from "./session.js";

// Inject the per-color ::highlight() rules once. Each colour has a plain variant
// (wash tint) and a "-noted" variant that adds a 2px underline in the solid dot
// colour, so annotations carrying a note read differently on the page.
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
    css += `::highlight(meraki-${c}) { background-color: ${HL[c].wash}; }\n`;
    css += `::highlight(meraki-${c}-noted) { background-color: ${HL[c].wash};` +
      ` text-decoration: underline; text-decoration-color: ${HL[c].dot};` +
      ` text-decoration-thickness: 2px; text-underline-offset: 2px; }\n`;
  }
  css += `::highlight(meraki-flash) { background-color: rgba(216,164,65,0.9); color: #201a12; }\n`;
  style.textContent = css;
  document.head.appendChild(style);
}

// Rebuild every CSS.highlights registry entry from current state.ranges. Noted
// and un-noted ranges of the same colour go to separate registries so only the
// noted ones get the underline.
export function renderAllHighlights() {
  if (!("highlights" in CSS)) return;
  if (!session.highlightsEnabled) { clearHighlights(); return; }
  ensureHighlightStyles();
  for (const c of COLORS) {
    const plain = new Highlight();
    const noted = new Highlight();
    for (const entry of state.values()) {
      if (entry.orphaned) continue;
      if (entry.data.color !== c) continue;
      const target = entry.data.note ? noted : plain;
      for (const r of entry.ranges) target.add(r);
    }
    CSS.highlights.set(`meraki-${c}`, plain);
    CSS.highlights.set(`meraki-${c}-noted`, noted);
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
  for (const c of COLORS) {
    CSS.highlights.delete(`meraki-${c}`);
    CSS.highlights.delete(`meraki-${c}-noted`);
  }
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
