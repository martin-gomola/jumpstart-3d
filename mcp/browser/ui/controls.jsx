import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { BIN_SIDES, normalizeOpenSides } from "../../shared/gridfinity-walls.js";
import { DEFAULT_MAGNET_POCKETS } from "../../shared/gridfinity-magnets.js";
import { numberValid } from "./field-text.js";
import { pictogramSvg } from "./pictograms.js";

// The parent element carries the `ai-with-pictogram` class.
export function Labelled({ icon, children }) {
  return <>
    <span className="ai-pictogram" aria-hidden="true" dangerouslySetInnerHTML={{ __html: pictogramSvg(icon) }} />
    <span className="ai-control-label">{children}</span>
  </>;
}

// React's onChange follows `input`; edits commit on the native `change` event, as before.
function useNativeChange(ref, handler) {
  const latest = useRef(handler); latest.current = handler;
  useEffect(() => {
    const input = ref.current, listener = event => flushSync(() => latest.current(event));
    input.addEventListener("change", listener);
    return () => input.removeEventListener("change", listener);
  }, [ref]);
}

// The native viewer owns its canvas; it sits before `beforeRef`, or after the React-rendered children.
// Returns true when the viewer is unavailable and the caller should show a still image.
export function usePreviewView(containerRef, previewId, createPreviewView, beforeRef) {
  const [fallback, setFallback] = useState(false);
  useLayoutEffect(() => {
    let view;
    try { view = createPreviewView(previewId); containerRef.current.insertBefore(view.element, beforeRef?.current || null); }
    catch { setFallback(true); }
    return () => { view?.dispose(); view?.element.remove(); };
  }, [previewId]);
  return fallback;
}

// Opens collapsed sections around the first invalid control, marks it and lets the browser report it.
export function revealInvalid(form, mark) {
  const invalid = [...form.querySelectorAll("input")].find(input => !input.disabled && !input.validity.valid);
  if (invalid) {
    for (let parent = invalid.parentElement; parent && parent !== form; parent = parent.parentElement) if (parent.tagName === "DETAILS") parent.open = true;
    flushSync(() => mark(invalid.id));
  }
  return form.reportValidity();
}

export function NumberField({ id, label, text, onText, limits = {}, onCommit, onEdit, disabled, hidden, invalid, describedBy = "drawer-message", inputRef }) {
  const own = useRef(null), ref = inputRef || own;
  useNativeChange(ref, event => { onText(event.target.value); onCommit?.(event.target.value); });
  return <label className="ai-template-field" htmlFor={id} hidden={hidden}>
    <span>{label}</span>
    <input ref={ref} id={id} type="number" min={limits.min} max={limits.max} step={limits.step ?? "any"} value={text} required disabled={disabled}
      aria-describedby={describedBy} aria-invalid={invalid === undefined ? undefined : String(invalid)}
      onChange={event => { onText(event.target.value); onEdit?.(event.target.value); }} />
  </label>;
}

export function TextField({ id, label, value, maxLength = 80, onCommit, disabled }) {
  const ref = useRef(null), [text, setText] = useState(value);
  useLayoutEffect(() => setText(value), [value]);
  useNativeChange(ref, event => { setText(event.target.value); onCommit(event.target.value); });
  return <label className="ai-template-field" htmlFor={id}>
    <span>{label}</span>
    <input ref={ref} id={id} type="text" maxLength={maxLength} value={text} disabled={disabled} onChange={event => setText(event.target.value)} />
  </label>;
}

const MAGNET_LIMITS = { diameter: { min: 2, max: 8 }, depth: { min: 0.5, max: 4 } };
const magnetTexts = value => {
  const config = value === true || !value ? DEFAULT_MAGNET_POCKETS : value;
  return { enabled: !!value, diameter: String(config.diameter ?? DEFAULT_MAGNET_POCKETS.diameter), depth: String(config.depth ?? DEFAULT_MAGNET_POCKETS.depth) };
};

export function MagnetControls({ id, label = "Magnet pockets", value, disabled, onChange, onInput = () => {}, onValid = () => {} }) {
  const [texts, setTexts] = useState(() => magnetTexts(value)), [touched, setTouched] = useState({});
  const key = JSON.stringify(value || false);
  useLayoutEffect(() => { setTexts(magnetTexts(value)); setTouched({}); }, [key]);
  const valid = !texts.enabled || numberValid(texts.diameter, MAGNET_LIMITS.diameter) && numberValid(texts.depth, MAGNET_LIMITS.depth);
  const read = next => next.enabled ? { diameter: Number(next.diameter), depth: Number(next.depth) } : false;
  // Reports the value being typed as well, before it is committed on `change`.
  useEffect(() => onValid(valid, read(texts)), [valid, texts.enabled, texts.diameter, texts.depth]);
  const field = (name, text) => <NumberField id={`${id}-${name}`} label={text} text={texts[name]} limits={MAGNET_LIMITS[name]} describedBy={`${id}-note`}
    disabled={disabled || !texts.enabled} invalid={touched[name] ? !numberValid(texts[name], MAGNET_LIMITS[name]) : undefined}
    onText={next => setTexts(current => ({ ...current, [name]: next }))} onEdit={onInput}
    onCommit={next => { setTouched(current => ({ ...current, [name]: true })); onChange(read({ ...texts, [name]: next })); }} />;
  return <div className="ai-template-group">
    <label className="ai-template-field" htmlFor={id}>
      <input id={id} type="checkbox" checked={texts.enabled} disabled={disabled}
        onChange={event => { const next = { ...texts, enabled: event.target.checked }; setTexts(next); onChange(read(next)); }} />
      <span>{label}</span>
    </label>
    <div className="ai-template-group" hidden={!texts.enabled}>
      <div className="ai-template-fields">{field("diameter", "Pocket diameter (mm)")}{field("depth", "Pocket depth (mm)")}</div>
      <p className="ai-template-note" id={`${id}-note`}>Defaults allow glue clearance for nominal 6 × 2 mm magnets. Adjust pocket sizes for your magnets and printer.</p>
    </div>
  </div>;
}

const EDGE_PATHS = { left: "M4 4v16", right: "M20 4v16", front: "M4 20h16", back: "M4 4h16" };

export function WallControls({ id, heading, value = [], closeGaps = false, disabled, onChange, onCloseGaps }) {
  const sides = normalizeOpenSides(value), flush = closeGaps && sides.length > 0;
  return <section className="ai-template-group ai-wall-controls">
    {heading && <h4>{heading}</h4>}
    <p className="ai-template-note">Open matching sides on neighbouring bins for long items. Each part prints separately. Standard edges retain a small seam.</p>
    <div className="ai-template-fields ai-wall-choices" role="group" aria-label="Open sides">
      {BIN_SIDES.map(side => {
        const open = sides.includes(side);
        return <button key={side} type="button" className="ai-wall-choice" aria-label={`Open ${side} side`} aria-pressed={String(open)} disabled={disabled}
          onClick={() => { const next = open ? sides.filter(name => name !== side) : [...sides, side]; onChange(next, next.length ? flush : false); }}>
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className="ai-wall-icon">
            <path d={BIN_SIDES.filter(name => name !== side).map(name => EDGE_PATHS[name]).join(" ")} className="ai-wall-other" />
            <path d={EDGE_PATHS[side]} className="ai-wall-edge" strokeDasharray={open ? "2 2" : "none"} />
          </svg>
          <span>{side[0].toUpperCase() + side.slice(1)}</span>
          <small>{open ? "Open" : "Closed"}</small>
        </button>;
      })}
    </div>
    <label className="ai-template-field" htmlFor={id}>
      <input id={id} type="checkbox" checked={flush} disabled={disabled || !sides.length} aria-describedby={`${id}-note`} onChange={event => onCloseGaps(event.target.checked)} />
      <span>Close gaps on open sides</span>
    </label>
    <p id={`${id}-note`} className="ai-template-note">Square ends meet at the grid boundary above the base. Enable on both neighbours. No connector; printed fit needs checking.</p>
  </section>;
}

// A live sizing sketch is deliberately separate from the inspected native preview.
export function DimensionGuide({ title, note, width, depth, height, edgeMargin = 0, kind = "bin", columns = 0, rows = 0, hidden }) {
  const supplied = [width, depth, height].every(n => Number.isFinite(n) && n > 0);
  const printer = kind === "printer";
  const scale = printer ? Math.max(width || 1, depth || 1) : Math.max(width || 1, depth || 1, (height || 1) * 2);
  const w = supplied ? 140 * width / scale : 140, d = supplied ? 140 * depth / scale : 110;
  const h = supplied ? Math.max(6, 140 * height / scale) : 64;
  const a = [260, 65], b = [260 + w, 65 + w / 2], c = [260 + w - d, 65 + (w + d) / 2], e = [260 - d, 65 + d / 2];
  const down = p => [p[0], p[1] + h];
  const points = list => list.map(p => p.join(",")).join(" ");
  const center = [260 + (w - d) / 2, 65 + (w + d) / 4];
  const format = n => new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(n);
  const drawer = kind === "drawer";
  const printerA = [260, 118], printerB = [260 + w, 118 + w / 2], printerE = [260 - d, 118 + d / 2], printerC = [260 + w - d, 118 + (w + d) / 2];
  const printerRise = supplied ? 82 + 18 * Math.min(1, height / Math.max(width, depth)) : 90;
  const up = point => [point[0], point[1] - printerRise], between = (from, to, ratio) => from.map((value, axis) => value + (to[axis] - value) * ratio);
  const printerTop = [printerA, printerB, printerC, printerE].map(up), printerMidLeft = between(up(printerA), up(printerE), .5), printerMidRight = between(up(printerB), up(printerC), .5);
  const printerCenter = [260 + (w - d) / 2, 118 + (w + d) / 4], marginW = supplied ? Math.min(.45, Math.max(0, edgeMargin / width)) : 0, marginD = supplied ? Math.min(.45, Math.max(0, edgeMargin / depth)) : 0;
  const bedPoint = (u, v) => printerA.map((value, axis) => value + (printerB[axis] - value) * u + (printerE[axis] - value) * v);
  const bedInset = [bedPoint(marginW, marginD), bedPoint(1 - marginW, marginD), bedPoint(1 - marginW, 1 - marginD), bedPoint(marginW, 1 - marginD)];
  const printerGrid = printer ? Array.from({ length: 5 }, (_, index) => (index + 1) / 6).flatMap(ratio => [
    [between(printerA, printerB, ratio), between(printerE, printerC, ratio)],
    [between(printerA, printerE, ratio), between(printerB, printerC, ratio)],
  ]) : [];
  const widthText = supplied ? `${format(width)} mm wide` : drawer ? "Inside width" : "Width";
  const depthText = supplied ? `${format(depth)} mm deep` : drawer ? "Inside depth" : "Depth";
  const heightText = supplied ? `${format(height)} mm tall` : drawer ? "Usable height" : "Height";
  const grid = kind === "baseplate" && columns > 0 && rows > 0;
  return <section className="ai-dimension-guide" aria-label={title} hidden={hidden}>
    <h3>{title}</h3>
    <svg viewBox="0 0 520 340" role="img" aria-label={`${title}: ${printer ? "open printer frame and build plate, " : ""}${widthText}, ${depthText}, ${heightText}`}>
      {printer && <g className="ai-printer-frame" fill="none" aria-hidden="true">
        {[printerA, printerB, printerE].map((point, index) => <line key={`post${index}`} x1={point[0]} y1={point[1]} x2={up(point)[0]} y2={up(point)[1]} className="ai-guide-grid" />)}
        <polygon points={points(printerTop)} className="ai-guide-grid" />
        <line x1={printerMidLeft[0]} y1={printerMidLeft[1]} x2={printerMidRight[0]} y2={printerMidRight[1]} className="ai-guide-grid" />
      </g>}
      <g className={printer ? "ai-printer-build-plate" : undefined}>
        {printer ? <>
          <polygon points={points([printerE, printerC, [printerC[0], printerC[1] + 7], [printerE[0], printerE[1] + 7]])} className="ai-guide-face" />
          <polygon points={points([printerC, printerB, [printerB[0], printerB[1] + 7], [printerC[0], printerC[1] + 7]])} className="ai-guide-side" />
          <polygon points={points([printerA, printerB, printerC, printerE])} className="ai-guide-top" />
          {printerGrid.map((line, index) => <line key={`printer-grid-${index}`} x1={line[0][0]} y1={line[0][1]} x2={line[1][0]} y2={line[1][1]} className="ai-guide-grid" />)}
          {marginW + marginD > 0 && <polygon points={points(bedInset)} fill="none" stroke="currentColor" strokeDasharray="4 3" className="ai-guide-grid" />}
        </> : <>
          <polygon points={points([e, c, down(c), down(e)])} className="ai-guide-face" />
          <polygon points={points([c, b, down(b), down(c)])} className="ai-guide-side" />
          <polygon points={points([a, b, c, e])} className="ai-guide-top" />
          {(kind === "bin" || drawer) && <polygon points={points([a, b, c, e].map(p => p.map((value, axis) => center[axis] + (value - center[axis]) * .84)))} className="ai-guide-opening" />}
          {grid && Array.from({ length: columns - 1 }, (_, i) => <line key={`c${i}`} x1={a[0] + w * (i + 1) / columns} y1={a[1] + w / 2 * (i + 1) / columns} x2={e[0] + w * (i + 1) / columns} y2={e[1] + w / 2 * (i + 1) / columns} className="ai-guide-grid" />)}
          {grid && Array.from({ length: rows - 1 }, (_, i) => <line key={`r${i}`} x1={a[0] - d * (i + 1) / rows} y1={a[1] + d / 2 * (i + 1) / rows} x2={b[0] - d * (i + 1) / rows} y2={b[1] + d / 2 * (i + 1) / rows} className="ai-guide-grid" />)}
        </>}
      </g>
      {printer && <g className="ai-printer-head" aria-hidden="true">
        <rect x={printerCenter[0] - 13} y={printerMidLeft[1] - 1} width="26" height="20" rx="2" fill="var(--panel)" stroke="currentColor" strokeWidth="2" />
        <path d={`M${printerCenter[0] - 4} ${printerMidLeft[1] + 19}h8l-4 8z`} fill="var(--accent-soft)" stroke="currentColor" strokeWidth="1.5" />
      </g>}
      <g className="ai-guide-labels">
        <text x="150" y="290" textAnchor="middle">{widthText}</text>
        <text x="365" y="290" textAnchor="middle">{depthText}</text>
        <text x="260" y="325" textAnchor="middle">{heightText}</text>
      </g>
    </svg>
    <p className="ai-template-note">{note}</p>
  </section>;
}
