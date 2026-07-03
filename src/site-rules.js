// Per-site enablement rules.
//
// Meraki is off by default on every site; enabling it in the toolbar popup
// records that choice per domain (browser.storage.local "siteState", a
// { [siteKey]: true } map) so the site stays on across pages and restarts.
//
// The blocklist below is a curated set of domains where annotating makes no
// sense (video/audio/social feeds): there Meraki stays off *and* the side tab
// is hidden, with no "this page has annotations" nudge. It's still overridable
// -- an explicit toggle in the popup writes siteState and wins over the block.
//
// NOTE: extension/popup.js keeps a small hand-synced copy of BLOCKLIST + the
// siteKey/hostBlocked helpers (it's a classic script and can't import this
// module). Keep the two in step when editing this list.
export const BLOCKLIST = [
  "facebook.com",
  "youtube.com",
  "spotify.com",
  "bandcamp.com",
  "twitch.tv",
];

// Collapse a hostname to the key we remember it under: lowercase, sans a
// leading "www." so www.site.com and site.com share one on/off state.
export function siteKey(hostname) {
  return (hostname || "").toLowerCase().replace(/^www\./, "");
}

// True if the host is the blocklisted domain or a subdomain of it, so
// m.youtube.com / music.youtube.com match "youtube.com".
export function hostBlocked(hostname) {
  const h = (hostname || "").toLowerCase();
  return BLOCKLIST.some((d) => h === d || h.endsWith("." + d));
}
