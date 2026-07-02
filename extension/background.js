// MV3 service worker. Holds no persistent native-messaging port: every request
// from the content script or popup triggers a fresh sendNativeMessage() call
// (§2.1). The worker being evicted between calls is fine -- there is nothing to
// keep alive.
//
// browser-polyfill is loaded as a classic script in content scripts, but the
// module service worker needs its own import.
import "./vendor/browser-polyfill.js";

const HOST_NAME = "org.merakiannotator.daemon";

async function callDaemon(message) {
  try {
    const response = await browser.runtime.sendNativeMessage(HOST_NAME, message);
    // The daemon always answers { ok, data?, error? }. Pass it through.
    return response;
  } catch (e) {
    // Thrown when the host isn't installed / crashed before responding. The
    // extension API only surfaces a generic message here; the real reason is
    // logged by Firefox to the Browser Console. Dump everything we can see.
    console.error("[meraki] sendNativeMessage threw:", e, "name=", e && e.name,
      "message=", e && e.message, "stack=", e && e.stack);
    return { ok: false, error: `daemon unreachable: ${e && e.message ? e.message : e}` };
  }
}

// Fetch an image's bytes here rather than in the content script: MV3 subjects
// content-script fetch to the page's CORS, which blocks most cross-origin
// images, whereas the background context has the extension's host permissions.
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

async function fetchImage(src) {
  try {
    const resp = await fetch(src);
    if (!resp.ok) return { ok: false, error: `image http ${resp.status}` };
    const blob = await resp.blob();
    if (blob.size > MAX_IMAGE_BYTES) {
      return { ok: false, error: "image too large (over 5 MB)" };
    }
    return { ok: true, data: { base64: bytesToBase64(await blob.arrayBuffer()),
                               type: blob.type } };
  } catch (e) {
    return { ok: false, error: `image fetch failed: ${e && e.message ? e.message : e}` };
  }
}

function bytesToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000; // avoid arg-count limits on String.fromCharCode
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

// Single relay: content script and popup send { type, ... }. Image fetches are
// handled here; everything else is forwarded to the daemon as-is.
browser.runtime.onMessage.addListener((message) => {
  // Returning a promise makes this an async responder under webextension-polyfill.
  if (message && message.type === "fetch_image") {
    return fetchImage(message.src);
  }
  return callDaemon(message);
});
