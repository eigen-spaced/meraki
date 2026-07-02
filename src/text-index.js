// Page text indexing for anchoring: flatten visible text nodes into one string
// and map global character offsets back to (node, offset) DOM positions.

// Concatenate all visible text nodes into one string, remembering where each
// node's text starts so a global offset can map back to (node, offset).
export function buildTextIndex() {
  const walker = document.createTreeWalker(
    document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue) return NodeFilter.FILTER_REJECT;
        const p = node.parentElement;
        if (!p) return NodeFilter.FILTER_REJECT;
        const tag = p.tagName;
        if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT") {
          return NodeFilter.FILTER_REJECT;
        }
        // Skip our own shadow host if it ever shows up.
        if (p.closest && p.closest("#meraki-annotator-root")) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
  const nodes = [];
  let text = "";
  let node;
  while ((node = walker.nextNode())) {
    nodes.push({ node, start: text.length, len: node.nodeValue.length });
    text += node.nodeValue;
  }
  return { text, nodes };
}

// Map a global offset to a { node, offset } DOM position (binary search).
function locate(index, globalOffset) {
  const { nodes } = index;
  let lo = 0, hi = nodes.length - 1, found = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const n = nodes[mid];
    if (globalOffset < n.start) {
      hi = mid - 1;
    } else if (globalOffset > n.start + n.len) {
      lo = mid + 1;
    } else {
      found = n;
      break;
    }
  }
  if (!found) return null;
  return { node: found.node, offset: globalOffset - found.start };
}

// Build a Range spanning [startOffset, endOffset) in the concatenated text.
export function rangeFromOffsets(index, startOffset, endOffset) {
  const s = locate(index, startOffset);
  const e = locate(index, endOffset);
  if (!s || !e) return null;
  const range = document.createRange();
  try {
    range.setStart(s.node, s.offset);
    range.setEnd(e.node, e.offset);
  } catch (_) {
    return null;
  }
  return range;
}

// Approximate global text offset of an element (e.g. an <img>): the start of
// the first indexed text node that follows it anywhere in document order (not
// just within its parent, so an <img> alone in a <figure> still orders right).
// Used to interleave image annotations among text ones.
export function offsetOfElement(index, el) {
  for (const entry of index.nodes) {
    if (el.compareDocumentPosition(entry.node) & Node.DOCUMENT_POSITION_FOLLOWING) {
      return entry.start;
    }
  }
  return index.text.length;   // no text after it -> sort to the end
}

// Map a live (container, offset) DOM position to a global offset in the index.
export function globalOffsetOf(index, container, offset) {
  // container may be a text node (offset = char offset) or an element
  // (offset = child index). Normalize to a text node position.
  for (const entry of index.nodes) {
    if (entry.node === container) return entry.start + offset;
  }
  // Element container: find the first text node at/after the child index.
  if (container.nodeType === Node.ELEMENT_NODE) {
    const child = container.childNodes[offset];
    if (child) {
      for (const entry of index.nodes) {
        if (entry.node === child || (child.contains && child.contains(entry.node))) {
          return entry.start;
        }
      }
    }
  }
  return -1;
}
