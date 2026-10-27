import { Fragment, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { GRIDFINITY_LIMITS } from "../../shared/gridfinity-limits.js";
import { PRINT_AREA_PRESETS, normalizePrintArea, baseplateTileLimits } from "../../shared/print-area.js";
import { createDrawerPlanner } from "./drawer-planner.js";
import { numberValid } from "./field-text.js";
import { useInvalidMarks } from "./part-form.jsx";
import { DrawerPlanner } from "./drawer-panel.jsx";
import { Labelled, NumberField, DimensionGuide, revealInvalid } from "./controls.jsx";
import { iconLabel } from "./pictograms.js";

const MODES = [["drawer", "Drawer layout", "grid"], ["settings", "Printer & settings", "printer3d"]];
const HEADINGS = {
  drawer: ["Organize your drawer", "Measure the inside, arrange your bins, then review your printable parts."],
  settings: ["Set up your printer", "Check that each part fits your build area. These defaults are remembered in this browser."],
};
const PRINTER_FIELDS = [["width", "Print width (mm)", 1, 2000], ["depth", "Print depth (mm)", 1, 2000], ["height", "Print height (mm)", 1, 2000], ["edgeMargin", "Reserve per bed edge (mm)", 0, 20]];
const BIN_LIMITS = { columns: { min: 1, max: GRIDFINITY_LIMITS.columns, step: 1 }, rows: { min: 1, max: GRIDFINITY_LIMITS.rows, step: 1 } };

export function initTemplatePanel({ request, subscribe, createPreviewView }) {
  const root = document.getElementById("ai-templates-panel");
  const tabs = [...document.querySelectorAll('.ai-workspace-tabs [role="tab"]')];
  if (!root || !tabs.length) return;
  for (const [id, name] of [["ai-templates-tab", "add"], ["ai-connection-tab", "plug"]]) iconLabel(document.getElementById(id), name);
  // Commit each planner change before returning, so chained clicks see current controls.
  const drawer = createDrawerPlanner({ request, notify: flushSync });
  subscribe(kind => { if (!["preview", "version"].includes(kind)) drawer.deactivate(); });
  flushSync(() => createRoot(root).render(<Workspace root={root} drawer={drawer} createPreviewView={createPreviewView} />));

  async function activate(tab) {
    document.getElementById("ai-setup-panel").dataset.activeTab = tab.id === "ai-templates-tab" ? "templates" : "connection";
    for (const entry of tabs) {
      const active = entry === tab; entry.setAttribute("aria-selected", String(active)); entry.tabIndex = active ? 0 : -1;
      document.getElementById(entry.getAttribute("aria-controls")).hidden = !active;
    }
    if (tab.id === "ai-templates-tab") {
      try { await drawer.refreshDocument(await request("get_document", {})); }
      catch (error) { drawer.announce(error.message, true); }
    }
  }
  tabs.forEach((tab, index) => {
    tab.onclick = () => { void activate(tab); };
    tab.onkeydown = event => {
      const offset = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
      const target = event.key === "Home" ? tabs[0] : event.key === "End" ? tabs.at(-1) : offset ? tabs[(index + offset + tabs.length) % tabs.length] : null;
      if (target) { event.preventDefault(); target.focus(); void activate(target); }
    };
  });
  document.getElementById("ai-setup-panel").addEventListener("workspaceopen", () => {
    const selected = tabs.find(tab => tab.getAttribute("aria-selected") === "true");
    if (selected) void activate(selected);
  });
}

function Workspace({ root, drawer, createPreviewView }) {
  const [mode, setMode] = useState("drawer"), [settingsSeq, setSettingsSeq] = useState(0);
  const drawerBusy = useSyncExternalStore(drawer.subscribe, () => drawer.getState().busy);
  const references = useSyncExternalStore(drawer.subscribe, () => drawer.getState().references);
  useEffect(() => { root.setAttribute("aria-busy", String(drawerBusy)); }, [drawerBusy]);
  const [title, note] = HEADINGS[mode];
  const choose = next => {
    flushSync(() => { setMode(next); if (next === "settings") setSettingsSeq(seq => seq + 1); });
    drawer.deactivate();
  };
  return <section className="ai-generator" aria-label="Gridfinity">
    <div className="ai-generator-header">
      <div className="ai-workflow-heading"><h3 id="ai-gridfinity-title">{title}</h3><p className="ai-template-note">{note}</p></div>
      <div className="ai-template-mode" role="group" aria-label="Gridfinity workflow">
        {MODES.map(([key, text, icon]) => <button key={key} type="button" className={`ai-with-pictogram${key === "settings" ? " ai-settings-link" : ""}`}
          aria-pressed={String(mode === key)} data-workspace-view={key} disabled={drawerBusy} onClick={() => choose(key)}><Labelled icon={icon}>{text}</Labelled></button>)}
      </div>
    </div>
    <DrawerPlanner planner={drawer} hidden={mode !== "drawer"} createPreviewView={createPreviewView} references={references} />
    <PrinterSettings key={settingsSeq} drawer={drawer} hidden={mode !== "settings"} />
  </section>;
}

const printerTexts = area => Object.fromEntries(PRINTER_FIELDS.map(([key]) => [key, String(area[key])]));

function PrinterSettings({ drawer, hidden }) {
  const [limits, setLimits] = useState(() => { const saved = drawer.getBinLimits(); return { columns: String(saved.columns), rows: String(saved.rows) }; });
  const [enabled, setEnabled] = useState(() => !!drawer.getPrintArea());
  const [printer, setPrinter] = useState(() => printerTexts(drawer.getPrintArea() || PRINT_AREA_PRESETS[0]));
  const [status, setStatus] = useState({ text: "", error: false });
  const marks = useInvalidMarks(), formRef = useRef(null);
  const sameSize = preset => ["width", "depth", "height"].every(key => Number(printer[key]) === preset[key]);
  const readPrinterArea = () => {
    if (!enabled) return false;
    const preset = PRINT_AREA_PRESETS.find(sameSize);
    return normalizePrintArea({ ...Object.fromEntries(PRINTER_FIELDS.map(([key]) => [key, Number(printer[key])])), ...(preset ? { name: preset.name } : {}) });
  };
  let note, guide = {};
  try {
    const area = readPrinterArea(), tile = baseplateTileLimits(area);
    guide = { width: area?.width, depth: area?.depth, height: area?.height };
    note = area ? `Usable area ${area.width - 2 * area.edgeMargin} × ${area.depth - 2 * area.edgeMargin} × ${area.height} mm. Baseplate tiles up to ${tile.columns} × ${tile.rows} cells (${tile.columns * 42} × ${tile.rows * 42} mm); may rotate 90° for fewer tiles.` : "No printer area configured. Baseplates use the existing 4 × 4 tiling.";
  } catch (error) { note = error.message; }
  const limitsValid = numberValid(limits.columns, BIN_LIMITS.columns) && numberValid(limits.rows, BIN_LIMITS.rows);
  const submit = event => {
    event.preventDefault();
    if (!revealInvalid(formRef.current, marks.mark)) return;
    try { setStatus({ text: drawer.setBinLimits({ columns: Number(limits.columns), rows: Number(limits.rows) }, readPrinterArea()), error: false }); }
    catch (error) { setStatus({ text: error.message, error: true }); }
  };
  const input = (id, label, text, fieldLimits, describedBy, onText, disabled) => <NumberField id={id} label={label} text={text} limits={fieldLimits} describedBy={describedBy}
    disabled={disabled} invalid={marks.has(id)} onText={onText} onEdit={next => marks.edit(id, numberValid(next, fieldLimits))} />;
  return <form ref={formRef} className="ai-template-form ai-generator-settings" noValidate hidden={hidden} aria-label="Gridfinity settings" onSubmit={submit}>
    <div className="ai-template-settings">
      <div className="ai-controls">
        <h3>Printer area</h3>
        <p id="ai-print-area-help" className="ai-template-note">Choose a nozzle area below, or enter your printer’s dimensions. Leave room at the edges for a brim or skirt.</p>
        <label className="ai-template-field" htmlFor="ai-print-area-enabled">
          <input id="ai-print-area-enabled" type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} />
          <span>Use printer area</span>
        </label>
        <div className="ai-template-shapes" role="group" aria-label="Nozzle printing area presets">
          {PRINT_AREA_PRESETS.map((preset, index) => <button key={index} type="button" aria-pressed={String(enabled && sameSize(preset))}
            onClick={() => { setEnabled(true); setPrinter(printerTexts(preset)); }}>{`${preset.name} · ${preset.width} × ${preset.depth} × ${preset.height} mm`}</button>)}
        </div>
        <div className="ai-template-fields" hidden={!enabled}>
          {PRINTER_FIELDS.map(([key, label, min, max]) => <Fragment key={key}>{input(`ai-template-print-${key}`, label, printer[key], { min, max, step: 0.1 },
            "ai-print-area-help", text => setPrinter(current => ({ ...current, [key]: text })), !enabled)}</Fragment>)}
        </div>
        <p className="ai-template-note" role="status">{note}</p>
        <details className="ai-template-group" open>
          <summary>Bin size limits</summary>
          <p id="ai-bin-limits-note" className="ai-template-note">Largest bin offered when drawing or filling gaps. One cell is 42 mm; printer fit is checked separately.</p>
          <div className="ai-template-fields">
            {input("ai-template-max-bin-width", "Maximum bin width (cells)", limits.columns, BIN_LIMITS.columns, "ai-bin-limits-note", text => setLimits(current => ({ ...current, columns: text })))}
            {input("ai-template-max-bin-depth", "Maximum bin depth (cells)", limits.rows, BIN_LIMITS.rows, "ai-bin-limits-note", text => setLimits(current => ({ ...current, rows: text })))}
          </div>
          <p className="ai-template-note">{limitsValid ? `${(Number(limits.columns) * 42 - 0.5).toFixed(1)} × ${(Number(limits.rows) * 42 - 0.5).toFixed(1)} mm bin-size limit. Printer area is checked separately.` : ""}</p>
        </details>
        <p className="ai-template-message" role="status" data-error={status.error ? "true" : undefined}>{status.text}</p>
      </div>
      <div className="ai-template-submit"><button type="submit" className="ai-template-primary">Save settings</button></div>
    </div>
    <DimensionGuide title="Your printer’s build area" note="Each generated part is checked separately. Arrange the exported parts on print plates in your slicer." {...guide} />
  </form>;
}
