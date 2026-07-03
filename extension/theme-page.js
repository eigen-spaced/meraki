// Applies the Meraki theme to an extension page (<html data-meraki-theme>).
// Setting lives in storage.local "theme" (auto|manuscript|ink); "auto" follows
// the OS colour scheme. Loaded before each page's own script.
(function () {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const resolve = (s) =>
    (s === "manuscript" || s === "ink") ? s : (media.matches ? "ink" : "manuscript");
  const apply = (s) =>
    document.documentElement.setAttribute("data-meraki-theme", resolve(s));

  apply("auto"); // synchronous default to avoid a flash
  browser.storage.local.get("theme").then(({ theme }) => apply(theme || "auto"));
  browser.storage.onChanged.addListener((ch, area) => {
    if (area === "local" && ch.theme) apply(ch.theme.newValue || "auto");
  });
  const onScheme = () =>
    browser.storage.local.get("theme").then(({ theme }) => {
      if (!theme || theme === "auto") apply("auto");
    });
  if (media.addEventListener) media.addEventListener("change", onScheme);
  else if (media.addListener) media.addListener(onScheme);
})();
