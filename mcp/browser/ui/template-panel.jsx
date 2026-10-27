import { Fragment, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { GRIDFINITY_LIMITS } from "../../shared/gridfinity-limits.js";
import { PRINT_AREA_PRESETS, normalizePrintArea, baseplateTileLimits } from "../../shared/print-area.js";
import { createDrawerPlanner, numberValid } from "./drawer-planner.js";
import { createPartPlanner, partSummary, PART_TEMPLATES, PART_LIMITS, POCKET_LIMITS, MAX_POCKETS } from "./part-planner.js";
import { DrawerPlanner } from "./drawer-panel.jsx";
import { Labelled, NumberField, MagnetControls, WallControls, DimensionGuide, usePreviewView, revealInvalid } from "./controls.jsx";
import { iconLabel } from "./pictograms.js";

const MODES = [["drawer", "Drawer layout", "grid"], ["part", "Single part", "box"], ["settings", "Printer & settings", "printer3d"]];
const HEADINGS = {
  drawer: ["Organize your drawer", "Measure the inside, arrange your bins, then review your printable parts."],
  part: ["Make a single part", "Choose a part and adjust its size. Preview it before adding to your document."],
  settings: ["Set up your printer", "Check that each part fits your build area. These defaults are remembered in this browser."],
};
const ILLUSTRATIONS = { insert: "M5 9h30v24H5z M11 16h11v11H11z M29 18v7", bin: "M5 9h30v24H5z M5 15h30 M20 15v18", baseplate: "M5 7h30v28H5z M20 7v28 M5 21h30" };
const SHAPES = [["roundedRect", "Rounded"], ["circle", "Circle"], ["capsule", "Capsule"]];
const EVIDENCE = [["estimate", "Estimate"], ["measured", "Measured"], ["manufacturer", "Published"], ["model", "Model"]];
const PRINTER_FIELDS = [["width", "Print width (mm)", 1, 2000], ["depth", "Print depth (mm)", 1, 2000], ["height", "Print height (mm)", 1, 2000], ["edgeMargin", "Reserve per bed edge (mm)", 0, 20]];
const BIN_LIMITS = { columns: { min: 1, max: GRIDFINITY_LIMITS.columns, step: 1 }, rows: { min: 1, max: GRIDFINITY_LIMITS.rows, step: 1 } };

export function initTemplatePanel({ request, subscribe, createPreviewView }) {
  const root = document.getElementById("ai-templates-panel");
  const tabs = [...document.querySelectorAll('.ai-workspace-tabs [role="tab"]')];
  if (!root || !tabs.length) return;
  for (const [id, name] of [["ai-templates-tab", "add"], ["ai-connection-tab", "plug"]]) iconLabel(document.getElementById(id), name);
  // Commit each planner change before returning, so chained clicks see current controls.
  const drawer = createDrawerPlanner({ request, notify: flushSync });
  const part = createPartPlanner({ request, getPrintArea: drawer.getPrintArea, notify: flushSync });
  subscribe(kind => {
    if (!["preview", "version"].includes(kind)) drawer.deactivate();
    part.documentChanged(kind);
  });
  flushSync(() => createRoot(root).render(<Workspace root={root} part={part} drawer={drawer} createPreviewView={createPreviewView} />));

  async function activate(tab) {
    document.getElementById("ai-setup-panel").dataset.activeTab = tab.id === "ai-templates-tab" ? "templates" : "connection";
    for (const entry of tabs) {
      const active = entry === tab; entry.setAttribute("aria-selected", String(active)); entry.tabIndex = active ? 0 : -1;
      document.getElementById(entry.getAttribute("aria-controls")).hidden = !active;
    }
    if (tab.id === "ai-templates-tab") {
      try { const editorDocument = await request("get_document", {}); part.setDocument(editorDocument); await drawer.refreshDocument(editorDocument); }
      catch (error) { part.showError(error); }
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

function Workspace({ root, part, drawer, createPreviewView }) {
  const [mode, setMode] = useState("drawer"), [settingsSeq, setSettingsSeq] = useState(0);
  const partBusy = useSyncExternalStore(part.subscribe, () => part.getState().busy);
  const drawerBusy = useSyncExternalStore(drawer.subscribe, () => drawer.getState().busy);
  useEffect(() => { root.setAttribute("aria-busy", String(partBusy)); }, [partBusy]);
  const [title, note] = HEADINGS[mode];
  const choose = next => {
    flushSync(() => { setMode(next); if (next === "settings") setSettingsSeq(seq => seq + 1); });
    part.discard(); drawer.deactivate();
  };
  return <section className="ai-generator" aria-label="Gridfinity">
    <div className="ai-generator-header">
      <div className="ai-workflow-heading"><h3 id="ai-gridfinity-title">{title}</h3><p className="ai-template-note">{note}</p></div>
      <div className="ai-template-mode" role="group" aria-label="Gridfinity workflow">
        {MODES.map(([key, text, icon]) => <button key={key} type="button" className={`ai-with-pictogram${key === "settings" ? " ai-settings-link" : ""}`}
          aria-pressed={String(mode === key)} data-workspace-view={key} disabled={partBusy || drawerBusy} onClick={() => choose(key)}><Labelled icon={icon}>{text}</Labelled></button>)}
      </div>
    </div>
    <DrawerPlanner planner={drawer} hidden={mode !== "drawer"} createPreviewView={createPreviewView} />
    <SinglePart planner={part} hidden={mode !== "part"} createPreviewView={createPreviewView} />
    <PrinterSettings key={settingsSeq} drawer={drawer} hidden={mode !== "settings"} />
  </section>;
}

// Mirrors the native validity marking: submit marks the first invalid field, a valid edit clears it.
function useInvalidMarks() {
  const [ids, setIds] = useState(() => new Set());
  return {
    has: id => ids.has(id) || undefined,
    mark: id => setIds(current => new Set(current).add(id)),
    edit: (id, valid) => { if (valid && ids.has(id)) setIds(current => { const next = new Set(current); next.delete(id); return next; }); },
  };
}

function SinglePart({ planner, hidden, createPreviewView }) {
  const state = useSyncExternalStore(planner.subscribe, planner.getState);
  const { draft, busy, preview } = state, { kind } = draft;
  const [magnets, setMagnets] = useState({ valid: true, value: false });
  const marks = useInvalidMarks();
  const formRef = useRef(null), previewButtonRef = useRef(null), addPocketRef = useRef(null), successRef = useRef(null);
  const summary = partSummary({ ...draft, magnets: magnets.value }, magnets.valid);
  useLayoutEffect(() => { if (state.success) successRef.current.focus(); }, [state.success]);
  const references = state.document?.bodies.filter(body => body.role === "reference" && body.dimensions && !body.hidden) || [];
  const field = (name, label, disabled) => <NumberField id={`ai-template-${name}`} label={label} text={draft.fields[name]} limits={PART_LIMITS[name]} describedBy="ai-template-message"
    disabled={disabled} invalid={marks.has(`ai-template-${name}`)} onText={text => planner.setField(name, text)} onEdit={text => marks.edit(`ai-template-${name}`, numberValid(text, PART_LIMITS[name]))} />;
  const size = (name, label, axis) => {
    const id = `ai-template-${name}`, limits = PART_LIMITS[name], text = draft.fields[name];
    const set = next => { planner.setField(name, next); marks.edit(id, numberValid(next, limits)); };
    const step = change => { const input = document.getElementById(id); change < 0 ? input.stepDown() : input.stepUp(); set(input.value); };
    return <div className="ai-template-field">
      <label htmlFor={id}>{label}</label>
      <div className="ai-size-control">
        <button type="button" aria-label={`Decrease part ${axis}`} disabled={Number(text) <= limits.min} onClick={() => step(-1)}>−</button>
        <input id={id} name={name} type="number" min={limits.min} max={limits.max} step={limits.step} value={text} required aria-describedby="ai-template-message"
          aria-invalid={marks.has(id) && "true"} onChange={event => set(event.target.value)} />
        <button type="button" aria-label={`Increase part ${axis}`} disabled={Number(text) >= limits.max} onClick={() => step(1)}>+</button>
      </div>
    </div>;
  };
  const submit = event => {
    event.preventDefault();
    if (busy || !revealInvalid(formRef.current, marks.mark)) return;
    void planner.preview();
  };
  return <div className="ai-single-part" hidden={hidden}>
    <div className="ai-template-settings">
      <form ref={formRef} className="ai-template-form" noValidate onSubmit={submit}>
        <div className="ai-controls">
          <h3>Part type</h3>
          <div className="ai-template-list" aria-label="Gridfinity templates">
            {PART_TEMPLATES.map(([key, title, detail]) => <button key={key} type="button" className="ai-template-choice" aria-pressed={String(key === kind)} data-template={key}
              aria-label={`${title} ${detail}`} disabled={busy} onClick={() => planner.setKind(key)}>
              <svg viewBox="0 0 40 40" aria-hidden="true"><path d={ILLUSTRATIONS[key]} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /></svg>
              <span><strong>{title}</strong><small>{detail}</small></span>
            </button>)}
          </div>
          <p className="ai-template-note">{PART_TEMPLATES.find(([key]) => key === kind)[2]}</p>
          <fieldset className="ai-template-group" disabled={busy}>
            <h4>Footprint</h4>
            <div className="ai-template-fields">{size("columns", "Width (cells)", "width")}{size("rows", "Depth (cells)", "depth")}</div>
            <p className="ai-template-note" aria-live="polite">{summary.dimensions}</p>
            <div className="ai-template-group" hidden={kind === "baseplate"}>
              <h4>Body height</h4>
              <div className="ai-template-shapes" role="group" aria-label="Part body height">
                {[2, 3, 5, 7].map(units => <button key={units} type="button" data-height={units} aria-pressed={String(Number(draft.fields.heightUnits) === units)}
                  onClick={() => { planner.setField("heightUnits", String(units)); marks.edit("ai-template-heightUnits", true); }}>{`${units * 7} mm`}</button>)}
              </div>
              <p className="ai-template-note">{summary.heightNote}</p>
              <details><summary>More heights</summary>{field("heightUnits", "Height (7 mm steps)", kind === "baseplate")}</details>
            </div>
            <details className="ai-template-group" hidden={kind !== "bin"}>
              <summary className="ai-with-pictogram"><Labelled icon="grid">Compartments &amp; stacking</Labelled></summary>
              <label className="ai-template-field" htmlFor="ai-template-lip">
                <input id="ai-template-lip" type="checkbox" checked={draft.lip} disabled={kind !== "bin"} onChange={event => planner.setLip(event.target.checked)} />
                <span>Stackable rim</span>
              </label>
              <div className="ai-template-fields">{field("dividersX", "Width dividers", kind !== "bin")}{field("dividersY", "Depth dividers", kind !== "bin")}</div>
              <WallControls id="ai-wall-close-gaps" heading="Open sides" value={draft.openSides} closeGaps={draft.closeGaps} disabled={kind !== "bin"}
                onChange={planner.setWalls} onCloseGaps={planner.setCloseGaps} />
            </details>
            <section className="ai-template-group" hidden={kind !== "insert"}>
              <h3>Pockets</h3>
              <p className="ai-template-note">Clearance is per side. Suggested values need a fit test on your printer.</p>
              <div className="ai-template-pockets">
                {draft.pockets.map(pocket => <PocketForm key={pocket.index} pocket={pocket} planner={planner} disabled={kind !== "insert"} references={references} marks={marks}
                  onRemove={() => { planner.removePocket(pocket.index); addPocketRef.current.focus(); }} />)}
              </div>
              <button ref={addPocketRef} type="button" disabled={draft.pockets.length >= MAX_POCKETS} onClick={planner.addPocket}>Add pocket</button>
            </section>
            <details className="ai-template-group">
              <summary className="ai-with-pictogram"><Labelled icon="magnet">Construction &amp; magnets</Labelled></summary>
              <div className="ai-template-fields" hidden={kind === "baseplate"}>{field("floor", "Bottom thickness (mm)", kind === "baseplate")}{field("wall", "Wall thickness (mm)", kind === "baseplate")}</div>
              <MagnetControls id="ai-template-magnets" value={draft.magnets} onChange={planner.setMagnets} onInput={planner.edited} onValid={(valid, value) => setMagnets({ valid, value })} />
            </details>
          </fieldset>
          <p className="ai-template-message" role="status" aria-live="polite" id="ai-template-message" data-error={state.message.error ? "true" : undefined}>{state.message.text}</p>
        </div>
        <div className="ai-template-submit">
          <button ref={previewButtonRef} type="submit" className={`${!state.cached && !state.success ? "ai-template-primary " : ""}ai-with-pictogram`} disabled={busy}>
            <Labelled icon="eye">{busy ? state.busyLabel : "Preview"}</Labelled>
          </button>
        </div>
      </form>
    </div>
    <div className="ai-template-review">
      <DimensionGuide title="Your part, at a glance" note="This sizing sketch updates as you edit. Select Preview to build and check the actual 3D model." {...summary.guide} hidden={!!preview || !!state.success} />
      <section id="ai-template-preview" className="ai-template-preview" tabIndex={-1} hidden={!preview} aria-label="Template preview">
        {preview && <PartPreview key={preview.seq} preview={preview} stale={!state.cached} createPreviewView={createPreviewView} />}
        {preview && <div className="ai-preview-footer">
          {preview.rotated && <p className="ai-template-note">Turn this part 90° on the print bed to fit the selected printer area.</p>}
          <p className="ai-template-note">Connected geometry checked. Printed fit remains unverified.</p>
          <div className="ai-template-actions">
            <button type="button" className="ai-template-primary" disabled={busy || !state.cached} onClick={planner.apply}>Add to document</button>
            <button type="button" disabled={busy} onClick={() => { planner.cancelPreview(); previewButtonRef.current.focus(); }}>Cancel preview</button>
          </div>
        </div>}
      </section>
      <section className="ai-template-success" hidden={!state.success} tabIndex={-1} aria-label="Part added">
        <h3 ref={successRef} tabIndex={-1}>Your part is in the document</h3>
        <p className="ai-template-note">Continue in the editor to save your project or export the part for your slicer.</p>
        <button type="button" className="ai-template-primary" onClick={() => document.getElementById("ai-setup-close").click()}>Continue in editor</button>
      </section>
    </div>
  </div>;
}

function PartPreview({ preview, stale, createPreviewView }) {
  const contentRef = useRef(null), dimensionsRef = useRef(null), titleRef = useRef(null);
  const fallback = usePreviewView(contentRef, preview.previewId, createPreviewView, dimensionsRef);
  useLayoutEffect(() => titleRef.current.focus(), []);
  const dims = preview.dimensions;
  return <div ref={contentRef} className="ai-preview-content">
    <h3 ref={titleRef} tabIndex={-1}>Review preview</h3>
    <p className="ai-template-stale" hidden={!stale} role="status">Out of date. Select Preview to update this model.</p>
    {fallback && preview.images.map(image => <img key={image.dataUrl} src={image.dataUrl} alt="Isometric view of the proposed Gridfinity model" />)}
    {dims && <dl ref={dimensionsRef} className="ai-preview-dimensions" aria-label="Model dimensions">
      {[["x", "Width"], ["y", "Depth"], ["z", "Height"]].map(([axis, label]) => <div key={axis}><dt>{`${label} (${axis.toUpperCase()})`}</dt><dd>{`${dims[axis].toFixed(2)} mm`}</dd></div>)}
    </dl>}
  </div>;
}

function PocketForm({ pocket, planner, disabled, references, marks, onRemove }) {
  const { index, shape } = pocket, id = name => `ai-template-${index}-${name}`;
  const widthRef = useRef(null);
  const field = (name, label, off = false) => <NumberField id={id(name)} label={label} text={pocket.fields[name]} limits={POCKET_LIMITS[name]} describedBy="ai-template-message"
    disabled={disabled || off} hidden={off} inputRef={name === "width" ? widthRef : undefined} invalid={marks.has(id(name))}
    onText={text => planner.setPocketField(index, name, text)} onEdit={text => marks.edit(id(name), numberValid(text, POCKET_LIMITS[name]))} />;
  const choices = (label, entries, current, key) => <div className="ai-template-shapes" aria-label={label}>
    {entries.map(([value, text]) => <button key={value} type="button" aria-pressed={String(value === current)} onClick={() => planner.setPocket(index, { [key]: value })}>{text}</button>)}
  </div>;
  return <section className="ai-template-pocket" aria-labelledby={`ai-pocket-title-${index}`}>
    <header>
      <h4 id={`ai-pocket-title-${index}`}>{`Pocket ${index}`}</h4>
      <button type="button" className="ai-template-remove" aria-label={`Remove pocket ${index}`} onClick={onRemove}>Remove</button>
    </header>
    {choices(`Pocket ${index} shape`, SHAPES, shape, "shape")}
    <div className="ai-template-fields">{field("width", "Width / diameter (mm)")}{field("height", "Length (mm)", shape === "circle")}{field("depth", "Pocket depth (mm)")}</div>
    <details>
      <summary>Position &amp; fit</summary>
      <div className="ai-template-fields">
        {field("radius", "Corner radius (mm)", shape !== "roundedRect")}{field("clearance", "Clearance per side (mm)")}
        {field("x", "Centre X (mm)")}{field("y", "Centre Y (mm)")}{field("rotation", "Rotation about Z (degrees)")}
        <label className="ai-template-field" htmlFor={id("merge")}>
          <input id={id("merge")} type="checkbox" checked={pocket.merge} disabled={disabled} onChange={event => planner.setPocket(index, { merge: event.target.checked })} />
          <span>Allow overlap with earlier pockets</span>
        </label>
      </div>
    </details>
    <details>
      <summary>Reference and dimensions</summary>
      <div className="ai-template-reference">
        <p className="ai-template-note">{references.length ? "Use a reference body's bounding dimensions as an envelope." : "No visible reference bodies. Enter measured dimensions above."}</p>
        {references.map(body => <button key={body.id} type="button" aria-pressed={String(pocket.referenceBodyId === body.id)}
          onClick={() => { planner.applyReference(index, body); widthRef.current.focus(); }}>{body.name}</button>)}
      </div>
      <div className="ai-template-group">
        <span>Dimension evidence</span>
        {choices("Dimension evidence", EVIDENCE, pocket.evidenceKind, "evidenceKind")}
        <span>Original source units. Pocket dimensions are always entered in millimetres.</span>
        {choices("Original dimension units", ["mm", "cm", "in"].map(units => [units, units]), pocket.sourceUnits, "sourceUnits")}
        <label className="ai-template-field" htmlFor={id("product")}>
          <span>Item / model variant</span>
          <input id={id("product")} type="text" maxLength={160} value={pocket.product} disabled={disabled} onChange={event => planner.setPocket(index, { product: event.target.value })} />
        </label>
        <label className="ai-template-field" htmlFor={id("url")}>
          <span>Dimension source URL (optional)</span>
          <input id={id("url")} type="url" maxLength={2000} value={pocket.url} disabled={disabled} aria-invalid={marks.has(id("url")) && "true"}
            onChange={event => { planner.setPocket(index, { url: event.target.value }); marks.edit(id("url"), event.target.validity.valid); }} />
        </label>
      </div>
    </details>
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
