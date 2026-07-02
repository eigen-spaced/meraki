// Small pure string helpers used across the UI.

export function truncate(s, n) {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
