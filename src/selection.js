// Selection orchestration: turn a text selection into a highlight (or, when it
// overlaps an existing one, open that annotation's editor), plus the click
// hit-test that opens the editor when a painted highlight is clicked. Creation
// requests arrive as "create" from the action popup; opening an editor is
// announced as "editor:open" for the comment popup to consume.

import { send } from "./daemon.js";
import { captureAnchor } from "./anchoring.js";
import { on, emit } from "./bus.js";
import { state, changed } from "./store.js";
import { rangesOverlap, pointInRange } from "./highlights.js";
import { isInOurUI } from "./ui/root.js";
import { showActionPopup, hideActionPopup } from "./ui/action-popup.js";
import { showToast } from "./ui/toast.js";

let lastSelectionRange = null;

export function handleSelection() {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed) { hideActionPopup(); return; }
  const str = sel.toString().trim();
  if (!str) { hideActionPopup(); return; }
  const range = sel.getRangeAt(0);
  // Ignore selections inside our own UI.
  if (isInOurUI(range.commonAncestorContainer)) return;

  // One highlight per text region: if the selection overlaps an existing
  // highlight, don't offer to create a second one on top of it. Open that
  // annotation for editing instead so the gesture still does something useful.
  const hit = findOverlappingAnnotation(range);
  if (hit) {
    hideActionPopup();
    const rect = range.getBoundingClientRect();
    window.getSelection().removeAllRanges();
    emit("editor:open", { id: hit.id, rect });
    return;
  }

  lastSelectionRange = range.cloneRange();
  const rect = range.getBoundingClientRect();
  showActionPopup(rect);
}

function findOverlappingAnnotation(range) {
  for (const [id, entry] of state) {
    if (entry.orphaned) continue;
    for (const r of entry.ranges) {
      if (rangesOverlap(range, r)) return { id, entry };
    }
  }
  return null;
}

async function createFromSelection(color, withNote) {
  // Consume the selection immediately so a second click (e.g. picking a color
  // and then hitting "+ note") can't stack a second highlight on the same
  // text -- one highlight per region. Clearing the DOM selection here (before
  // any await) is essential: clicking a swatch fires a mouseup that would
  // otherwise re-run handleSelection while the text is still selected and
  // re-arm lastSelectionRange, defeating the guard. captureAnchor works off
  // the cloned range, so clearing the live selection first is safe.
  const range = lastSelectionRange;
  if (!range) return;
  lastSelectionRange = null;
  window.getSelection().removeAllRanges();

  const anchor = captureAnchor(range);
  hideActionPopup();
  if (!anchor) {
    // Was silent (just a console.warn), so a failed anchor looked like "nothing
    // happened". Surface it -- usually the selection started outside indexed
    // text (an image, an element boundary).
    console.warn("[meraki] could not anchor selection");
    showToast("Couldn't anchor that selection — try selecting within a paragraph.");
    return;
  }
  const res = await send({
    type: "create_annotation",
    url: location.href,
    title: document.title,
    quote: anchor.quote,
    prefix: anchor.prefix,
    suffix: anchor.suffix,
    position: anchor.startOffset,
    color,
    note: null,
    tags: [],
  });
  if (!res || !res.ok) {
    console.warn("[meraki] create failed", res);
    showToast(res && res.error
      ? `Couldn't save that highlight: ${res.error}`
      : "Couldn't save that highlight — the daemon didn't respond.");
    return;
  }

  const saved = range.cloneRange();
  state.set(res.data.id, {
    data: { id: res.data.id, quote: anchor.quote, prefix: anchor.prefix,
            suffix: anchor.suffix, color, note: null, tags: [] },
    ranges: [saved],
    orphaned: false,
  });
  changed();
  if (withNote) emit("editor:open", { id: res.data.id, rect: saved.getBoundingClientRect() });
}

// Geometric hit-test for a click: open the editor if (x, y) lands inside a
// rectangle a highlight actually paints. Using the range's client rects (not
// caretPositionFromPoint) avoids false hits in blank space near the highlight
// -- the nearest caret snaps to the range's end boundary, reading as "inside".
// The caller gates on session state + our-own-UI before calling.
export function openEditorAtPoint(x, y) {
  if (!("highlights" in CSS)) return;
  for (const [id, entry] of state) {
    if (entry.orphaned) continue;
    for (const r of entry.ranges) {
      if (pointInRange(r, x, y)) {
        emit("editor:open", { id, rect: r.getBoundingClientRect() });
        return;
      }
    }
  }
}

on("create", ({ color, withNote }) => createFromSelection(color, withNote));
