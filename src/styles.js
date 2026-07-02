// Shadow-DOM stylesheet for all Meraki UI (popups + sidebar). Isolated in the
// shadow root so host-page CSS can't reach it and ours can't leak out.

export const SHADOW_CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: system-ui, sans-serif; }
    .hidden { display: none !important; }
    .popup {
      position: fixed; z-index: 2147483647;
      background: #1f2430; color: #e6e6e6;
      border: 1px solid #3a4152; border-radius: 8px;
      box-shadow: 0 4px 18px rgba(0,0,0,0.35);
      padding: 8px; font-size: 15px;
    }
    .action-popup { display: flex; align-items: center; gap: 8px; }
    .swatches { display: flex; gap: 5px; }
    .swatch {
      width: 20px; height: 20px; border-radius: 50%;
      border: 2px solid transparent; cursor: pointer; padding: 0;
    }
    .swatch.selected { border-color: #fff; }
    .note-btn, .popup-actions button {
      background: #2c3444; color: #e6e6e6; border: 1px solid #3a4152;
      border-radius: 6px; padding: 4px 10px; cursor: pointer; font-size: 14px;
    }
    .note-btn:hover, .popup-actions button:hover { background: #38415a; }
    .comment-popup { display: flex; flex-direction: column; gap: 10px; width: 340px; }
    .image-popup { display: flex; flex-direction: column; gap: 10px; width: 340px; }
    .image-popup .thumb {
      max-width: 100%; max-height: 200px; object-fit: contain;
      background: #12151c; border: 1px solid #3a4152; border-radius: 6px;
    }
    .note-input { min-height: 110px; resize: vertical; line-height: 1.45; }
    .note-input, .tags-input {
      background: #12151c; color: #e6e6e6; border: 1px solid #3a4152;
      border-radius: 6px; padding: 9px 10px; font-size: 16px; width: 100%;
    }
    .popup-actions { display: flex; justify-content: space-between; align-items: center; }
    .popup-actions .danger { border-color: #6b2b2b; color: #ffb4b4; }
    .save-status { font-size: 13px; opacity: 0.6; }
    .sidebar {
      position: fixed; top: 0; right: 0; width: 320px; height: 100vh;
      background: #1f2430; color: #e6e6e6; border-left: 1px solid #3a4152;
      box-shadow: -4px 0 18px rgba(0,0,0,0.3);
      display: flex; flex-direction: column; z-index: 2147483647;
    }
    .sidebar-header {
      display: flex; justify-content: space-between; align-items: center;
      padding: 12px 14px; font-weight: 600; border-bottom: 1px solid #3a4152;
    }
    .sidebar-header button { background: none; border: none; color: #e6e6e6; font-size: 22px; cursor: pointer; }
    .header-actions { display: flex; align-items: center; gap: 10px; }
    .switch { position: relative; width: 38px; height: 20px; flex: none; }
    .switch input { opacity: 0; width: 0; height: 0; }
    .switch .slider {
      position: absolute; inset: 0; cursor: pointer;
      background: rgba(127,127,127,0.4); border-radius: 20px; transition: 0.15s;
    }
    .switch .slider::before {
      content: ""; position: absolute; height: 14px; width: 14px;
      left: 3px; top: 3px; background: #fff; border-radius: 50%; transition: 0.15s;
    }
    .switch input:checked + .slider { background: #3fb950; }
    .switch input:checked + .slider::before { transform: translateX(18px); }
    .doc-meta { padding: 10px 14px 4px; display: flex; flex-direction: column; gap: 8px; }
    .doc-title, .doc-subtitle {
      width: 100%; background: #12151c; color: #e6e6e6; border: 1px solid #3a4152;
      border-radius: 6px; padding: 10px 10px;
      display: block; resize: none; overflow: hidden;
      font-family: inherit; line-height: 1.35;
    }
    .doc-title { font-size: 16px; font-weight: 600; }
    .doc-subtitle { font-size: 14px; }
    .doc-tags { padding: 10px 14px; border-bottom: 1px solid #3a4152; }
    .section-label { font-size: 13px; text-transform: uppercase; opacity: 0.6; margin-bottom: 6px; }
    .chips { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 6px; }
    .chip {
      background: #2c3444; border-radius: 12px; padding: 2px 9px; font-size: 14px;
      display: inline-flex; align-items: center; gap: 4px;
    }
    .chip .x { cursor: pointer; opacity: 0.7; }
    .tag-add {
      width: 100%; background: #12151c; color: #e6e6e6; border: 1px solid #3a4152;
      border-radius: 6px; padding: 9px 10px; font-size: 14px;
    }
    .annot-list { overflow-y: auto; flex: 1; padding: 8px 10px; }
    .annot-item {
      position: relative;
      padding: 9px 28px 9px 10px; border-radius: 8px; margin-bottom: 8px;
      background: #262c3a; cursor: pointer; border: 1px solid transparent;
    }
    .annot-item:hover { border-color: #4a5578; }
    .annot-del {
      position: absolute; top: 6px; right: 6px;
      width: 20px; height: 20px; line-height: 1; padding: 0;
      border: none; border-radius: 4px; background: transparent;
      color: #9aa4bf; font-size: 18px; cursor: pointer;
      opacity: 0; transition: opacity 0.1s;
    }
    .annot-item:hover .annot-del { opacity: 1; }
    .annot-del:hover { background: #6b2b2b; color: #ffb4b4; }
    .annot-item.orphaned { opacity: 0.6; }
    .annot-quote { font-size: 15px; line-height: 1.35; }
    .annot-thumb {
      display: block; max-width: 100%; max-height: 120px; object-fit: contain;
      background: #12151c; border-radius: 6px; margin-bottom: 2px;
    }
    .mini-swatch { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 6px; vertical-align: middle; }
    .annot-note { font-size: 14px; opacity: 0.85; margin-top: 5px; font-style: italic; }
    .annot-tags { margin-top: 6px; display: flex; flex-wrap: wrap; gap: 4px; }
    .orphan-tag { font-size: 13px; color: #ffb86b; margin-top: 5px; }
    .empty { opacity: 0.6; font-size: 15px; padding: 12px; text-align: center; }
    .sidebar-footer { padding: 10px 14px; border-top: 1px solid #3a4152; }
    .footer-notice {
      position: relative; margin-bottom: 10px;
      background: rgba(255,184,107,0.10); border: 1px solid #6b5330;
      border-radius: 6px; padding: 9px 26px 9px 10px;
      font-size: 14px; line-height: 1.45; color: #ffb86b;
    }
    .footer-notice code { background: #12151c; padding: 0 3px; border-radius: 3px; }
    .notice-close {
      position: absolute; top: 4px; right: 4px;
      width: 20px; height: 20px; line-height: 1; padding: 0;
      border: none; border-radius: 4px; background: transparent;
      color: #9aa4bf; font-size: 17px; cursor: pointer;
    }
    .notice-close:hover { background: #38415a; color: #fff; }
    .footer-actions { display: flex; gap: 8px; }
    .footer-btn {
      flex: 1; background: #2c3444; color: #cdd6f4; border: 1px solid #3a4152;
      border-radius: 6px; padding: 9px 10px; font-size: 14px; cursor: pointer;
    }
    .footer-btn:hover { background: #38415a; }
    .delete-btn:hover { background: #6b2b2b; color: #fff; border-color: #6b2b2b; }
    .footer-confirm { display: flex; flex-direction: column; gap: 10px; }
    .footer-warn { font-size: 14px; line-height: 1.45; color: #ffb86b; }
    .footer-warn code { background: #12151c; padding: 0 3px; border-radius: 3px; }
    .footer-confirm-actions { display: flex; justify-content: flex-end; gap: 8px; }
    .footer-confirm-actions button {
      background: #2c3444; color: #e6e6e6; border: 1px solid #3a4152;
      border-radius: 6px; padding: 6px 11px; font-size: 14px; cursor: pointer;
    }
    .footer-confirm-actions button:hover { background: #38415a; }
    .footer-confirm-actions .danger { border-color: #6b2b2b; color: #ffb4b4; }
    .footer-confirm-actions .danger:hover { background: #6b2b2b; color: #fff; }
    .reconcile-overlay {
      position: absolute; inset: 0; z-index: 10;
      background: rgba(15,18,24,0.88);
      display: flex; align-items: center; justify-content: center; padding: 18px;
    }
    .reconcile-card {
      background: #262c3a; border: 1px solid #4a5578; border-radius: 10px;
      padding: 16px; display: flex; flex-direction: column; gap: 12px;
      box-shadow: 0 8px 30px rgba(0,0,0,0.55);
    }
    .reconcile-title { font-weight: 600; font-size: 16px; color: #ffb86b; }
    .reconcile-body { font-size: 14.5px; line-height: 1.5; color: #e6e6e6; }
    .reconcile-body code { background: #12151c; padding: 0 3px; border-radius: 3px; }
    .reconcile-actions { display: flex; flex-direction: column; gap: 8px; margin-top: 2px; }
    .reconcile-actions button {
      padding: 9px 12px; border-radius: 6px; font-size: 15px; cursor: pointer;
      border: 1px solid #3a4152; background: #2c3444; color: #e6e6e6;
    }
    .reconcile-actions .primary { background: #2f6f43; border-color: #2f6f43; color: #fff; }
    .reconcile-actions .primary:hover { background: #38854f; }
    .reconcile-actions .danger { border-color: #6b2b2b; color: #ffb4b4; }
    .reconcile-actions .danger:hover { background: #6b2b2b; color: #fff; }
    .sidebar-tab {
      position: fixed; top: 50%; right: 8px; transform: translateY(-50%);
      background: #2c3444; color: #e6e6e6; border: 1px solid #3a4152;
      border-radius: 8px; padding: 10px 10px;
      cursor: pointer; font-size: 18px; z-index: 2147483646;
      box-shadow: 0 2px 10px rgba(0,0,0,0.3);
    }
    .sidebar-tab:hover { background: #38415a; }
  `;
