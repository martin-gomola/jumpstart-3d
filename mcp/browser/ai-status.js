import tokens from "../tokens/ai-status.json" with { type: "json" };
export const STATUS_HOLD_MS = Number.parseFloat(tokens.feedback.$value);

const cssTokens = Object.entries(tokens).map(([key, token]) => `--ai-status-${key}: ${token.$value};`).join(" ");
export const AI_STATUS_CSS = `
:root { ${cssTokens} }
.ai-status { appearance: none; position: relative; display: inline-flex; align-items: center; justify-content: center; gap: var(--ai-status-gap); min-width: var(--ai-status-target); min-height: var(--ai-status-target); flex: none; padding: 0; border: 0; background: transparent; color: var(--ai-status-ink); font: 500 var(--ai-status-font)/1.35 var(--f-ui); border-radius: var(--ai-status-radius); cursor: pointer; }
.ai-status[hidden] { display: none; }
.ai-status:focus-visible { outline: var(--ai-status-stroke) solid var(--ai-status-focus); outline-offset: var(--ai-status-stroke); }
.ai-status:active { transform: translateY(var(--ai-status-pressOffset)); }
.ai-status-light { width: var(--ai-status-light); height: var(--ai-status-light); border-radius: 50%; background: var(--ai-status-muted); }
.ai-status[data-state="checking"] .ai-status-light, .ai-status[data-state="waiting"] .ai-status-light, .ai-status[data-state="recent"] .ai-status-light { background: var(--ai-status-pending); }
.ai-status[data-state="connected"] .ai-status-light, .ai-status[data-state="completed"] .ai-status-light { background: var(--ai-status-connected); }
.ai-status[data-state="reading"] .ai-status-light, .ai-status[data-state="previewing"] .ai-status-light, .ai-status[data-state="editing"] .ai-status-light, .ai-status[data-state="saving"] .ai-status-light, .ai-status[data-state="exporting"] .ai-status-light, .ai-status[data-state="working"] .ai-status-light { background: var(--ai-status-activity); }
.ai-status[data-state="error"] .ai-status-light { background: var(--ai-status-error); }
.ai-status-full { position: absolute; width: var(--ai-status-hiddenSize); height: var(--ai-status-hiddenSize); padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.ai-status-short { white-space: nowrap; }
.ai-status-tooltip { display: none; box-sizing: border-box; position: fixed; inset-block-start: calc(var(--ai-status-anchor-bottom, 0rem) + var(--ai-status-tooltipOffset)); inset-inline-start: max(var(--ai-status-tooltipOffset), calc(min(var(--ai-status-anchor-right, 100vw), 100vw) - min(var(--ai-status-tooltipWidth), calc(100vw - var(--ai-status-target))))); width: var(--ai-status-tooltipWidth); max-width: min(var(--ai-status-tooltipWidth), calc(100vw - var(--ai-status-target))); padding: var(--ai-status-tooltipPadding); border-radius: var(--ai-status-radius); background: var(--ai-status-surface); color: var(--ai-status-ink); white-space: normal; z-index: 100; pointer-events: auto; }
.ai-status:not([data-tooltip-dismissed]):hover .ai-status-tooltip, .ai-status:not([data-tooltip-dismissed]):focus .ai-status-tooltip { display: block; }
.ai-status[data-setup-open="true"]:not([data-tooltip-dismissed]):hover .ai-status-tooltip, .ai-status[data-setup-open="true"]:not([data-tooltip-dismissed]):focus .ai-status-tooltip { display: none; }
.ai-status-tooltip::before { content: ""; position: absolute; inset-inline: 0; bottom: 100%; height: var(--ai-status-tooltipOffset); }
.ai-setup-panel { position: fixed; inset-block-start: calc(var(--ai-status-panelTop) + env(safe-area-inset-top, 0)); inset-inline-end: 0; inset-block-end: 0; z-index: var(--ai-status-panelLayer); box-sizing: border-box; display: flex; flex-direction: column; width: 100%; max-width: var(--ai-status-panelWidth); overflow-y: auto; background: var(--panel); color: var(--ink); border-inline-start: var(--ai-status-panelBorder) solid var(--line); }
.ai-setup-panel[hidden] { display: none; }
.ai-setup-header { display: flex; align-items: center; gap: var(--ai-status-panelGap); padding: var(--ai-status-panelPadding); border-block-end: var(--ai-status-panelBorder) solid var(--line-2); }
.ai-setup-header h2 { flex: 1; margin: 0; font: 600 var(--ai-status-panelTitleSize)/var(--ai-status-panelSmallLine) var(--f-label); letter-spacing: var(--ai-status-panelTracking); text-transform: uppercase; }
.ai-setup-close, .ai-setup-copy { border: var(--ai-status-panelBorder) solid var(--line); border-radius: var(--r); padding: var(--ai-status-gap); background: var(--panel-2); color: var(--ink); cursor: pointer; }
.ai-setup-close:active, .ai-setup-copy:active { transform: translateY(var(--ai-status-pressOffset)); }
.ai-setup-body { display: flex; flex-direction: column; gap: var(--ai-status-panelGap); padding: var(--ai-status-panelPadding); overflow-y: auto; }
.ai-setup-body[hidden] { display: none; }
.ai-setup-current { display: grid; gap: var(--ai-status-gap); padding-block-end: var(--ai-status-panelGap); border-block-end: var(--ai-status-panelBorder) solid var(--line-2); }
.ai-setup-current strong { font-weight: 600; }
.ai-setup-current p, .ai-setup-client p, .ai-setup-note { margin: 0; color: var(--ink-2); line-height: var(--ai-status-panelBodyLine); }
.ai-setup-kicker, .ai-setup-client h3 { color: var(--ink-2); font: 600 var(--ai-status-font)/var(--ai-status-panelSmallLine) var(--f-label); letter-spacing: var(--ai-status-panelKickerTracking); text-transform: uppercase; }
.ai-setup-note { padding-block-end: var(--ai-status-panelGap); border-block-end: var(--ai-status-panelBorder) solid var(--line-2); }
.ai-setup-client { display: grid; gap: var(--ai-status-gap); padding-block-end: var(--ai-status-panelGap); border-block-end: var(--ai-status-panelBorder) solid var(--line-2); }
.ai-setup-client h3 { margin: 0; color: var(--ink); }
.ai-setup-client pre { box-sizing: border-box; max-width: 100%; margin: 0; padding: var(--ai-status-panelGap); overflow-x: auto; border-radius: var(--ai-status-radius); background: var(--block); color: var(--block-ink); white-space: pre-wrap; overflow-wrap: anywhere; font: 500 var(--ai-status-font)/var(--ai-status-panelBodyLine) var(--f-mono); }
.ai-setup-copy-row { display: flex; justify-content: flex-end; }
.ai-setup-copy-status { min-height: var(--ai-status-panelStatusHeight); color: var(--ink-2); }
`;

const ACTIONS = {
  preview_frame: ["previewing", "Previewing frame", "AI preview"],
  preview_native_model: ["previewing", "Previewing native model", "AI preview"],
  preview_native_parameters: ["previewing", "Previewing native parameters", "AI preview"],
  preview_lathe: ["previewing", "Previewing turned part", "AI preview"],
  get_tutorial_status: ["reading", "Inspecting tutorial checks", "AI reading"],
  start_tutorial: ["reading", "Starting tutorial checks", "AI reading"],
  get_document: ["reading", "Reading model", "AI read"],
  inspect_geometry: ["reading", "Inspecting geometry", "AI read"],
  select_geometry: ["reading", "Selecting geometry", "AI read"],
  preview_model: ["previewing", "Previewing model", "AI preview"],
  preview_parameters: ["previewing", "Previewing changes", "AI preview"],
  preview_resize_body: ["previewing", "Previewing resize", "AI preview"],
  preview_new_document: ["previewing", "Preparing document", "AI preview"],
  apply_model: ["editing", "Updating model", "AI edit"],
  undo: ["editing", "Undoing model edit", "AI undo"],
  reopen_document: ["editing", "Reopening model", "AI open"],
  save_document: ["saving", "Saving model", "AI save"],
  export_model: ["exporting", "Exporting model", "AI export"],
};

export function agentStatus({ online = false, checking = false, connected = false, recent = false, action, outcome, error } = {}) {
  if (action) {
    const [state, label, compact] = ACTIONS[action] || ["working", "Agent working", "AI busy"];
    return { state, label, compact, detail: `AI agent: ${label.toLowerCase()}.` };
  }
  if (checking) return { state: "checking", label: "Checking AI bridge", compact: "AI linking", detail: "Checking the local MCP bridge. This does not confirm an AI client is connected." };
  if (!online) return { state: "offline", label: "AI bridge offline", compact: "AI offline", detail: "The local MCP bridge is unavailable. Start JumpStart with make up, then connect your AI client." };
  if (error) return { state: "error", label: "Agent request failed", compact: "AI error", detail: `AI request failed: ${String(error).slice(0, 240)}` };
  if (outcome) {
    if (outcome === "no_change") return { state: "completed", label: "Agent left model unchanged", compact: "AI unchanged", detail: "The request finished without changing the document, including a duplicate retry." };
    const changed = ["apply_model", "undo", "reopen_document"].includes(outcome);
    return { state: "completed", label: changed ? "Agent updated model" : outcome === "save_document" ? "Agent saved model" : outcome === "export_model" ? "Agent exported model" : "Agent preview ready", compact: changed ? "AI updated" : outcome === "save_document" ? "AI saved" : outcome === "export_model" ? "AI exported" : "AI preview", detail: changed ? "The agent's model edit finished. Use Undo to recover the previous state." : "The agent's request finished." };
  }
  if (connected) return { state: "connected", label: "AI client connected", compact: "AI ready", detail: "An AI client is connected to the local MCP bridge. No document change is in progress." };
  if (recent) return { state: "recent", label: "Recent AI activity", compact: "AI recent", detail: "The bridge received a request recently, but this transport cannot report a live connection. Use the host proxy for live status." };
  return { state: "waiting", label: "Waiting for AI client", compact: "AI waiting", detail: "The local MCP bridge is ready. No AI client is connected or has sent a recent request. Follow the setup steps below." };
}

export function initAgentStatus() {
  const element = document.getElementById("ai-status");
  if (!element) return () => {};
  const placeTooltip = () => {
    const rect = element.getBoundingClientRect();
    element.style.setProperty("--ai-status-anchor-right", `${rect.right}px`);
    element.style.setProperty("--ai-status-anchor-bottom", `${rect.bottom}px`);
  };
  element.addEventListener("focus", placeTooltip);
  element.addEventListener("mouseenter", placeTooltip);
  window.addEventListener("resize", placeTooltip);
  const dismiss = () => { element.dataset.tooltipDismissed = "true"; };
  const reset = () => { delete element.dataset.tooltipDismissed; };
  element.addEventListener("keydown", (event) => { if (event.key === "Escape") dismiss(); });
  element.addEventListener("blur", reset);
  element.addEventListener("mouseleave", reset);
  return (input) => {
    const status = agentStatus(input);
    if (element.dataset.state === status.state && element.dataset.detail === status.detail) return;
    element.dataset.state = status.state; element.dataset.detail = status.detail;
    element.removeAttribute("title");
    element.querySelector(".ai-status-tooltip").textContent = status.detail;
    element.setAttribute("aria-label", `${status.label}. ${element.getAttribute("aria-expanded") === "true" ? "Close" : "Open"} AI workspace.`);
    element.querySelector(".ai-status-full").textContent = status.label;
    element.querySelector(".ai-status-short").textContent = status.compact;
    const setupState = document.getElementById("ai-setup-state");
    const setupDetail = document.getElementById("ai-setup-detail");
    if (setupState) setupState.textContent = status.label;
    if (setupDetail) setupDetail.textContent = status.detail;
  };
}

export function initAiSetupPanel() {
  const trigger = document.getElementById("ai-status");
  const panel = document.getElementById("ai-setup-panel");
  if (!trigger || !panel) return () => {};
  const closeButton = document.getElementById("ai-setup-close");
  const copyStatus = document.getElementById("ai-setup-copy-status");
  const setOpen = (open, { dismissTooltip = false } = {}) => {
    panel.hidden = !open;
    trigger.dataset.setupOpen = String(open);
    trigger.setAttribute("aria-expanded", String(open));
    trigger.setAttribute("aria-label", `${document.getElementById("ai-setup-state")?.textContent || "AI client"}. ${open ? "Close" : "Open"} AI workspace.`);
    if (open) closeButton?.focus();
    else {
      if (dismissTooltip) trigger.dataset.tooltipDismissed = "true";
      trigger.focus();
    }
  };
  const toggle = () => setOpen(panel.hidden);
  const close = () => { if (!panel.hidden) setOpen(false); };
  const onKeyDown = (event) => {
    if (event.key !== "Escape" || panel.hidden) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    setOpen(false, { dismissTooltip: true });
  };
  const copy = async (event) => {
    const button = event.target.closest("[data-copy-target]");
    if (!button) return;
    const target = document.getElementById(button.dataset.copyTarget);
    if (!target) return;
    try {
      await navigator.clipboard.writeText(target.textContent.trim());
      if (copyStatus) copyStatus.textContent = "Setup copied.";
    } catch {
      if (copyStatus) copyStatus.textContent = "Copy was unavailable. Select the setup text and copy it.";
    }
  };
  trigger.addEventListener("click", toggle);
  closeButton?.addEventListener("click", close);
  panel.addEventListener("click", copy);
  window.addEventListener("keydown", onKeyDown, true);
  return () => {
    trigger.removeEventListener("click", toggle);
    closeButton?.removeEventListener("click", close);
    panel.removeEventListener("click", copy);
    window.removeEventListener("keydown", onKeyDown, true);
  };
}
