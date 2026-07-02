// Image annotations: click an <img> to attach a note. Unlike text, images
// aren't highlighted -- the anchor is the image URL (`src`, stored in the
// annotation's `quote`), and the note is mandatory. The image bytes are fetched
// in the page context (so cookies/CORS carry) and sent to the daemon, which
// writes them under org_folder/images/ and links them from the export.

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

// Re-anchor a stored image annotation on load: find the <img> by src. Returns
// the element (or null if it's no longer on the page) and its document offset.
export function reanchorImage(index, a) {
  const src = a.quote;
  const el = Array.prototype.find.call(
    document.images, (im) => srcOf(im) === src
  ) || null;
  const off = el ? offsetOfElement(index, el) : -1;
  return { el, off };
}
