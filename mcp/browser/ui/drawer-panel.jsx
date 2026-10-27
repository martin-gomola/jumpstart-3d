import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import { BIN_SIDES, binFootprint, binTotalHeight } from "../../shared/gridfinity-walls.js";
import { drawerMetrics, placementError, drawerBinBaseZ, binFloor, binWall } from "../../shared/drawer-layout.js";
import { normalizeBinLimits } from "../../shared/gridfinity-limits.js";
import { normalizeCornerSpacers } from "../../shared/drawer-spacers.js";
import { normalizePrintArea, checkPrintFit } from "../../shared/print-area.js";
import { drawerStatus } from "./drawer-planner.js";
import { numberValid } from "./field-text.js";
import { Labelled, NumberField, TextField, MagnetControls, WallControls, DimensionGuide, usePreviewView } from "./controls.jsx";
import { PocketForm, CompartmentFields, ThicknessFields, THICKNESS_LIMITS } from "./part-options.jsx";
import { COMPARTMENT_LIMITS, MAX_POCKETS, newPocketDraft, nextPocketIndex, pocketDraftValid, pocketFromDraft, draftFromPocket, referencePatch } from "./pocket-draft.js";

const DRAWER_LIMITS = { width: { min: 42, max: 881.99 }, depth: { min: 42, max: 881.99 }, height: { min: 14, max: 10000 }, floor: { min: 0.8, max: 6 }, wall: { min: 0.8, max: 4 } };
const SPACER_LIMITS = { clearance: { min: 0, max: 1, step: 0.1 }, spacerHeight: { min: 1, max: 12, step: 0.5 }, leg: { min: 5, max: 60, step: 1 } };
const fieldTexts = draft => {
  const spacers = normalizeCornerSpacers(draft.cornerSpacers || true);
  return { width: draft.width ? String(draft.width) : "", depth: draft.depth ? String(draft.depth) : "", height: draft.height ? String(draft.height) : "",
    floor: String(draft.floor), wall: String(draft.wall), clearance: String(spacers.clearance), spacerHeight: String(spacers.height), leg: String(spacers.legLength) };
};

export function DrawerPlanner({ planner, hidden, createPreviewView, references = [] }) {
  const state = useSyncExternalStore(planner.subscribe, planner.getState);
  const { draft, busy, selectedId, view, preview } = state;
  const status = drawerStatus(draft), { ready, error } = status, metrics = status.metrics;
  const bin = draft.bins.find(entry => entry.id === selectedId);
  const [texts, setTexts] = useState(() => fieldTexts(draft)), [touched, setTouched] = useState({});
  const [baseMagnetsValid, setBaseMagnetsValid] = useState(true);
  const [gesture, setGesture] = useState(null), [ghost, setGhost] = useState(null);
  const rootRef = useRef(null), settingsRef = useRef(null), boardRef = useRef(null), widthRef = useRef(null), undoRef = useRef(null), redoRef = useRef(null);
  const previewButtonRef = useRef(null), addBinRef = useRef(null), reviewTitleRef = useRef(null);

  useLayoutEffect(() => { setTexts(fieldTexts(planner.getState().draft)); setTouched({}); }, [state.fieldsVersion]);
  useLayoutEffect(() => { if (state.scrollSeq) settingsRef.current.scrollTop = 0; }, [state.scrollSeq]);
  useEffect(() => { if (preview) reviewTitleRef.current?.focus(); }, [preview?.seq]);

  // Reordering the measurements or rebuilding a bin inspector can blur its control.
  function history(kind) {
    const active = document.activeElement;
    if (!flushSync(() => planner[kind]())) return;
    const target = rootRef.current.contains(active) && active.getClientRects().length && !active.disabled ? active : undoRef.current.disabled ? redoRef.current : undoRef.current;
    if (!target.disabled) target.focus({ preventScroll: true });
  }
  const keydown = event => {
    if (event.key === "Escape") return;
    const typing = event.target.tagName === "TEXTAREA" || event.target.tagName === "INPUT" && !["checkbox", "radio"].includes(event.target.type);
    if ((event.ctrlKey || event.metaKey) && !typing && ["z", "y"].includes(event.key.toLowerCase())) {
      event.preventDefault();
      history(event.key.toLowerCase() === "y" || event.shiftKey ? "redo" : "undo");
    }
    // Draft navigation must not nudge or undo selected native CAD bodies behind the panel.
    event.stopPropagation();
  };

  const setText = name => text => setTexts(current => ({ ...current, [name]: text }));
  const focusBin = id => [...boardRef.current.querySelectorAll("[data-bin-id]")].find(button => button.dataset.binId === id)?.focus();
  const dimension = (key, label, inputRef) => <NumberField id={`drawer-${key}`} label={label} text={texts[key]} onText={setText(key)} limits={DRAWER_LIMITS[key]} inputRef={inputRef}
    disabled={busy} invalid={touched[key] ? !numberValid(texts[key], DRAWER_LIMITS[key]) : undefined}
    onCommit={text => { setTouched(current => ({ ...current, [key]: true })); if (planner.setDimension(key, Number(text)) === false) setText(key)(String(planner.getState().draft[key])); }} />;

  const spacerValues = values => ({ clearance: Number(values.clearance), height: Number(values.spacerHeight), legLength: Number(values.leg) });
  const spacersValid = Object.entries(SPACER_LIMITS).every(([key, limits]) => numberValid(texts[key], limits));
  const spacerField = (key, id, label) => <NumberField id={`drawer-${id}`} label={label} text={texts[key]} onText={setText(key)} limits={SPACER_LIMITS[key]}
    disabled={busy || !draft.cornerSpacers} onEdit={planner.markEditing}
    onCommit={text => { const next = { ...texts, [key]: text }; if (Object.entries(SPACER_LIMITS).every(([name, limits]) => numberValid(next[name], limits))) planner.setSpacers(spacerValues(next)); }} />;

  const measureSummary = ready ? `${draft.name} · ${draft.width} × ${draft.depth} × ${draft.height} mm` : "Drawer measurements";
  const swapDisabled = busy || !!gesture || ![draft.width, draft.depth].every(value => Number.isFinite(value) && value >= 42 && value <= 881.99);
  const measureDetails = <details key="measure" className="drawer-measurements" open={state.measureOpen} onToggle={event => { if (event.currentTarget.open !== planner.getState().measureOpen) planner.setMeasureOpen(event.currentTarget.open); }}>
    <summary className="ai-with-pictogram"><Labelled icon="dim">{measureSummary}</Labelled></summary>
    <div className="drawer-measure-fields">
      <div className="ai-template-fields">
        {dimension("width", "Inside width (mm)", widthRef)}{dimension("depth", "Inside depth (mm)")}{dimension("height", "Usable height (mm)")}
        <button id="drawer-swap-dimensions" type="button" className="drawer-swap-dimensions ai-with-pictogram" disabled={swapDisabled}
          title="Swap width and depth, rotating the drawer and its bins 90° clockwise. Usable height stays the same." onClick={() => { if (!gesture) planner.swap(); }}>
          <Labelled icon="rotate">Swap width &amp; depth</Labelled>
        </button>
      </div>
      <TextField id="drawer-name" label="Drawer name" value={draft.name} disabled={busy} onCommit={planner.setName} />
    </div>
  </details>;
  const saved = <section key="saved" className="drawer-saved" hidden={!state.savedLayouts.length}>
    {state.savedLayouts.length > 0 && <span>Saved drawer layouts</span>}
    {state.savedLayouts.map(entry => <button key={entry.definition.layoutId} type="button" disabled={busy} onClick={() => planner.loadLayout(entry)}>{entry.definition.name}</button>)}
  </section>;
  const fit = <p key="fit" id="drawer-fit" className="ai-template-note" aria-live="polite">{status.fit}</p>;
  const spacerGroup = <div key="spacers" className="ai-template-group" hidden={!ready}>
    <label className="ai-template-field" htmlFor="drawer-corner-spacers">
      <input id="drawer-corner-spacers" type="checkbox" checked={!!draft.cornerSpacers} disabled={busy || !draft.includeBaseplate || !ready}
        onChange={event => planner.setSpacers(event.target.checked ? spacerValues(texts) : false)} />
      <span>Corner spacers</span>
    </label>
    <div className="ai-template-fields" hidden={!draft.cornerSpacers}>
      {spacerField("clearance", "spacer-clearance", "Outer-edge clearance (mm)")}{spacerField("spacerHeight", "spacer-height", "Spacer height (mm)")}{spacerField("leg", "spacer-leg", "Contact leg length (mm)")}
    </div>
    <p className="ai-template-note" role="status">{status.spacerNote}</p>
  </div>;
  const inspector = <Inspector key="inspector" planner={planner} draft={draft} bin={bin} busy={busy} ready={ready} references={references} onRemoved={() => addBinRef.current.focus()} />;
  const construction = <details key="construction" className="drawer-advanced" hidden={!ready}>
    <summary className="ai-with-pictogram"><Labelled icon="sketch">Advanced construction</Labelled></summary>
    <ThicknessFields id="drawer" texts={texts} disabled={busy} invalid={name => touched[name] ? !numberValid(texts[name], DRAWER_LIMITS[name]) : undefined}
      onText={(name, text) => setText(name)(text)} onCommit={(name, text) => { setTouched(current => ({ ...current, [name]: true })); planner.setDimension(name, Number(text)); }} />
    <p className="ai-template-note">Defaults for every bin. A bin can set its own under More bin options.</p>
    <label className="ai-template-field" htmlFor="drawer-baseplate">
      <input id="drawer-baseplate" type="checkbox" checked={draft.includeBaseplate} disabled={busy} onChange={event => planner.setBaseplate(event.target.checked)} />
      <span>Include matching baseplates</span>
    </label>
    <label className="ai-template-field" htmlFor="drawer-baseplate-clips">
      <input id="drawer-baseplate-clips" type="checkbox" checked={!!draft.baseplateClips} disabled={busy || !draft.includeBaseplate} onChange={event => planner.setClips(event.target.checked)} />
      <span>Join baseplate tiles with clips</span>
    </label>
    <p className="ai-template-note" role="status" hidden={!draft.baseplateClips}>{status.clipNote}</p>
    <MagnetControls id="drawer-baseplate-magnets" label="Baseplate magnet pockets" value={draft.baseplateMagnets || false} disabled={busy || !draft.includeBaseplate}
      onInput={planner.markEditing} onChange={planner.setBaseMagnets} onValid={valid => setBaseMagnetsValid(valid)} />
    <p className="ai-template-note" hidden={!draft.baseplateMagnets}>{status.carrierNote}</p>
  </details>;
  const message = <p key="message" id="drawer-message" className="ai-template-message" role="status" aria-live="polite" data-error={state.message.error ? "true" : undefined}>{state.message.text}</p>;
  const sections = bin ? [measureDetails, inspector, saved, fit, spacerGroup, construction, message] : [saved, measureDetails, fit, spacerGroup, inspector, construction, message];

  const previewDisabled = busy || !!error || !baseMagnetsValid || !!draft.cornerSpacers && !spacersValid || state.editing;
  const step = view === "preview" ? 2 : ready ? 1 : 0;

  const cell = event => {
    const rect = boardRef.current.getBoundingClientRect();
    return { x: Math.floor((event.clientX - rect.left) / rect.width * metrics.columns), y: metrics.rows - 1 - Math.floor((event.clientY - rect.top) / rect.height * metrics.rows) };
  };
  const candidate = (active, point) => {
    const { start, bin: moving } = active;
    if (active.type === "draw") return { x: Math.min(start.x, point.x), y: Math.min(start.y, point.y), columns: Math.abs(start.x - point.x) + 1, rows: Math.abs(start.y - point.y) + 1 };
    if (active.type === "move") return { ...moving, x: moving.x + point.x - start.x, y: moving.y + point.y - start.y };
    return { ...moving, columns: Math.max(1, point.x - moving.x + 1), rows: Math.max(1, moving.y + moving.rows - point.y), y: Math.min(point.y, moving.y + moving.rows - 1) };
  };
  const board = {
    onPointerDown(event) {
      if (busy || event.button !== 0 || !ready) return;
      const target = event.target.closest("[data-bin-id]"), hit = target && draft.bins.find(entry => entry.id === target.dataset.binId);
      if (hit) planner.select(hit.id);
      setGesture({ pointerId: event.pointerId, start: cell(event), bin: hit && structuredClone(hit), type: !hit ? "draw" : event.target.closest("[data-resize]") ? "resize" : "move" });
      boardRef.current.setPointerCapture(event.pointerId); event.preventDefault();
    },
    onPointerMove(event) {
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      const next = candidate(gesture, cell(event)), failure = placementError(draft, next, gesture.bin?.id);
      setGhost({ rect: next, invalid: !!failure, text: failure ? "Doesn’t fit" : `${next.columns} × ${next.rows}` });
    },
    onPointerUp(event) {
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      const active = gesture, next = candidate(active, cell(event));
      setGesture(null); setGhost(null);
      if (boardRef.current.hasPointerCapture(event.pointerId)) boardRef.current.releasePointerCapture(event.pointerId);
      const unchanged = active.type === "move" && next.x === active.bin.x && next.y === active.bin.y;
      flushSync(() => unchanged ? planner.gestureEnd(null) : planner.gestureEnd(active.type, next));
      focusBin(planner.getState().selectedId);
    },
    onPointerCancel() { setGesture(null); setGhost(null); },
  };
  const position = rect => ({ left: `${rect.x / metrics.columns * 100}%`, bottom: `${rect.y / metrics.rows * 100}%`, width: `${rect.columns / metrics.columns * 100}%`, height: `${rect.rows / metrics.rows * 100}%` });
  const binKeyDown = (entry, event) => {
    if (busy) return;
    const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowDown: [0, -1], ArrowUp: [0, 1] }[event.key];
    if (direction) {
      event.preventDefault();
      const change = event.shiftKey ? { columns: entry.columns + direction[0], rows: entry.rows + direction[1] } : { x: entry.x + direction[0], y: entry.y + direction[1] };
      flushSync(() => { planner.select(entry.id); planner.updateBin(change); });
      focusBin(entry.id);
    } else if (event.key === "Enter" || event.key === " ") { event.preventDefault(); planner.select(entry.id, true); }
  };

  return <div ref={rootRef} className="ai-drawer-mode" hidden={hidden} aria-busy={String(busy)} onKeyDown={keydown}>
    <div className="ai-template-settings">
      <div ref={settingsRef} className="ai-controls drawer-settings">
        <div className="drawer-view-toolbar">
          <h3 className="ai-with-pictogram"><Labelled icon="grid">Your drawer</Labelled></h3>
          <button type="button" className="ai-with-pictogram" disabled={busy} title="Clear the draft and enter new drawer measurements. Undo layout restores the previous draft."
            onClick={() => { setGesture(null); setGhost(null); if (flushSync(() => planner.newDrawer())) widthRef.current.focus(); }}>
            <Labelled icon="add">New drawer</Labelled>
          </button>
        </div>
        {sections}
      </div>
      <div className="ai-template-submit">
        <button ref={previewButtonRef} type="button" className={`${!state.cached && !state.continueVisible ? "ai-template-primary " : ""}ai-with-pictogram`} disabled={previewDisabled} title={error || ""} onClick={planner.preview}>
          <Labelled icon="eye">{busy ? "Building preview…" : "Preview layout"}</Labelled>
        </button>
      </div>
    </div>
    <div className="ai-template-review drawer-review">
      <ol className="ai-flow" aria-label="Make a drawer organizer">
        {["Measure", "Arrange", "Review"].map((text, index) => <li key={text} aria-current={index === step ? "step" : undefined}>{text}</li>)}
      </ol>
      <div className="drawer-view-toolbar">
        <div className="ai-template-shapes" role="group" aria-label="Drawer view">
          <button type="button" className="ai-with-pictogram" aria-pressed={String(view === "layout")} onClick={() => planner.setView("layout")}><Labelled icon="grid">Layout</Labelled></button>
          <button type="button" className="ai-with-pictogram" aria-pressed={String(view === "preview")} disabled={!preview} onClick={() => planner.setView("preview")}><Labelled icon="box">3D preview</Labelled></button>
        </div>
        <div className="ai-template-actions drawer-bin-actions" hidden={!ready}>
          <button ref={addBinRef} type="button" className="ai-with-pictogram" disabled={busy || !ready || draft.bins.length >= 16} onClick={planner.addBin}><Labelled icon="add">Add bin</Labelled></button>
          <button type="button" className="ai-with-pictogram" disabled={busy || !ready} onClick={planner.fill}><Labelled icon="pattern">Fill gaps</Labelled></button>
        </div>
        <div className="ai-template-actions">
          <button ref={undoRef} type="button" className="ai-with-pictogram" disabled={busy || !state.undo.length} onClick={() => history("undo")}><Labelled icon="undo">Undo layout</Labelled></button>
          <button ref={redoRef} type="button" className="ai-with-pictogram" disabled={busy || !state.redo.length} onClick={() => history("redo")}><Labelled icon="redo">Redo</Labelled></button>
        </div>
      </div>
      <div className="drawer-layout-view" hidden={view !== "layout"}>
        <div className="drawer-board-area">
          <div className="drawer-empty" hidden={ready}>
            <DimensionGuide title="Start with the inside measurements" note="Measure the clear space inside your drawer. Leave enough height for it to close." width={draft.width} depth={draft.depth} height={draft.height} kind="drawer" />
            <button type="button" className="drawer-example" hidden={ready} onClick={planner.example}>Try a 336 × 252 mm example</button>
          </div>
          <div ref={boardRef} id="drawer-board" className="drawer-board" role="group" aria-label="Drawer layout. Drag empty cells to draw a bin; drag a bin to move it." hidden={!ready}
            style={ready ? { "--drawer-columns": metrics.columns, "--drawer-rows": metrics.rows, aspectRatio: `${metrics.columns} / ${metrics.rows}` } : undefined} {...board}>
            {ready && draft.bins.map((entry, index) => <BinButton key={entry.id} bin={entry} index={index} selected={selectedId === entry.id} invalid={!!placementError(draft, entry, entry.id)} busy={busy} style={position(entry)} onKeyDown={event => binKeyDown(entry, event)} />)}
            <div className="drawer-ghost" hidden={!ghost} aria-hidden="true" data-invalid={ghost ? String(ghost.invalid) : undefined} style={ghost ? position(ghost.rect) : undefined}>{ghost?.text}</div>
          </div>
          <p className="drawer-front" hidden={!ready}>Front of drawer</p>
        </div>
        <p id="drawer-summary" className="ai-template-note" aria-live="polite">{status.summary}</p>
        <p className="ai-template-note">Drag to draw or move a bin. Arrow keys move the selected bin; Shift + arrows resize it.</p>
      </div>
      <section className="ai-template-preview drawer-3d" tabIndex={-1} hidden={view !== "preview"} aria-label="Drawer 3D preview">
        {preview && <PreviewContent key={preview.seq} preview={preview} createPreviewView={createPreviewView} titleRef={reviewTitleRef} stale={state.stale} />}
        {preview && <div className="ai-preview-footer">
          {preview.rotated > 0 && <p className="ai-template-note">{`${preview.rotated} part(s) need a 90° turn on the print bed. Drawer assembly positions are unchanged.`}</p>}
          <p className="ai-template-note">{`${preview.parts} editable parts. Printed fit remains unverified.`}</p>
          <div className="ai-template-actions">
            <button type="button" className="ai-template-primary" disabled={busy || !state.cached} onClick={planner.apply}>{preview.replaceExisting ? "Update layout in document" : "Add layout to document"}</button>
            <button type="button" disabled={busy} onClick={() => { flushSync(() => planner.cancelPreview()); previewButtonRef.current.focus(); }}>Cancel preview</button>
            <button type="button" className="ai-template-primary" hidden={!state.continueVisible} onClick={() => document.getElementById("ai-setup-close").click()}>Continue in editor</button>
          </div>
        </div>}
      </section>
    </div>
  </div>;
}

function BinButton({ bin, index, selected, invalid, busy, style, onKeyDown }) {
  const openSides = bin.openSides || [];
  let title = `${bin.label} · ${bin.columns} × ${bin.rows}`, label = `${bin.label}, ${bin.columns} by ${bin.rows} cells. Arrow keys move; Shift and arrows resize.`;
  if (bin.closeGaps) { title += ". Flush joining ends"; label += " Flush joining ends."; }
  if (openSides.length) { title += `. Open sides: ${openSides.join(", ")}.`; label += ` Open sides: ${openSides.join(", ")}.`; }
  const sides = Object.fromEntries(BIN_SIDES.map(side => [`data-open-${side}`, String(openSides.includes(side))]));
  return <button type="button" className="drawer-bin" data-bin-id={bin.id} data-compact={String(bin.columns === 1 && bin.rows === 1)} aria-pressed={String(selected)}
    title={title} aria-label={label} disabled={busy} {...sides} data-open-sides={String(openSides.length > 0)} data-close-gaps={String(bin.closeGaps === true)}
    data-invalid={invalid ? "true" : undefined} style={style} onKeyDown={onKeyDown}>
    <span className="drawer-bin-index">{String(index + 1)}</span>
    <strong>{bin.label}</strong>
    <small>{`${bin.columns} × ${bin.rows}`}</small>
    {selected && <span className="drawer-resize" data-resize="true" aria-hidden="true" />}
  </button>;
}

function PreviewContent({ preview, createPreviewView, titleRef, stale }) {
  const contentRef = useRef(null), fallback = usePreviewView(contentRef, preview.previewId, createPreviewView);
  return <div ref={contentRef} className="ai-preview-content">
    <h3 ref={titleRef} tabIndex={-1}>Review drawer layout</h3>
    <p className="ai-template-stale" hidden={!stale} role="status">Out of date. Preview the layout again before adding.</p>
    {fallback && preview.image && <>
      <img src={preview.image.dataUrl} alt="3D preview of the proposed drawer bins and baseplates" />
      <p className="ai-template-note">Interactive view unavailable. Showing the preview image.</p>
    </>}
  </div>;
}

function Inspector({ planner, draft, bin, busy, ready, references, onRemoved }) {
  const sectionRef = useRef(null), headerRef = useRef(null);
  useLayoutEffect(() => {
    const settings = sectionRef.current.parentElement, header = headerRef.current;
    if (!header) { settings.style.removeProperty("--drawer-inspector-height"); return; }
    const update = () => { if (header.isConnected) settings.style.setProperty("--drawer-inspector-height", `${header.getBoundingClientRect().height}px`); };
    update();
    const observer = new ResizeObserver(update); observer.observe(header);
    return () => { observer.disconnect(); settings.style.removeProperty("--drawer-inspector-height"); };
  }, [bin?.id]);
  return <section ref={sectionRef} className="drawer-inspector" aria-label="Selected bin" hidden={!ready} data-selected-bin-id={bin?.id || ""}>
    {bin ? <BinInspector key={bin.id} planner={planner} draft={draft} bin={bin} busy={busy} headerRef={headerRef} references={references} onRemoved={onRemoved} /> : <>
      <h3>Make room for your things</h3>
      <p className="ai-template-note">{draft.bins.length ? "Select a bin on the drawer to adjust it." : draft.includeBaseplate ? "Choose Add bin, or drag across the grid to draw one. You can also preview just the baseplates." : "Draw a rectangle on the grid or choose Add bin."}</p>
    </>}
  </section>;
}

function useDetails(initial) {
  const [open, setOpen] = useState(initial);
  return { open, onToggle: event => setOpen(event.currentTarget.open) };
}

function BinInspector({ planner, draft, bin, busy, headerRef, references, onRemoved }) {
  const names = (bin.openSides || []).map(side => side[0].toUpperCase() + side.slice(1));
  const rooms = useBinTexts(planner, { x: String(bin.dividers.x + 1), y: String(bin.dividers.y + 1) }, { x: COMPARTMENT_LIMITS, y: COMPARTMENT_LIMITS });
  const thickness = useBinTexts(planner, { floor: String(binFloor(draft, bin)), wall: String(binWall(draft, bin)) }, THICKNESS_LIMITS);
  const ownThickness = bin.floor !== undefined || bin.wall !== undefined;
  const divided = bin.dividers.x || bin.dividers.y;
  const walls = useDetails(names.length > 0), compartments = useDetails(!!divided), more = useDetails(false);
  const printHeight = normalizePrintArea(draft.printArea)?.height ?? Infinity;
  const stepper = (key, title, mm) => {
    let printable = true;
    const expanded = binFootprint({ ...bin, [key]: bin[key] + 1 });
    try { checkPrintFit(draft.printArea, expanded.width, expanded.depth, binTotalHeight({ ...bin, floor: binFloor(draft, bin) }), bin.label); } catch { printable = false; }
    return <div className="drawer-stepper">
      <span>{title}</span>
      <div>
        <button type="button" aria-label={`Decrease ${title.toLowerCase()}`} disabled={busy || bin[key] <= 1} onClick={() => planner.updateBin({ [key]: bin[key] - 1 })}>−</button>
        <output>{`${bin[key]} cells`}</output>
        <button type="button" aria-label={`Increase ${title.toLowerCase()}`} disabled={busy || !printable || bin[key] >= normalizeBinLimits(draft.binLimits)[key]} onClick={() => planner.updateBin({ [key]: bin[key] + 1 })}>+</button>
      </div>
      <small>{`${mm} mm`}</small>
    </div>;
  };
  const heights = [...new Set([2, 3, 5, 7, bin.heightUnits])].sort((a, b) => a - b);
  const total = binTotalHeight({ ...bin, floor: binFloor(draft, bin) });
  const stackingNote = bin.openSides?.length === 4 ? "All sides are open, so no stacking rim remains." : bin.lip
    ? `The rim adds 4.4 mm. Total bin height: ${total.toFixed(1)} mm. Check the complete stack against the drawer height.`
    : "Adds a 4.4 mm rim to support another Gridfinity bin.";
  return <>
    <div ref={headerRef} className="drawer-inspector-header">
      <h3 className="ai-with-pictogram"><Labelled icon="box">{bin.label}</Labelled></h3>
      <div className="ai-template-actions">
        <button type="button" className="ai-with-pictogram" disabled={busy} onClick={planner.rotateBin}><Labelled icon="rotate">Rotate</Labelled></button>
        <button type="button" className="ai-with-pictogram" disabled={busy} onClick={planner.duplicateBin}><Labelled icon="duplicate">Duplicate</Labelled></button>
        <button type="button" className="ai-template-remove ai-with-pictogram" disabled={busy}
          onClick={() => { flushSync(() => planner.removeBin()); onRemoved(); }}><Labelled icon="del">Remove bin</Labelled></button>
      </div>
    </div>
    <TextField id="drawer-bin-label" label="Name" value={bin.label} disabled={busy} onCommit={label => planner.updateBin({ label })} />
    <div className="ai-template-fields">{stepper("columns", "Width", binFootprint(bin).width)}{stepper("rows", "Depth", binFootprint(bin).depth)}</div>
    <span>Height</span>
    <div className="ai-template-shapes" role="group" aria-label="Bin height">
      {heights.map(units => {
        const partHeight = binTotalHeight({ ...bin, heightUnits: units, floor: binFloor(draft, bin) });
        return <button key={units} type="button" disabled={busy || partHeight + drawerBinBaseZ(draft) > draft.height || partHeight > printHeight} aria-pressed={String(bin.heightUnits === units)}
          onClick={() => planner.updateBin({ heightUnits: units })}>{`${units * 7} mm`}</button>;
      })}
    </div>
    {bin.kind === "bin" && <>
      <div className="ai-template-group">
        <label className="ai-template-field" htmlFor="drawer-bin-stackable">
          <input id="drawer-bin-stackable" type="checkbox" checked={bin.lip} disabled={busy} aria-describedby="drawer-bin-stacking-note" onChange={event => planner.updateBin({ lip: event.target.checked })} />
          <span>Stackable rim</span>
        </label>
        <p id="drawer-bin-stacking-note" className="ai-template-note">{stackingNote}</p>
      </div>
      <details className="drawer-wall-options" open={walls.open} onToggle={walls.onToggle}>
        <summary className="ai-with-pictogram"><Labelled icon="shell">{names.length ? `Open sides: ${names.join(", ")}` : "Open sides"}</Labelled></summary>
        <WallControls id="drawer-close-gaps" value={bin.openSides} closeGaps={bin.closeGaps} disabled={busy}
          onChange={(openSides, closeGaps) => planner.updateBin({ openSides, closeGaps })} onCloseGaps={closeGaps => planner.updateBin({ closeGaps })} />
      </details>
      <details className="drawer-compartment-options" open={compartments.open} onToggle={compartments.onToggle}>
        <summary className="ai-with-pictogram"><Labelled icon="grid">{divided ? `Compartments: ${bin.dividers.x + 1} × ${bin.dividers.y + 1}` : "Compartments"}</Labelled></summary>
        <CompartmentFields id="drawer-bin-compartments" texts={rooms.texts} disabled={busy} invalid={rooms.invalid} onText={rooms.setText} onEdit={rooms.edit}
          onCommit={rooms.commit(texts => ({ dividers: { x: Number(texts.x) - 1, y: Number(texts.y) - 1 } }))} />
      </details>
    </>}
    {bin.kind === "insert" && <BinPockets planner={planner} bin={bin} busy={busy} references={references} />}
    <details className="drawer-advanced" open={more.open} onToggle={more.onToggle}>
      <summary>More bin options</summary>
      <div className="ai-template-shapes" role="group" aria-label="Part type">
        {[["bin", "Storage bin"], ["insert", "Insert blank"]].map(([kind, text]) => <button key={kind} type="button" disabled={busy} aria-pressed={String(bin.kind === kind)}
          onClick={() => planner.updateBin({ kind, ...(kind === "insert" ? { dividers: { x: 0, y: 0 }, lip: false, openSides: [], closeGaps: false } : { pockets: undefined }) })}>{text}</button>)}
      </div>
      <label className="ai-template-field" htmlFor="drawer-bin-own-thickness">
        <input id="drawer-bin-own-thickness" type="checkbox" checked={ownThickness} disabled={busy}
          onChange={event => planner.updateBin(event.target.checked ? { floor: draft.floor, wall: draft.wall } : { floor: undefined, wall: undefined })} />
        <span>Own floor and wall thickness</span>
      </label>
      {ownThickness && <ThicknessFields id="drawer-bin" texts={thickness.texts} disabled={busy} invalid={thickness.invalid} onText={thickness.setText} onEdit={thickness.edit}
        onCommit={thickness.commit(texts => ({ floor: Number(texts.floor), wall: Number(texts.wall) }))} />}
      <p className="ai-template-note">{ownThickness ? "This bin keeps its own values when the drawer defaults change." : `Uses the drawer defaults: ${draft.floor} mm floor, ${draft.wall} mm wall.`}</p>
      <MagnetControls id="drawer-bin-magnets" label="Magnet pockets under this part" value={bin.magnets || false} disabled={busy} onInput={planner.markEditing} onChange={planner.setBinMagnets} />
      <button type="button" disabled={busy || !bin.magnets} onClick={planner.magnetsForAll}>Use this magnet fit in all bins</button>
    </details>
  </>;
}

// Texts follow the committed bin; a complete valid set commits on change, otherwise the preview waits.
function useBinTexts(planner, values, limits) {
  const key = JSON.stringify(values), latest = useRef(values);
  const [texts, setTexts] = useState(values), [touched, setTouched] = useState({});
  useLayoutEffect(() => { latest.current = values; setTexts(values); setTouched({}); }, [key]);
  const valid = () => Object.entries(limits).every(([field, range]) => numberValid(latest.current[field], range));
  return {
    texts,
    invalid: name => touched[name] ? !numberValid(texts[name], limits[name]) : undefined,
    setText: (name, text) => { latest.current = { ...latest.current, [name]: text }; setTexts(latest.current); },
    edit: () => valid() ? planner.settle() : planner.markEditing(),
    commit: change => name => {
      setTouched(current => ({ ...current, [name]: true }));
      if (valid()) planner.updateBin(change(latest.current));
    },
  };
}

function BinPockets({ planner, bin, busy, references }) {
  const key = JSON.stringify(bin.pockets || []), fromBin = () => (bin.pockets || []).map((pocket, i) => draftFromPocket(pocket, i + 1));
  const [drafts, setDrafts] = useState(fromBin), [bad, setBad] = useState(() => new Set());
  const latest = useRef(drafts), addRef = useRef(null);
  useLayoutEffect(() => { latest.current = fromBin(); setDrafts(latest.current); setBad(new Set()); }, [key]);
  const save = () => { if (latest.current.every(pocketDraftValid)) planner.updateBin({ pockets: latest.current.map(pocketFromDraft) }); else planner.markEditing(); };
  const replace = (next, commit) => {
    latest.current = next; setDrafts(next);
    if (commit) save(); else if (next.every(pocketDraftValid)) planner.settle(); else planner.markEditing();
  };
  const change = (index, edit, commit) => replace(latest.current.map(draft => draft.index === index ? edit(draft) : draft), commit);
  const add = () => {
    const ids = new Set(latest.current.map(draft => draft.id ?? `pocket-${draft.index}`));
    let n = 1; while (ids.has(`pocket-${n}`)) n++;
    replace([...latest.current, { ...newPocketDraft(nextPocketIndex(latest.current)), id: `pocket-${n}` }], true);
  };
  return <section className="ai-template-group drawer-bin-pockets" aria-label="Insert pockets">
    <h4>Pockets</h4>
    <p className="ai-template-note">Pockets are cut into this insert when you preview. Clearance is per side; suggested values need a fit test on your printer.</p>
    <div className="ai-template-pockets">
      {drafts.map(draft => <PocketForm key={draft.index} pocket={draft} id={name => `drawer-pocket-${draft.index}-${name}`} titleId={`drawer-pocket-title-${draft.index}`}
        disabled={busy} references={references} invalid={id => bad.has(id) || undefined}
        onValidity={(id, valid) => setBad(current => { const next = new Set(current); if (valid) next.delete(id); else next.add(id); return next; })}
        onPatch={(patch, commit) => change(draft.index, current => ({ ...current, ...patch }), commit)}
        onField={(name, text) => change(draft.index, current => ({ ...current, fields: { ...current.fields, [name]: text } }), false)} onCommit={save}
        onReference={body => change(draft.index, current => ({ ...current, ...referencePatch(current, body) }), true)}
        onRemove={() => { replace(latest.current.filter(entry => entry.index !== draft.index), true); addRef.current?.focus(); }} />)}
    </div>
    <button ref={addRef} type="button" disabled={busy || drafts.length >= MAX_POCKETS} onClick={add}>Add pocket</button>
  </section>;
}
