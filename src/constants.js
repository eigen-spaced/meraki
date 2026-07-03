// Shared constants: highlight colours + the anchoring context window.
//
// The five colour KEYS are stable (the daemon/DB/org files store them by name);
// only their rendered values changed with the editorial reskin. Each maps to a
// hue in the new palette: yellow->amber, green->sage, blue->sky, pink->rose,
// purple->violet.
export const COLORS = ["yellow", "green", "blue", "pink", "purple"];

// `dot` = solid swatch / accent (also the noted-highlight underline on the
// page); `wash` = the translucent page-highlight tint. Both are concrete values
// (the page ::highlight() rules live outside our shadow DOM, with no CSS vars).
export const HL = {
  yellow: { dot: "#C7A03C", wash: "#EFDDA4" },
  green: { dot: "#7E9E63", wash: "#D9E4C6" },
  blue: { dot: "#6B8FB5", wash: "#CFDEEF" },
  pink: { dot: "#BF7089", wash: "#EFD0DB" },
  purple: { dot: "#997FBF", wash: "#E2D6F0" },
};

// Back-compat alias used by the page-highlight painter: the wash tint per key.
export const COLOR_CSS = Object.fromEntries(
  COLORS.map((c) => [c, HL[c].wash]),
);

// Key -> theme CSS variable name, for shadow-DOM UI (swatches, card borders)
// that should pick up the Ink theme's brightened dots.
export const HL_VAR = {
  yellow: "--mk-hl-amber",
  green: "--mk-hl-sage",
  blue: "--mk-hl-sky",
  pink: "--mk-hl-rose",
  purple: "--mk-hl-violet",
};

// Chars of context captured on each side of a quote for re-anchoring (§2.4).
export const PREFIX_LEN = 32;
