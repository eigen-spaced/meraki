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

refresh();
initToggle();
