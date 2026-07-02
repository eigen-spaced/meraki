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

// --- master enable/disable switch ---
// Global setting in browser.storage.local; every content script watches it and
// activates/deactivates in step.

function setToggleLabel(on) {
  $("toggle-label").textContent = on ? "Enabled" : "Disabled";
}

async function initToggle() {
  const toggle = $("annotate-toggle");
  const { enabled } = await browser.storage.local.get("enabled");
  const on = enabled === true;   // default off
  toggle.checked = on;
  setToggleLabel(on);
  toggle.addEventListener("change", () => {
    browser.storage.local.set({ enabled: toggle.checked });
    setToggleLabel(toggle.checked);
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
