// Content script entry (bundled to extension/content.js by esbuild). This file
// only wires the page-level input events to the extracted modules; everything
// else lives in siblings:
//   leaf:       constants, helpers, styles, daemon, text-index, anchoring
//   state:      bus (pub/sub), store (annotations + doc tags), session (flags)
//   rendering:  highlights (CSS Custom Highlight API, §2.4 -- no DOM mutation)
//   shadow UI:  ui/root, ui/action-popup, ui/comment-popup, ui/sidebar
//   behavior:   selection (select→highlight, click→edit), lifecycle (activate,
//               load, mute, teardown, the toolbar message listener)
// Modules communicate over the bus; see selection.js / lifecycle.js for the
// event contracts (create, editor:open, remove, highlights:set, annotations:changed).

import { session } from "./session.js";
import { isInOurUI } from "./ui/root.js";
import { hideActionPopup } from "./ui/action-popup.js";
import { hideCommentPopup } from "./ui/comment-popup.js";
import { hideImagePopup } from "./ui/image-popup.js";
import { handleSelection, openEditorAtPoint } from "./selection.js";
import { handleImageClick, annotatableSvg, handleSvgClick } from "./images.js";
import { init } from "./lifecycle.js";

(() => {
  "use strict";

  if (window.__merakiAnnotatorLoaded) return;
  window.__merakiAnnotatorLoaded = true;

  // Selection → action popup. Defer so the selection is finalized first.
  document.addEventListener("mouseup", () => {
    if (!session.active || !session.highlightsEnabled || session.reconciling) return;
    setTimeout(handleSelection, 0);
  });

  // Click an image → annotate it. Capture phase + stopPropagation so we get in
  // ahead of the page's own image handlers (links, lightboxes), which the user
  // opted to suppress while the annotator is on. Inline <svg> diagrams (Mermaid
  // etc.) are annotatable too, gated on size so small icon-buttons still work.
  document.addEventListener("click", (e) => {
    if (!session.active || !session.highlightsEnabled || session.reconciling) return;
    if (isInOurUI(e.target)) return;
    if (e.target && e.target.tagName === "IMG") {
      e.preventDefault();
      e.stopPropagation();
      handleImageClick(e.target);
      return;
    }
    const svg = annotatableSvg(e.target);
    if (svg) {
      e.preventDefault();
      e.stopPropagation();
      handleSvgClick(svg);
    }
  }, true);

  // Click a painted highlight → open its editor (hit-test lives in selection).
  document.addEventListener("click", (e) => {
    if (!session.active || !session.highlightsEnabled || session.reconciling) return;
    if (isInOurUI(e.target)) return; // clicks in our UI
    openEditorAtPoint(e.clientX, e.clientY);
  });

  // Dismiss popups on outside interaction. mousedown fires before click, so
  // hiding the comment popup here lets the subsequent click hit-test reopen it
  // when the click actually landed on a highlight.
  document.addEventListener("mousedown", (e) => {
    if (!session.active) return;
    if (isInOurUI(e.target)) return;
    hideActionPopup();
    hideCommentPopup();
    hideImagePopup();
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
