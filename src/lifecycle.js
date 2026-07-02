// Activation lifecycle: build the shadow-DOM UI on first activate, load stored
// annotations, and mute / tear down on toggle. Owns the highlight mute
// coordinator (setHighlightsEnabled, driven by the sidebar switch via
// "highlights:set"). The master on/off is a global setting in
// browser.storage.local, written by the popup and mirrored here live.

import { send } from "./daemon.js";
import { buildTextIndex, globalOffsetOf } from "./text-index.js";
import { reanchor } from "./anchoring.js";
import { on } from "./bus.js";
import { state, doc, changed } from "./store.js";
import { session } from "./session.js";
import {
  ensureHighlightStyles,
  renderAllHighlights,
  clearHighlights,
} from "./highlights.js";
import { initShadow, showHost, hideHost } from "./ui/root.js";
import { buildActionPopup, hideActionPopup } from "./ui/action-popup.js";
import { buildCommentPopup, hideCommentPopup } from "./ui/comment-popup.js";
import { buildImagePopup, hideImagePopup } from "./ui/image-popup.js";
import {
  initSidebar,
  hideSidebar,
  setHighlightsToggle,
  applyLoadedMeta,
  showReconcile,
  showDirtyNotice,
  hideDirtyNotice,
} from "./ui/sidebar.js";
import { showToast, dismissToast } from "./ui/toast.js";
import { reanchorImage } from "./images.js";

let uiBuilt = false;

// Master on/off: a single global setting (browser.storage.local "enabled",
// default OFF) that persists across refresh, tab close/open, and browser
// restart and applies to every page. The popup is the only writer; content
// scripts read it on load and react to changes via storage.onChanged (init).
async function readEnabled() {
  try {
    const { enabled } = await browser.storage.local.get("enabled");
    return enabled === true;   // default OFF
  } catch (_) {
    return false;
  }
}

// The sidebar mute switch (show/hide highlights) persists so a page you've muted
// stays muted after refresh. Scoped per tab via sessionStorage -- a viewing
// preference, unlike the global master switch. Default visible.
const VISIBLE_KEY = "meraki:visible";

function readAnnotationsVisible() {
  try {
    return sessionStorage.getItem(VISIBLE_KEY) !== "0";   // default visible
  } catch (_) {
    return true;
  }
}

function persistAnnotationsVisible(visible) {
  try {
    sessionStorage.setItem(VISIBLE_KEY, visible ? "1" : "0");
  } catch (_) {
    // best-effort; sandboxed contexts may throw
  }
}

// When the plugin is off, we still make one cheap daemon check so we can nudge
// the user if the page has saved annotations they can't see. Gated by a setting
// (browser.storage.local, default on) so it can be silenced from the options page.
async function notifyEnabled() {
  try {
    const { notifyOnAnnotations } = await browser.storage.local.get("notifyOnAnnotations");
    return notifyOnAnnotations !== false;   // default ON
  } catch (_) {
    return true;
  }
}

async function nudgeIfAnnotated() {
  if (!(await notifyEnabled())) return;
  const res = await send({ type: "get_annotations", url: location.href });
  if (!res || !res.ok) return;
  const n = (res.data.annotations || []).length;
  if (n === 0) return;
  showToast(
    `Meraki: this page has ${n} annotation${n === 1 ? "" : "s"}. ` +
    `Turn on the annotator from the toolbar to view.`
  );
}

function initUI() {
  const shadow = initShadow();
  buildActionPopup(shadow);
  buildCommentPopup(shadow);
  buildImagePopup(shadow);
  initSidebar(shadow);
}

async function loadExisting() {
  const res = await send({ type: "get_annotations", url: location.href });
  if (!res || !res.ok) {
    console.warn("[meraki] could not load annotations", res);
    return;
  }
  state.clear();   // rebuild fresh (also matters when re-activating)
  doc.tags = res.data.document_tags || [];
  applyLoadedMeta({
    customTitle: res.data.custom_title,
    subtitle: res.data.subtitle,
    pageTitle: document.title,
  });
  const index = buildTextIndex();
  const positions = {};
  for (const a of res.data.annotations) {
    if (a.kind === "image") {
      const { el, off } = reanchorImage(index, a);
      state.set(a.id, { data: a, el, ranges: [], orphaned: !el });
      if (off >= 0) positions[a.id] = off;
    } else {
      const range = reanchor(index, a);
      state.set(a.id, {
        data: a,
        ranges: range ? [range] : [],
        orphaned: !range,
      });
      if (range) {
        const off = globalOffsetOf(index, range.startContainer, range.startOffset);
        if (off >= 0) positions[a.id] = off;
      }
    }
  }
  changed();

  // Surface a divergence between the DB (source of truth) and the .org on disk.
  // Missing: the file was deleted by hand -- the annotations still live in the
  // DB. This is a blocking modal (Restore / Delete): it locks annotation creation
  // until resolved so the choice can't be missed. Dirty: the file was hand-edited
  // and the next write overwrites it (a daemon-side backup is kept; freeze to
  // own) -- a persistent, dismissible footer notice (not a toast, which is easy
  // to miss). The two are mutually exclusive server-side.
  if (res.data.dirty) showDirtyNotice(); else hideDirtyNotice();
  if (res.data.missing) showReconcile();

  // Record each annotation's current page position so the org export can match
  // the sidebar's document order (incl. backfilling ones created before this
  // existed). Fire-and-forget; the daemon only rewrites the .org if one moved.
  if (Object.keys(positions).length) {
    send({ type: "set_annotation_positions", url: location.href, positions });
  }
}

async function activate() {
  if (session.active) return;
  session.active = true;
  session.highlightsEnabled = readAnnotationsVisible();   // restore per-tab mute
  dismissToast();   // the off-state nudge is moot once we're on
  if (!uiBuilt) {
    initUI();
    uiBuilt = true;
  } else {
    showHost();
  }
  ensureHighlightStyles();
  setHighlightsToggle(session.highlightsEnabled);
  await loadExisting();
}

// Mute/unmute highlighting while keeping the sidebar. Clearing the registry
// hides the paint; suppressing the popups is handled here + in the page-level
// event gates. Fired by the sidebar switch via "highlights:set".
function setHighlightsEnabled(enabled) {
  session.highlightsEnabled = enabled;
  persistAnnotationsVisible(enabled);
  hideActionPopup();
  hideCommentPopup();
  hideImagePopup();
  if (enabled) renderAllHighlights();
  else clearHighlights();
}

function deactivate() {
  if (!session.active) return;
  session.active = false;
  hideActionPopup();
  hideCommentPopup();
  hideImagePopup();
  hideSidebar();
  clearHighlights();
  hideHost();   // remove all on-page UI
}

async function applyEnabledState() {
  const enabled =
    (await readEnabled()) ||
    document.documentElement.hasAttribute("data-meraki-autoactivate");
  if (enabled) activate();
  else nudgeIfAnnotated();   // off: quietly nudge if the page has annotations
}

export function init() {
  // Mirror the global master switch live: toggling it in the popup (or any
  // tab) flips every open page in step.
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.enabled) return;
    if (changes.enabled.newValue) activate();
    else deactivate();
  });

  applyEnabledState();
}

on("highlights:set", setHighlightsEnabled);

// Rebuild the page's annotation state from the daemon on request. Emitted by the
// sidebar after a freeze -- a frozen page's URL is released, so this comes back
// empty (blank slate) while the archived .org is left untouched.
on("document:reload", loadExisting);
