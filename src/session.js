// Runtime activation flags, shared across modules via a stable object binding.
//
// active            master on/off, flipped from the toolbar popup. When false
//                   the extension is fully dormant (no shadow DOM, no daemon
//                   calls) -- the page behaves as if it weren't installed.
// highlightsEnabled mute toggle, flipped from the sidebar switch. When false,
//                   highlight rendering + selection are suppressed but the
//                   sidebar stays open.
// reconciling       true while a blocking modal is awaiting the user's choice
//                   (e.g. the page's .org was deleted on disk). No new
//                   annotations can be created/edited until it's resolved.
export const session = {
  active: false,
  highlightsEnabled: true,
  reconciling: false,
};
