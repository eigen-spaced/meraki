// Theme resolution for the shadow-DOM UI. The user setting (storage.local
// "theme") is one of "auto" | "manuscript" | "ink"; "auto" follows the OS/browser
// colour scheme. We stamp the resolved concrete theme onto the UI wrapper's
// data-meraki-theme attribute and keep it in sync as the setting or the OS scheme
// changes. The popup/options pages run their own inline copy of this logic.

const media = window.matchMedia("(prefers-color-scheme: dark)");

// Resolve a setting to a concrete theme name.
export function resolveTheme(setting) {
  if (setting === "manuscript" || setting === "ink") return setting;
  return media.matches ? "ink" : "manuscript"; // "auto"
}

async function readSetting() {
  try {
    const { theme } = await browser.storage.local.get("theme");
    return theme || "auto";
  } catch (_) {
    return "auto";
  }
}

// Apply the resolved theme to `el` now (best-effort synchronous default already
// set by the caller) and keep it live: react to the setting changing in any tab
// and, while on "auto", to the OS scheme flipping.
export async function initTheme(el) {
  let setting = await readSetting();
  const apply = () => el.setAttribute("data-meraki-theme", resolveTheme(setting));
  apply();

  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.theme) return;
    setting = changes.theme.newValue || "auto";
    apply();
  });

  const onScheme = () => { if (setting === "auto") apply(); };
  if (media.addEventListener) media.addEventListener("change", onScheme);
  else if (media.addListener) media.addListener(onScheme); // older engines
}
