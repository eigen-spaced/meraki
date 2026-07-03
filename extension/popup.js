// Popup: per-site enable toggle, daemon status + db/org paths, Settings link,
// and a two-step "clear entire database" escape hatch.

const $ = (id) => document.getElementById(id);

function send(message) {
  return browser.runtime.sendMessage(message);
}

function showError(msg) {
  const el = $("error");
  el.textContent = msg;
  el.classList.remove("hidden");
}

function setStatus(ok, text) {
  $("dot").className = "mk-dot-status " + (ok ? "ok" : "bad");
  $("status-text").textContent = text;
}

async function refresh() {
  const res = await send({ type: "get_db_path" });
  if (!res || !res.ok) {
    setStatus(false, "daemon not reachable");
    showError(res && res.error ? res.error : "No response from daemon.");
    return;
  }
  setStatus(true, "daemon connected");
  $("db-path").textContent = res.data.db_path || "(not set)";
  $("org-folder").textContent = res.data.org_folder || "(not set)";
  $("error").classList.add("hidden");
}

// --- per-site enable/disable switch ---
// On/off is remembered per domain in browser.storage.local "siteState" (a
// { [siteKey]: true } map); content scripts on that domain watch it and
// activate/deactivate in step. Hand-synced copy of src/site-rules.js -- this is
// a classic script and can't import the module. Keep them in step.
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
  $("annotate-toggle").setAttribute("aria-checked", String(on));
  $("toggle-site").textContent = currentBlocked
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
    toggle.setAttribute("aria-checked", "false");
    $("toggle-site").textContent = "not available here";
    return;
  }

  currentKey = siteKey(host);
  currentBlocked = hostBlocked(host);
  const { siteState } = await browser.storage.local.get("siteState");
  renderToggle(!!(siteState && siteState[currentKey] === true));

  toggle.addEventListener("click", async () => {
    const next = toggle.getAttribute("aria-checked") !== "true";
    const { siteState: cur } = await browser.storage.local.get("siteState");
    const nextState = { ...(cur || {}) };
    if (next) nextState[currentKey] = true;
    else delete nextState[currentKey];   // absent => off; keeps the map tidy
    await browser.storage.local.set({ siteState: nextState });
    renderToggle(next);
  });
}

// DB path / org folder are edited on the full options page.
$("open-settings").addEventListener("click", () => {
  browser.runtime.openOptionsPage();
  window.close();
});

// --- danger zone: clear the entire database (two-step, irreversible) ---

function resetClearUI() {
  $("clear-confirm").classList.add("hidden");
  $("clear-db").classList.remove("hidden");
}

async function clearDatabase() {
  const go = $("clear-go");
  go.disabled = true;
  const res = await send({ type: "clear_database" });
  go.disabled = false;
  resetClearUI();
  const status = $("clear-status");
  status.classList.remove("hidden");
  if (!res || !res.ok) {
    status.style.color = "var(--mk-danger)";
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
  $("clear-db").classList.add("hidden");
  $("clear-confirm").classList.remove("hidden");
  $("clear-status").classList.add("hidden");
});
$("clear-cancel").addEventListener("click", resetClearUI);
$("clear-go").addEventListener("click", clearDatabase);

refresh();
initToggle();
