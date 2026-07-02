// Text-quote + prefix/suffix anchoring (Hypothesis-style, §2.4): capture a
// robust anchor from a live selection, and re-find it on a later page load.

import { PREFIX_LEN } from "./constants.js";
import { buildTextIndex, globalOffsetOf, rangeFromOffsets } from "./text-index.js";

// From a live selection Range, capture quote/prefix/suffix against the index.
export function captureAnchor(range) {
  const index = buildTextIndex();
  // Find the selection's global start offset by matching its start container.
  const startGlobal = globalOffsetOf(index, range.startContainer, range.startOffset);
  const quote = range.toString();
  if (startGlobal < 0 || !quote) return null;
  const endGlobal = startGlobal + quote.length;
  const prefix = index.text.slice(Math.max(0, startGlobal - PREFIX_LEN), startGlobal);
  const suffix = index.text.slice(endGlobal, endGlobal + PREFIX_LEN);
  return { quote, prefix, suffix, startOffset: startGlobal };
}

// Re-find a stored annotation's range on the current page (§2.4).
export function reanchor(index, a) {
  const { text } = index;
  const prefix = a.prefix || "";
  const suffix = a.suffix || "";
  const quote = a.quote;

  // 1. Exact prefix+quote+suffix.
  const combined = prefix + quote + suffix;
  const idx = text.indexOf(combined);
  if (idx !== -1) {
    const qs = idx + prefix.length;
    return rangeFromOffsets(index, qs, qs + quote.length);
  }

  // 2. Fall back to quote alone; if multiple, score by surrounding context.
  const matches = [];
  let from = 0;
  while (true) {
    const at = text.indexOf(quote, from);
    if (at === -1) break;
    matches.push(at);
    from = at + 1;
    if (matches.length > 500) break; // pathological guard
  }
  if (matches.length === 0) return null;
  if (matches.length === 1) {
    return rangeFromOffsets(index, matches[0], matches[0] + quote.length);
  }
  let best = matches[0], bestScore = -1;
  for (const at of matches) {
    const before = text.slice(Math.max(0, at - PREFIX_LEN), at);
    const after = text.slice(at + quote.length, at + quote.length + PREFIX_LEN);
    const score = commonSuffixLen(before, prefix) + commonPrefixLen(after, suffix);
    if (score > bestScore) { bestScore = score; best = at; }
  }
  return rangeFromOffsets(index, best, best + quote.length);
}

function commonSuffixLen(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[a.length - 1 - i] === b[b.length - 1 - i]) i++;
  return i;
}

function commonPrefixLen(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}
