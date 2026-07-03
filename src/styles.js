// Shadow-DOM stylesheet for all Meraki UI (popups + sidebar). Isolated in the
// shadow root so host-page CSS can't reach it and ours can't leak out.
//
// Editorial reskin ("Manuscript" light / "Ink" dark). All UI lives inside a
// `.mk-scope` wrapper that carries `data-meraki-theme`; tokens are defined per
// theme on that attribute and cascade to every component. Fonts (Lora, JetBrains
// Mono) are loaded at document level (see ui/root.js) since @font-face is
// ignored inside shadow roots.

export const SHADOW_CSS = `
  :host { all: initial; }
  * { box-sizing: border-box; }
  .hidden { display: none !important; }

  /* ---- theme tokens ------------------------------------------------------ */
  [data-meraki-theme="manuscript"] {
    --mk-panel:#FBF7EE; --mk-inset:#F4EDDC; --mk-card:#FFFDF6;
    --mk-border:#E0D6BE; --mk-border-soft:#E8DFC9; --mk-border-hover:#CFC3A6;
    --mk-ink:#201A12; --mk-body:#3A3325; --mk-muted:#5C5442;
    --mk-faint:#A79C87; --mk-label:#8A7F6A;
    --mk-accent:#A8402F; --mk-accent-hover:#8F3324; --mk-on-accent:#F8F1E0;
    --mk-danger:#A8402F; --mk-danger-tint:rgba(168,64,47,0.12); --mk-success:#7E9E63;
    --mk-shadow-pop:0 16px 40px rgba(80,62,30,0.18),0 3px 8px rgba(80,62,30,0.08);
    --mk-shadow-bar:0 10px 28px rgba(80,62,30,0.16),0 2px 6px rgba(80,62,30,0.08);
    --mk-card-hover-shadow:0 4px 14px rgba(80,62,30,0.12);
    --mk-hl-amber:#C7A03C; --mk-hl-sage:#7E9E63; --mk-hl-sky:#6B8FB5;
    --mk-hl-rose:#BF7089; --mk-hl-violet:#997FBF;
  }
  [data-meraki-theme="ink"] {
    --mk-panel:#241E15; --mk-inset:#1B1610; --mk-card:#2A2318;
    --mk-border:#3B3325; --mk-border-soft:#322B1F; --mk-border-hover:#4A4130;
    --mk-ink:#F0E7D3; --mk-body:#DCD2B8; --mk-muted:#C9BFA6;
    --mk-faint:#6E6450; --mk-label:#8B8168;
    --mk-accent:#D9A441; --mk-accent-hover:#E5B45A; --mk-on-accent:#1B1610;
    --mk-danger:#C65D48; --mk-danger-tint:rgba(198,93,72,0.15); --mk-success:#8AAC6E;
    --mk-shadow-pop:0 16px 44px rgba(0,0,0,0.55);
    --mk-shadow-bar:0 12px 32px rgba(0,0,0,0.5);
    --mk-card-hover-shadow:0 4px 16px rgba(0,0,0,0.45);
    --mk-hl-amber:#D3AC48; --mk-hl-sage:#8AAC6E; --mk-hl-sky:#789CC2;
    --mk-hl-rose:#CB7D96; --mk-hl-violet:#A68CCB;
  }

  .mk-scope {
    font-family:-apple-system,'Helvetica Neue',sans-serif;
    color:var(--mk-ink); font-size:14px; line-height:1.5;
  }

  /* ---- typography helpers ------------------------------------------------ */
  .mk-serif { font-family:Lora,Georgia,serif; }
  .mk-mono  { font-family:'JetBrains Mono',ui-monospace,monospace; }
  .mk-label {
    font-family:'JetBrains Mono',ui-monospace,monospace;
    font-size:10px; letter-spacing:0.08em; text-transform:uppercase;
    color:var(--mk-label);
  }

  /* ---- fixed layer (popups position themselves via inline top/left) ------ */
  .mk-fixed { position:fixed; z-index:2147483647; }

  /* ---- panels / inputs / excerpt ----------------------------------------- */
  .mk-panel {
    background:var(--mk-panel); border:1px solid var(--mk-border);
    border-radius:14px; box-shadow:var(--mk-shadow-pop); color:var(--mk-ink);
  }
  .mk-input {
    background:var(--mk-inset); border:1px solid var(--mk-border);
    border-radius:9px; padding:10px 12px; color:var(--mk-ink);
    outline:none; width:100%; font-family:inherit;
  }
  .mk-input:focus { border-color:var(--mk-accent); }
  .mk-input::placeholder { color:var(--mk-faint); }
  .mk-input--note { font-family:Lora,Georgia,serif; font-size:14px; line-height:1.5; min-height:96px; resize:vertical; }
  .mk-input--tags { font-family:'JetBrains Mono',ui-monospace,monospace; font-size:12px; }
  .mk-excerpt {
    border-left:3px solid var(--mk-hl-current, var(--mk-hl-rose));
    padding:2px 0 2px 10px;
    font-family:Lora,Georgia,serif; font-style:italic;
    font-size:13px; line-height:1.5; color:var(--mk-faint);
  }

  /* ---- selection toolbar ------------------------------------------------- */
  .mk-toolbar {
    display:inline-flex; align-items:center; gap:12px;
    background:var(--mk-panel); border:1px solid var(--mk-border);
    border-radius:999px; padding:10px 14px; box-shadow:var(--mk-shadow-bar);
    animation:mk-pop-in 160ms cubic-bezier(0.34,1.56,0.64,1);
  }
  .mk-dotrow { display:inline-flex; align-items:center; gap:10px; }
  .mk-divider { width:1px; height:22px; background:var(--mk-border); }
  .mk-dot {
    width:24px; height:24px; border-radius:50%; border:none; cursor:pointer; padding:0;
    background:var(--dot);
    box-shadow:inset 0 0 0 1px rgba(32,26,18,0.18);
    transition:transform 140ms cubic-bezier(0.34,1.56,0.64,1), box-shadow 140ms;
  }
  .mk-dot:hover, .mk-dot[aria-pressed="true"] {
    transform:scale(1.18);
    box-shadow:inset 0 0 0 1px rgba(32,26,18,0.18), 0 0 0 3px var(--mk-panel), 0 0 0 5px var(--dot);
  }
  .mk-dot:active { transform:scale(0.95); }
  .mk-dot--sm { width:20px; height:20px; }

  /* ---- buttons ----------------------------------------------------------- */
  .mk-btn-primary {
    font-family:'JetBrains Mono',ui-monospace,monospace; font-size:12.5px; font-weight:600;
    background:var(--mk-accent); color:var(--mk-on-accent);
    border:none; border-radius:8px; padding:8px 18px; cursor:pointer;
    display:inline-flex; align-items:center; gap:7px;
    transition:transform 120ms, box-shadow 120ms, background 120ms;
  }
  .mk-btn-primary:hover { background:var(--mk-accent-hover); transform:translateY(-1px); }
  .mk-btn-primary:active { transform:translateY(0); }
  .mk-btn-ghost {
    display:inline-flex; align-items:center; justify-content:center; gap:7px;
    font-family:'JetBrains Mono',ui-monospace,monospace; font-size:12px;
    color:var(--mk-muted); background:transparent; border:1px solid var(--mk-border);
    border-radius:8px; padding:8px 12px; cursor:pointer;
    transition:background 120ms, border-color 120ms, color 120ms;
  }
  .mk-btn-ghost:hover { background:var(--mk-inset); border-color:var(--mk-border-hover); color:var(--mk-ink); }
  .mk-btn-danger {
    display:inline-flex; align-items:center; justify-content:center; gap:7px;
    font-family:'JetBrains Mono',ui-monospace,monospace; font-size:12px;
    color:var(--mk-danger); background:transparent;
    border:1px solid var(--mk-danger); border-radius:8px; padding:8px 12px; cursor:pointer;
    transition:background 120ms, border-color 120ms;
  }
  .mk-btn-danger:hover { background:var(--mk-danger-tint); }
  .mk-btn-icon {
    width:32px; height:32px; border-radius:8px; flex:none;
    display:inline-flex; align-items:center; justify-content:center;
    background:transparent; border:none; cursor:pointer; padding:0;
    color:var(--mk-muted);
    transition:background 120ms, transform 120ms, color 120ms;
  }
  .mk-btn-icon:hover { background:var(--mk-inset); color:var(--mk-ink); }
  .mk-btn-icon:active { transform:scale(0.92); }
  .mk-btn-icon--danger { color:var(--mk-danger); }
  .mk-btn-icon--danger:hover { background:var(--mk-danger-tint); color:var(--mk-danger); }
  .mk-btn-icon svg { width:17px; height:17px; display:block; }
  .mk-btn-icon--sm { width:26px; height:26px; }
  .mk-btn-icon--sm svg { width:15px; height:15px; }
  /* label icons inside text buttons */
  .mk-btn-primary svg, .mk-btn-ghost svg, .mk-btn-danger svg { width:14px; height:14px; flex:none; }
  .mk-thumb-svg svg { width:15px; height:15px; flex:none; }
  .mk-card__warn svg { width:13px; height:13px; flex:none; }

  .mk-tooltip { position:relative; }
  .mk-tooltip::after {
    content:attr(data-tip);
    position:absolute; top:calc(100% + 6px); left:50%;
    transform:translateX(-50%) translateY(-2px);
    background:var(--mk-ink); color:var(--mk-panel);
    font-family:'JetBrains Mono',ui-monospace,monospace; font-size:10px;
    padding:3px 8px; border-radius:5px; white-space:nowrap; pointer-events:none;
    opacity:0; transition:opacity 120ms 250ms, transform 120ms 250ms; z-index:10;
  }
  .mk-tooltip:hover::after { opacity:1; transform:translateX(-50%) translateY(0); }

  /* ---- editor popups (note + image) -------------------------------------- */
  .mk-editor { width:340px; padding:14px; display:flex; flex-direction:column; gap:12px; }
  .mk-panel-footer { display:flex; justify-content:space-between; align-items:center; gap:10px; }
  .mk-status { font-family:'JetBrains Mono',ui-monospace,monospace; font-size:11px; color:var(--mk-faint); }
  .mk-thumb {
    max-width:100%; max-height:200px; object-fit:contain;
    background:var(--mk-inset); border:1px solid var(--mk-border); border-radius:9px;
  }

  /* ---- sidebar ----------------------------------------------------------- */
  .mk-sidebar {
    position:fixed; top:0; right:0; width:340px; height:100vh; z-index:2147483647;
    background:var(--mk-panel); border-left:1px solid var(--mk-border);
    box-shadow:var(--mk-shadow-pop); display:flex; flex-direction:column;
    color:var(--mk-ink);
  }
  .mk-sidebar-header {
    display:flex; align-items:center; justify-content:space-between;
    padding:14px 14px 12px; border-bottom:1px solid var(--mk-border-soft);
  }
  .mk-sidebar-title { font-family:Lora,Georgia,serif; font-size:19px; font-weight:600; color:var(--mk-ink); }
  .mk-header-actions { display:flex; align-items:center; gap:8px; }

  .mk-toggle {
    width:34px; height:20px; border-radius:10px; border:none; cursor:pointer; flex:none;
    background:var(--mk-border-hover); position:relative; padding:0; transition:background 160ms;
  }
  .mk-toggle[aria-checked="true"] { background:var(--mk-success); }
  .mk-toggle::after {
    content:""; position:absolute; top:2px; left:2px; width:16px; height:16px;
    border-radius:50%; background:var(--mk-panel);
    transition:transform 160ms cubic-bezier(0.34,1.56,0.64,1);
  }
  .mk-toggle[aria-checked="true"]::after { transform:translateX(14px); }

  .mk-doc-meta { padding:12px 14px 6px; display:flex; flex-direction:column; gap:8px; }
  .mk-doc-title, .mk-doc-subtitle {
    display:block; resize:none; overflow:hidden; line-height:1.35; font-family:inherit;
  }
  .mk-doc-title { font-family:Lora,Georgia,serif; font-size:16px; font-weight:600; }
  .mk-doc-subtitle { font-family:Lora,Georgia,serif; font-style:italic; font-size:13.5px; color:var(--mk-body); }

  .mk-doc-tags { padding:8px 14px 12px; border-bottom:1px solid var(--mk-border-soft); display:flex; flex-wrap:wrap; align-items:center; gap:6px; }
  .mk-doc-tags .mk-label { margin-right:2px; }
  .mk-tag {
    font-family:'JetBrains Mono',ui-monospace,monospace; font-size:11px;
    background:var(--mk-inset); color:var(--mk-muted); border-radius:5px; padding:3px 8px;
    display:inline-flex; align-items:center; gap:5px;
  }
  .mk-tag .mk-tag-x { cursor:pointer; opacity:0.6; font-size:12px; line-height:1; }
  .mk-tag .mk-tag-x:hover { opacity:1; }
  .mk-tag-add {
    font-family:'JetBrains Mono',ui-monospace,monospace; font-size:11px; color:var(--mk-muted);
    background:transparent; border:1px dashed var(--mk-border-hover); border-radius:5px;
    padding:3px 8px; cursor:pointer;
  }
  .mk-tag-add:hover { color:var(--mk-ink); border-color:var(--mk-ink); }
  .mk-tag-input {
    font-family:'JetBrains Mono',ui-monospace,monospace; font-size:11px;
    background:var(--mk-inset); color:var(--mk-ink); border:1px solid var(--mk-accent);
    border-radius:5px; padding:3px 8px; outline:none; width:110px;
  }

  .mk-list { overflow-y:auto; flex:1; padding:10px 14px; display:flex; flex-direction:column; gap:10px; }
  .mk-empty { color:var(--mk-faint); font-family:Lora,Georgia,serif; font-style:italic; font-size:13.5px; padding:16px 4px; text-align:center; }

  .mk-card {
    position:relative;
    background:var(--mk-card); border:1px solid var(--mk-border-soft);
    border-left:3px solid var(--mk-hl-current, var(--mk-hl-amber));
    border-radius:10px; padding:11px 12px; display:flex; flex-direction:column; gap:6px;
    cursor:pointer; transition:transform 120ms, box-shadow 120ms, border-color 120ms;
  }
  .mk-card:hover { transform:translateY(-1px); border-color:var(--mk-border-hover); box-shadow:var(--mk-card-hover-shadow); }
  .mk-card__excerpt { font-size:12.5px; line-height:1.55; color:var(--mk-body); }
  .mk-card__note { font-family:Lora,Georgia,serif; font-style:italic; font-size:12.5px; color:var(--mk-faint); }
  .mk-card__tags { display:flex; flex-wrap:wrap; gap:5px; }
  .mk-card--missing { border:1px dashed var(--mk-border-hover); border-left-width:1px; cursor:default; opacity:0.92; }
  .mk-card__warn { font-family:'JetBrains Mono',ui-monospace,monospace; font-size:11px; color:var(--mk-danger); display:flex; align-items:center; gap:5px; }
  .mk-card__del {
    position:absolute; top:7px; right:7px; width:24px; height:24px; border-radius:6px;
    display:inline-flex; align-items:center; justify-content:center;
    background:transparent; border:none; cursor:pointer; color:var(--mk-faint);
    opacity:0; transition:opacity 120ms, background 120ms, color 120ms;
  }
  .mk-card:hover .mk-card__del { opacity:1; }
  .mk-card__del:hover { background:var(--mk-danger-tint); color:var(--mk-danger); }
  .mk-card__del svg { width:14px; height:14px; display:block; }
  .mk-thumb-img { display:block; max-width:100%; max-height:120px; object-fit:contain; background:var(--mk-inset); border-radius:8px; }
  .mk-thumb-svg {
    display:flex; align-items:center; justify-content:center; gap:6px; height:48px;
    font-family:'JetBrains Mono',ui-monospace,monospace; font-size:12px;
    color:var(--mk-muted); background:var(--mk-inset); border-radius:8px;
  }

  /* ---- sidebar footer ---------------------------------------------------- */
  .mk-footer { padding:12px 14px; border-top:1px solid var(--mk-border-soft); }
  .mk-footer-actions { display:flex; gap:8px; align-items:stretch; }
  .mk-footer-actions .mk-btn-ghost { flex:1; }
  .mk-footer-actions .mk-btn-icon--danger { border:1px solid var(--mk-border); border-radius:8px; }

  .mk-notice {
    position:relative; margin-bottom:10px;
    background:var(--mk-danger-tint); border:1px solid var(--mk-danger);
    border-radius:9px; padding:9px 28px 9px 11px;
    font-size:12.5px; line-height:1.5; color:var(--mk-danger);
  }
  .mk-notice code { font-family:'JetBrains Mono',ui-monospace,monospace; background:var(--mk-inset); padding:0 3px; border-radius:3px; }
  .mk-notice-close {
    position:absolute; top:5px; right:5px; width:20px; height:20px; border-radius:5px;
    display:inline-flex; align-items:center; justify-content:center;
    background:transparent; border:none; cursor:pointer; color:var(--mk-danger);
  }
  .mk-notice-close:hover { background:var(--mk-danger-tint); }
  .mk-notice-close svg { width:12px; height:12px; }

  .mk-confirm { display:flex; flex-direction:column; gap:10px; }
  .mk-confirm-text { font-size:12.5px; line-height:1.5; color:var(--mk-body); }
  .mk-confirm-text code { font-family:'JetBrains Mono',ui-monospace,monospace; background:var(--mk-inset); padding:0 3px; border-radius:3px; }
  .mk-confirm-actions { display:flex; justify-content:flex-end; gap:8px; }

  /* ---- reconcile (missing-file) modal ------------------------------------ */
  .mk-reconcile {
    position:absolute; inset:0; z-index:10; padding:18px;
    display:flex; align-items:center; justify-content:center;
    background:color-mix(in srgb, var(--mk-inset) 78%, transparent);
    backdrop-filter:blur(2px);
  }
  .mk-reconcile-card {
    background:var(--mk-card); border:1px solid var(--mk-border-hover);
    border-radius:12px; padding:16px; display:flex; flex-direction:column; gap:12px;
    box-shadow:var(--mk-shadow-pop);
  }
  .mk-reconcile-title { font-family:Lora,Georgia,serif; font-weight:600; font-size:16px; color:var(--mk-danger); }
  .mk-reconcile-body { font-size:13px; line-height:1.55; color:var(--mk-body); }
  .mk-reconcile-body code { font-family:'JetBrains Mono',ui-monospace,monospace; background:var(--mk-inset); padding:0 3px; border-radius:3px; }
  .mk-reconcile-actions { display:flex; flex-direction:column; gap:8px; margin-top:2px; }
  .mk-reconcile-actions .mk-btn-primary, .mk-reconcile-actions .mk-btn-ghost, .mk-reconcile-actions .mk-btn-danger { justify-content:center; width:100%; padding:10px 12px; }

  /* ---- sidebar tab ------------------------------------------------------- */
  .mk-tab {
    position:fixed; top:50%; right:10px; transform:translateY(-50%);
    width:38px; height:38px; z-index:2147483646;
    display:flex; align-items:center; justify-content:center;
    background:var(--mk-panel); color:var(--mk-accent);
    border:1px solid var(--mk-border); border-radius:10px; cursor:pointer;
    box-shadow:var(--mk-shadow-bar); transition:transform 120ms, background 120ms;
  }
  .mk-tab:hover { transform:translateY(-50%) scale(1.05); background:var(--mk-inset); }
  .mk-tab svg { width:20px; height:20px; }

  /* ---- toast ------------------------------------------------------------- */
  .mk-toast {
    position:fixed; bottom:24px; left:50%; transform:translateX(-50%);
    z-index:2147483647; max-width:420px;
    background:var(--mk-panel); color:var(--mk-ink);
    border:1px solid var(--mk-border); border-radius:10px;
    box-shadow:var(--mk-shadow-pop); padding:11px 15px;
    font-size:13px; line-height:1.45;
    animation:mk-pop-in 160ms cubic-bezier(0.34,1.56,0.64,1);
  }

  /* ---- motion ------------------------------------------------------------ */
  @keyframes mk-pop-in {
    from { opacity:0; transform:scale(0.92) translateY(4px); }
    to   { opacity:1; transform:scale(1) translateY(0); }
  }
  @media (prefers-reduced-motion: reduce) {
    .mk-toolbar, .mk-dot, .mk-card, .mk-btn-primary, .mk-toggle::after, .mk-toast, .mk-tab { transition:none; animation:none; }
  }
`;

// Inline SVG icons (currentColor). Kept here so every builder shares one source.
export const ICONS = {
  pencil: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M10 11v6M14 11v6"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  snowflake: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M2 12h20M4.9 4.9l14.2 14.2M19.1 4.9 4.9 19.1M12 5l-3 2m3-2 3 2m-3 12-3-2m3 2 3-2M5 12l2-3m-2 3 2 3m12-3-2-3m2 3-2 3"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h10M4 12h6M4 18h12"/><circle cx="18" cy="6" r="2"/><circle cx="14" cy="12" r="2"/><circle cx="18" cy="18" r="2"/></svg>',
  diagram: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><path d="M10 6.5h4a3 3 0 0 1 3 3V14"/></svg>',
  warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/></svg>',
  save: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 10 4 15l5 5"/><path d="M20 4v7a4 4 0 0 1-4 4H4"/></svg>',
};
