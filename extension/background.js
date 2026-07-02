// MV3 service worker. Holds no persistent native-messaging port: every request
// from the content script or popup triggers a fresh sendNativeMessage() call
// (§2.1). The worker being evicted between calls is fine -- there is nothing to
// keep alive.
//
// browser-polyfill is loaded as a classic script in content scripts, but the
// module service worker needs its own import.
import "./vendor/browser-polyfill.js";

const HOST_NAME = "org.merakiannotator.daemon";

// A fresh host process is spawned per message, so under a burst (e.g. a hard
// refresh firing several messages at once) Firefox occasionally fails to launch
// one -- sendNativeMessage throws before the daemon even starts, so nothing is
// written and nothing lands in daemon.log. Those failures are transient, so
// retry a couple of times with a short backoff before giving up. Retrying is
// safe: a launch failure means the message never reached the daemon, so no
// partial write happened.
const DAEMON_RETRIES = 3;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callDaemon(message) {
  let lastErr;
  for (let attempt = 1; attempt <= DAEMON_RETRIES; attempt++) {
    try {
      // The daemon always answers { ok, data?, error? }. Pass it through.
      return await browser.runtime.sendNativeMessage(HOST_NAME, message);
    } catch (e) {
      lastErr = e;
      console.warn(`[meraki] sendNativeMessage failed (attempt ${attempt}/` +
        `${DAEMON_RETRIES}) for ${message && message.type}:`, e && e.message ? e.message : e);
      if (attempt < DAEMON_RETRIES) await delay(120 * attempt);
    }
  }
  // Exhausted retries. The real reason is in Firefox's Browser Console; surface
  // what we can to the content script (which now shows it in a toast).
  console.error("[meraki] sendNativeMessage gave up:", lastErr, "name=",
    lastErr && lastErr.name, "stack=", lastErr && lastErr.stack);
  return {
    ok: false,
    error: `daemon unreachable: ${lastErr && lastErr.message ? lastErr.message : lastErr}`,
  };
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
