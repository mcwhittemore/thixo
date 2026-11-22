/** The shell's own stylesheet: the design tokens as custom properties (S4), the `thixo/ui` components, the slot box,
 * and the shell's panels. An implementor overrides any `--thixo-*` property on the page. */
export const SHELL_CSS = `
:root {
  --thixo-color-text: #1d2330;
  --thixo-color-muted: #626b7f;
  --thixo-color-background: #f6f7f9;
  --thixo-color-surface: #ffffff;
  --thixo-color-border: #dde1e8;
  --thixo-color-accent: #3b5bdb;
  --thixo-color-success: #2b8a3e;
  --thixo-color-warning: #b35c00;
  --thixo-color-danger: #c92a2a;
  --thixo-space-xs: 4px;
  --thixo-space-sm: 8px;
  --thixo-space-md: 12px;
  --thixo-space-lg: 20px;
  --thixo-space-xl: 32px;
  --thixo-radius-sm: 4px;
  --thixo-radius-md: 6px;
  --thixo-radius-lg: 10px;
  --thixo-font-size-sm: 13px;
  --thixo-font-size-md: 15px;
  --thixo-font-size-lg: 18px;
  --thixo-font-size-xl: 24px;
  --thixo-font: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
.thixo-shell { font-family: var(--thixo-font); color: var(--thixo-color-text); font-size: var(--thixo-font-size-md); }
.thixo-slot-box { box-sizing: border-box; }
.thixo-slot-empty { border: 1px dashed var(--thixo-color-border); border-radius: var(--thixo-radius-md); color: var(--thixo-color-muted); padding: var(--thixo-space-sm); font-size: var(--thixo-font-size-sm); }
.thixo-slot-loading { color: var(--thixo-color-muted); font-size: var(--thixo-font-size-sm); padding: var(--thixo-space-sm); }
.thixo-slot-message { border: 1px solid var(--thixo-color-danger); color: var(--thixo-color-danger); border-radius: var(--thixo-radius-md); padding: var(--thixo-space-sm); font-size: var(--thixo-font-size-sm); background: var(--thixo-color-surface); }
.thixo-text.thixo-tone-muted { color: var(--thixo-color-muted); }
.thixo-tone-info { color: var(--thixo-color-accent); }
.thixo-tone-success { color: var(--thixo-color-success); }
.thixo-tone-warning { color: var(--thixo-color-warning); }
.thixo-tone-danger { color: var(--thixo-color-danger); }
.thixo-button { font: inherit; font-size: var(--thixo-font-size-sm); padding: var(--thixo-space-xs) var(--thixo-space-md); border-radius: var(--thixo-radius-sm); border: 1px solid var(--thixo-color-border); background: var(--thixo-color-surface); color: var(--thixo-color-text); cursor: pointer; }
.thixo-button:hover:not(:disabled) { border-color: var(--thixo-color-accent); }
.thixo-button:disabled { opacity: 0.5; cursor: not-allowed; }
.thixo-button-primary { background: var(--thixo-color-accent); border-color: var(--thixo-color-accent); color: #fff; }
.thixo-button-danger { color: var(--thixo-color-danger); }
.thixo-input { font: inherit; padding: var(--thixo-space-xs) var(--thixo-space-sm); border: 1px solid var(--thixo-color-border); border-radius: var(--thixo-radius-sm); background: var(--thixo-color-surface); color: var(--thixo-color-text); min-width: 0; }
.thixo-input:focus { outline: 2px solid var(--thixo-color-accent); outline-offset: -1px; }
.thixo-field { display: inline-flex; flex-direction: column; gap: var(--thixo-space-xs); font-size: var(--thixo-font-size-sm); color: var(--thixo-color-muted); }
.thixo-checkbox { display: inline-flex; align-items: center; gap: var(--thixo-space-xs); }
.thixo-badge { display: inline-block; font-size: var(--thixo-font-size-sm); padding: 0 var(--thixo-space-sm); border-radius: 999px; border: 1px solid currentColor; line-height: 1.6; }
.thixo-card { border: 1px solid var(--thixo-color-border); border-radius: var(--thixo-radius-lg); background: var(--thixo-color-surface); padding: var(--thixo-space-md); }
.thixo-card-title { margin: 0 0 var(--thixo-space-sm); font-size: var(--thixo-font-size-md); }
.thixo-panel { border: 1px solid var(--thixo-color-border); border-radius: var(--thixo-radius-lg); background: var(--thixo-color-surface); padding: var(--thixo-space-md); display: flex; flex-direction: column; gap: var(--thixo-space-sm); }
.thixo-panel h2 { margin: 0; font-size: var(--thixo-font-size-lg); }
.thixo-panel h3 { margin: 0; font-size: var(--thixo-font-size-md); }
.thixo-row { display: flex; gap: var(--thixo-space-sm); align-items: center; flex-wrap: wrap; }
.thixo-muted { color: var(--thixo-color-muted); font-size: var(--thixo-font-size-sm); }
.thixo-result { border-top: 1px solid var(--thixo-color-border); padding-top: var(--thixo-space-sm); display: flex; flex-direction: column; gap: var(--thixo-space-xs); }
.thixo-result ul { margin: 0; padding-left: 1.2em; }
.thixo-chat-log { display: flex; flex-direction: column; gap: var(--thixo-space-xs); max-height: 20rem; overflow: auto; }
.thixo-chat-user { align-self: flex-end; background: var(--thixo-color-accent); color: #fff; border-radius: var(--thixo-radius-md); padding: var(--thixo-space-xs) var(--thixo-space-sm); }
.thixo-chat-agent { white-space: pre-wrap; }
.thixo-chat-tool { color: var(--thixo-color-muted); font-size: var(--thixo-font-size-sm); }
.thixo-modal-backdrop { position: fixed; inset: 0; background: rgba(20, 24, 33, 0.45); display: flex; align-items: center; justify-content: center; z-index: 2147483000; }
.thixo-modal { background: var(--thixo-color-surface); border-radius: var(--thixo-radius-lg); padding: var(--thixo-space-lg); min-width: 18rem; max-width: min(40rem, 92vw); max-height: 85vh; display: flex; flex-direction: column; gap: var(--thixo-space-md); }
.thixo-modal header { display: flex; justify-content: space-between; align-items: center; gap: var(--thixo-space-md); }
.thixo-modal h2 { margin: 0; font-size: var(--thixo-font-size-lg); }
.thixo-modal .thixo-source { margin: var(--thixo-space-xs, 2px) 0 0; font-size: var(--thixo-font-size-sm); color: var(--thixo-color-muted, #5b6472); }
.thixo-toast .thixo-source { display: block; opacity: 0.85; font-size: 0.85em; margin-top: 2px; }
.thixo-badge-default { margin-left: var(--thixo-space-sm); }
.thixo-toasts { position: fixed; bottom: var(--thixo-space-lg); right: var(--thixo-space-lg); display: flex; flex-direction: column; gap: var(--thixo-space-sm); z-index: 2147483001; }
.thixo-toast { background: var(--thixo-color-text); color: #fff; padding: var(--thixo-space-sm) var(--thixo-space-md); border-radius: var(--thixo-radius-md); font-size: var(--thixo-font-size-sm); }
.thixo-toast.thixo-tone-success { background: var(--thixo-color-success); color: #fff; }
.thixo-toast.thixo-tone-warning { background: var(--thixo-color-warning); color: #fff; }
.thixo-toast.thixo-tone-danger { background: var(--thixo-color-danger); color: #fff; }
`;
