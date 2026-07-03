// Popup: show db_path / org folder + daemon status, allow changing the DB
// location via a native file picker driven by the daemon (§2.1).

const $ = (id) => document.getElementById(id);

function send(message) {
  return browser.runtime.sendMessage(message);
}

function showError(msg) {
  const el = $("error");
  el.textContent = msg;
  el.style.display = "block";
}

function setStatus(ok, text) {
  $("dot").className = "dot " + (ok ? "ok" : "bad");
  $("status-text").textContent = text;
}

async function refresh() {
  const res = await send({ type: "get_db_path" });
  if (!res || !res.ok) {
    setStatus(false, "Daemon not reachable");
    showError(res && res.error ? res.error : "No response from daemon.");
    return;
  }
  setStatus(true, "Daemon connected");
  $("db-path").textContent = res.data.db_path || "(not set)";
  $("org-folder").textContent = res.data.org_folder || "(not set)";
  $("error").style.display = "none";
}

// --- per-site enable/disable switch ---
// On/off is remembered per domain in browser.storage.local "siteState" (a
// { [siteKey]: true } map); every content script on that domain watches it and
// activates/deactivates in step. Hand-synced copy of src/site-rules.js -- this
// is a classic script and can't import the module. Keep them in step.
const BLOCKLIST = [
  "facebook.com",
  "youtube.com",
  "spotify.com",
  "bandcamp.com",
  "twitch.tv",
];

function siteKey(hostname) {
  return (hostname || "").toLowerCase().replace(/^www\./, "");
}

function hostBlocked(hostname) {
  const h = (hostname || "").toLowerCase();
  return BLOCKLIST.some((d) => h === d || h.endsWith("." + d));
}

let currentKey = null;
let currentBlocked = false;

function renderToggle(on) {
  $("toggle-label").textContent = on ? "On for this site" : "Off for this site";
  const site = $("toggle-site");
  site.textContent = currentBlocked
    ? `${currentKey} · off by default here`
    : currentKey;
}

async function initToggle() {
  const toggle = $("annotate-toggle");
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  let host = null;
  try {
    host = tab && tab.url ? new URL(tab.url).hostname : null;
  } catch (_) { /* non-web URL */ }

  if (!host) {
    // about:, view-source:, the extension's own pages, etc. -- nothing to toggle.
    toggle.disabled = true;
    $("toggle-label").textContent = "Not available here";
    $("toggle-site").textContent = "";
    return;
  }

  currentKey = siteKey(host);
  currentBlocked = hostBlocked(host);
  const { siteState } = await browser.storage.local.get("siteState");
  const on = !!(siteState && siteState[currentKey] === true);
  toggle.checked = on;
  renderToggle(on);

  toggle.addEventListener("change", async () => {
    const { siteState: cur } = await browser.storage.local.get("siteState");
    const next = { ...(cur || {}) };
    if (toggle.checked) next[currentKey] = true;
    else delete next[currentKey];   // absent => off; keeps the map tidy
    await browser.storage.local.set({ siteState: next });
    renderToggle(toggle.checked);
  });
}

// DB path / org folder are edited on the full options page now (no native
// picker). openOptionsPage() respects the manifest's options_ui.
$("open-settings").addEventListener("click", () => {
  browser.runtime.openOptionsPage();
  window.close();
});

// --- danger zone: clear the entire database (two-step, irreversible) ---

function resetClearUI() {
  $("clear-confirm").style.display = "none";
  $("clear-db").style.display = "";
}

async function clearDatabase() {
  const go = $("clear-go");
  go.disabled = true;
  const res = await send({ type: "clear_database" });
  go.disabled = false;
  resetClearUI();
  const status = $("clear-status");
  status.style.display = "block";
  if (!res || !res.ok) {
    status.style.color = "#f85149";
    status.textContent =
      res && res.error ? `Failed: ${res.error}` : "Failed to clear the database.";
    return;
  }
  const n = res.data.cleared;
  status.style.color = "";
  status.textContent =
    `Database cleared (${n} page${n === 1 ? "" : "s"} removed). ` +
    `Reload any open tabs to see the effect.`;
}

$("clear-db").addEventListener("click", () => {
  $("clear-db").style.display = "none";
  $("clear-confirm").style.display = "block";
  $("clear-status").style.display = "none";
});
$("clear-cancel").addEventListener("click", resetClearUI);
$("clear-go").addEventListener("click", clearDatabase);

refresh();
initToggle();
