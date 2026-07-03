// Image annotations: click an <img> (or an inline <svg> diagram, e.g. Mermaid)
// to attach a note. Unlike text, images aren't highlighted -- the anchor is the
// image URL (`src`, stored in the annotation's `quote`), and the note is
// mandatory. <img> bytes are fetched in the page context (so cookies/CORS
// carry); inline <svg> is serialized straight from the DOM. Both are flattened
// to PNG and sent to the daemon, which writes them under org_folder/images/ and
// links them from the export.

import { send } from "./daemon.js";
import { state, changed } from "./store.js";
import { buildTextIndex, offsetOfElement } from "./text-index.js";
import { openImageCreate, openImageEditor } from "./ui/image-popup.js";
import { showToast } from "./ui/toast.js";

const EXT_BY_TYPE = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/svg+xml": "svg",
};

// Inline-SVG annotations have no URL, so their `quote` (anchor) is a synthetic
// signature tagged with this prefix -- see svgSignature(). MIN_SVG_DIM keeps
// small inline icons (buttons, logos) clickable by only treating diagram-sized
// svgs as annotatable. RASTER_SCALE oversamples so downscaled diagram text stays
// crisp in the exported PNG.
const SVG_MARK = "svg:";
const MIN_SVG_DIM = 64;
const RASTER_SCALE = 2;

function srcOf(img) {
  return img.currentSrc || img.src;
}

// Find the annotation entry for a given <img>, matching by element identity or
// (after a reload, when we only have the URL) by src.
function existingFor(img) {
  const src = srcOf(img);
  for (const [id, entry] of state) {
    if (entry.data.kind !== "image") continue;
    if (entry.el === img || entry.data.quote === src) return id;
  }
  return null;
}

// Click handler entry point (called from the content-script capture listener).
export function handleImageClick(img) {
  const id = existingFor(img);
  if (id) openImageEditor(id);
  else openImageCreate(img, (note, tags) => createImageAnnotation(img, note, tags));
}

// The bytes are fetched in the background script (page CORS would block a
// content-script fetch for most cross-origin images).
async function fetchImageData(src) {
  const res = await send({ type: "fetch_image", src });
  if (!res || !res.ok) throw new Error(res && res.error ? res.error : "fetch failed");
  return { base64: res.data.base64, ext: EXT_BY_TYPE[res.data.type] || "png" };
}

// Rasterise an SVG to PNG in the page. Org/Emacs renders raster inline far more
// reliably than SVG, and a flattened PNG is self-contained (no external refs,
// no font surprises). We load the SVG from a same-origin data URL (so the canvas
// stays untainted) and draw it at w*h oversampled by RASTER_SCALE. Returns
// base64 PNG; rejects if the SVG can't be decoded or the canvas ends up tainted
// (e.g. the SVG pulls in a cross-origin <image>), letting the caller fall back.
function rasterizeSvg(svgDataUrl, w, h) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(w * RASTER_SCALE));
      canvas.height = Math.max(1, Math.round(h * RASTER_SCALE));
      try {
        canvas.getContext("2d").drawImage(im, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/png").split(",")[1]);
      } catch (e) {
        reject(e);
      }
    };
    im.onerror = () => reject(new Error("SVG decode failed"));
    im.src = svgDataUrl;
  });
}

// <img src="*.svg">: rasterise the fetched bytes at the size it renders on page,
// falling back to a sane default for sizeless icons.
function imgSvgToPng(svgBase64, img) {
  const w = img.clientWidth || 512;
  const h = img.clientHeight || 512;
  return rasterizeSvg("data:image/svg+xml;base64," + svgBase64, w, h);
}

// Inline <svg> node (e.g. a Mermaid diagram): serialise the live DOM subtree --
// its internal <style>/<defs> come along, so it renders standalone -- pinning an
// explicit width/height from the rendered box so sizeless (viewBox-only) svgs
// decode at a real size.
function inlineSvgToPng(svg) {
  const rect = svg.getBoundingClientRect();
  const w = Math.round(rect.width) || 512;
  const h = Math.round(rect.height) || 512;
  const clone = svg.cloneNode(true);
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  if (!clone.getAttribute("width")) clone.setAttribute("width", String(w));
  if (!clone.getAttribute("height")) clone.setAttribute("height", String(h));
  const xml = new XMLSerializer().serializeToString(clone);
  return rasterizeSvg("data:image/svg+xml;charset=utf-8," + encodeURIComponent(xml), w, h);
}

// The outermost <svg> containing `target` (svgs can nest), or null if `target`
// isn't inside one. Returns the root to annotate as a whole diagram.
function svgRoot(target) {
  let svg = target && target.closest ? target.closest("svg") : null;
  if (!svg) return null;
  let p = svg.parentNode;
  while (p && p.closest) {
    const up = p.closest("svg");
    if (!up) break;
    svg = up;
    p = up.parentNode;
  }
  return svg;
}

// A stable-ish anchor for an inline svg: its rendered size + collapsed text.
// Mermaid regenerates element ids each render, but the size and node labels are
// reproducible, so this re-matches the same diagram across reloads.
// The diagram's label text, used as its re-anchor key. Crucially this excludes
// <style>/<script>: Mermaid embeds a <style> block carrying a per-render random
// id (e.g. "#mermaid-1751520000 .node{...}"), and textContent would otherwise
// fold that volatile id in, so the signature never matched on reload. Cloning +
// stripping those leaves only the (stable, reproducible) node labels.
function svgText(svg) {
  const clone = svg.cloneNode(true);
  for (const el of clone.querySelectorAll("style, script")) el.remove();
  return (clone.textContent || "").replace(/\s+/g, " ").trim().slice(0, 200);
}

function svgSignature(svg) {
  const rect = svg.getBoundingClientRect();
  return `${SVG_MARK}${Math.round(rect.width)}x${Math.round(rect.height)}:${svgText(svg)}`;
}

// Does `svg` correspond to a stored "svg:WxH:text" anchor? Matching is driven by
// the diagram's text labels (distinctive and reproducible); size is only a
// fallback for textless diagrams. This tolerates a diagram re-rendering at a
// slightly different pixel size between capture and reload without orphaning it.
function svgMatchesQuote(svg, quote) {
  const rest = quote.slice(SVG_MARK.length);
  const colon = rest.indexOf(":");
  const wantDims = colon >= 0 ? rest.slice(0, colon) : rest;
  const wantText = colon >= 0 ? rest.slice(colon + 1) : "";
  if (wantText) return svgText(svg) === wantText;
  const rect = svg.getBoundingClientRect();
  const m = /^(\d+)x(\d+)$/.exec(wantDims);
  if (!m) return false;
  return Math.abs(Math.round(rect.width) - +m[1]) <= 4
    && Math.abs(Math.round(rect.height) - +m[2]) <= 4;
}

// Content-script hook: return the root <svg> to annotate if `target` sits inside
// a diagram-sized inline svg, else null. The size gate leaves small icons alone.
export function annotatableSvg(target) {
  const svg = svgRoot(target);
  if (!svg) return null;
  const rect = svg.getBoundingClientRect();
  if (rect.width < MIN_SVG_DIM || rect.height < MIN_SVG_DIM) return null;
  return svg;
}

function existingForSvg(svg) {
  for (const [id, entry] of state) {
    if (entry.data.kind !== "image") continue;
    const q = entry.data.quote || "";
    if (entry.el === svg) return id;
    if (q.startsWith(SVG_MARK) && svgMatchesQuote(svg, q)) return id;
  }
  return null;
}

export async function handleSvgClick(svg) {
  const id = existingForSvg(svg);
  if (id) { openImageEditor(id); return; }
  // Rasterise up front so the create popup can show a real preview and the save
  // callback reuses the same PNG (no double work).
  let pngBase64;
  try {
    pngBase64 = await inlineSvgToPng(svg);
  } catch (e) {
    console.warn("[meraki] could not rasterize svg", e);
    showToast(`Couldn't capture that diagram: ${e.message || e}`);
    return;
  }
  const sig = svgSignature(svg);
  openImageCreate(
    svg,
    (note, tags) => createSvgAnnotation(svg, sig, pngBase64, note, tags),
    "data:image/png;base64," + pngBase64,
  );
}

async function createSvgAnnotation(svg, sig, pngBase64, note, tags) {
  const index = buildTextIndex();
  const off = offsetOfElement(index, svg);
  const res = await send({
    type: "create_image_annotation",
    url: location.href,
    title: document.title,
    src: sig,               // synthetic anchor; stored as `quote`
    note,
    tags,
    position: off >= 0 ? off : null,
    ext: "png",
    data: pngBase64,
  });
  if (!res || !res.ok) {
    console.warn("[meraki] svg create failed", res);
    showToast("Couldn't save the diagram annotation.");
    return;
  }
  state.set(res.data.id, {
    data: {
      id: res.data.id, kind: "image", quote: sig, color: null,
      note, tags, image_file: res.data.image_file,
    },
    el: svg,
    ranges: [],
    orphaned: false,
  });
  changed();
}

async function createImageAnnotation(img, note, tags) {
  const src = srcOf(img);
  let data;
  try {
    data = await fetchImageData(src);
  } catch (e) {
    console.warn("[meraki] could not fetch image", e);
    showToast(`Couldn't grab that image: ${e.message || e}`);
    return;
  }
  // Flatten SVGs to PNG so they render inline in org/Emacs. If rasterising
  // fails (undecodable, or a tainted canvas from a cross-origin ref), fall back
  // to saving the original SVG rather than losing the annotation.
  if (data.ext === "svg") {
    try {
      data = { base64: await imgSvgToPng(data.base64, img), ext: "png" };
    } catch (e) {
      console.warn("[meraki] SVG->PNG failed, saving original SVG", e);
    }
  }
  const index = buildTextIndex();
  const off = offsetOfElement(index, img);
  const res = await send({
    type: "create_image_annotation",
    url: location.href,
    title: document.title,
    src,
    note,
    tags,
    position: off >= 0 ? off : null,
    ext: data.ext,
    data: data.base64,
  });
  if (!res || !res.ok) {
    console.warn("[meraki] image create failed", res);
    showToast("Couldn't save the image annotation.");
    return;
  }

  state.set(res.data.id, {
    data: {
      id: res.data.id, kind: "image", quote: src, color: null,
      note, tags, image_file: res.data.image_file,
    },
    el: img,
    ranges: [],
    orphaned: false,
  });
  changed();
}

// Re-anchor a stored image annotation on load. Inline-svg annotations (quote
// tagged "svg:") match a page <svg> by its text labels; the rest match an <img>
// by src. Returns the element (or null if it's no longer on the page) and its
// document offset.
export function reanchorImage(index, a) {
  const q = a.quote || "";
  const el = q.startsWith(SVG_MARK)
    ? Array.prototype.find.call(
        document.querySelectorAll("svg"), (s) => svgMatchesQuote(s, q)) || null
    : Array.prototype.find.call(
        document.images, (im) => srcOf(im) === q) || null;
  const off = el ? offsetOfElement(index, el) : -1;
  return { el, off };
}

// Retry anchoring the image annotations still orphaned in `state` (diagrams and
// lazy images that rendered after the initial load pass). Updates entry.el /
// orphaned in place. Returns { relinked: <ids that just anchored>, positions }
// so the caller can refresh the view and push new document offsets. Text
// annotations are left alone -- their re-anchoring is a separate concern.
export function retryImageAnchors(index) {
  const relinked = [];
  const positions = {};
  for (const [id, entry] of state) {
    if (entry.data.kind !== "image" || !entry.orphaned) continue;
    const { el, off } = reanchorImage(index, entry.data);
    if (!el) continue;
    entry.el = el;
    entry.orphaned = false;
    relinked.push(id);
    if (off >= 0) positions[id] = off;
  }
  return { relinked, positions };
}

// Count image annotations still waiting for their element to appear.
export function orphanedImageCount() {
  let n = 0;
  for (const entry of state.values()) {
    if (entry.data.kind === "image" && entry.orphaned) n++;
  }
  return n;
}
