// Options page: read/set the daemon's db_path and org_folder as typed absolute
// paths. Replaces the old native (tkinter) file picker — the daemon validates
// each path and returns { ok, error? }.

const $ = (id) => document.getElementById(id);

function send(message) {
  return browser.runtime.sendMessage(message);
}

function setStatus(ok, text) {
  $("dot").className = "dot " + (ok ? "ok" : "bad");
  $("status-text").textContent = text;
}

function setMsg(id, ok, text) {
  const el = $(id);
  el.className = "msg " + (ok ? "ok" : "bad");
  el.textContent = text;
}

async function refresh() {
  const res = await send({ type: "get_db_path" });
  if (!res || !res.ok) {
    setStatus(false, "Daemon not reachable");
    return;
  }
  setStatus(true, "Daemon connected");
  $("db-path").value = res.data.db_path || "";
  $("org-folder").value = res.data.org_folder || "";
}

async function save(type, inputId, msgId, label) {
  const path = $(inputId).value.trim();
  if (!path) { setMsg(msgId, false, "Enter a path first."); return; }
  const res = await send({ type, path });
  if (!res || !res.ok) {
    setMsg(msgId, false, (res && res.error) || "Save failed.");
    return;
  }
  setMsg(msgId, true, `${label} saved.`);
}

$("save-db").addEventListener("click", () =>
  save("set_db_path", "db-path", "db-msg", "Database"));
$("save-org").addEventListener("click", () =>
  save("set_org_folder", "org-folder", "org-msg", "Org folder"));

// "Notify when a page has annotations" — a client-side preference (not a daemon
// setting), read by the content script before showing its off-state toast.
async function loadPrefs() {
  try {
    const { notifyOnAnnotations } = await browser.storage.local.get("notifyOnAnnotations");
    $("notify-toggle").checked = notifyOnAnnotations !== false;   // default on
  } catch (_) {
    $("notify-toggle").checked = true;
  }
}

$("notify-toggle").addEventListener("change", () => {
  browser.storage.local.set({ notifyOnAnnotations: $("notify-toggle").checked });
});

refresh();
loadPrefs();
