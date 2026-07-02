// Shared annotation state. The rest of the app reads/iterates `state` and
// `doc.tags` directly; mutating code calls changed() at the points that used to
// call renderAllHighlights()+renderSidebarList(), so subscribers re-render.

import { emit } from "./bus.js";

// annotation id -> { data, ranges: Range[], orphaned: bool }
export const state = new Map();

// Page-level (document) state. `tags` is mutated in place and reassigned on
// load; wrapping it in an object keeps a stable import binding across modules.
export const doc = { tags: [] };

// Signal that the annotation set changed so subscribers (highlights, sidebar)
// rebuild from current `state`. Emitted at the same points the old inline code
// re-rendered.
export function changed() {
  emit("annotations:changed");
}
