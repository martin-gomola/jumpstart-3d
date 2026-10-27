import { useRef, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { NumberField, usePreviewView } from "./controls.jsx";
import { createParameterPlanner } from "./parameter-planner.js";

const format = (value) => (Number.isInteger(value) ? String(value) : value.toFixed(2));
const withUnit = (label, unit) => (unit ? `${label} (${unit})` : label);

function Preview({ preview, createPreviewView }) {
  const ref = useRef(null), dimsRef = useRef(null);
  usePreviewView(ref, preview.previewId, createPreviewView, dimsRef);
  const dims = preview.dimensions;
  return <div ref={ref} className="model-params-preview">
    {dims && <p ref={dimsRef} className="model-params-dims">{`${format(dims.x)} × ${format(dims.y)} × ${format(dims.z)} mm`}</p>}
  </div>;
}

function ParameterCard({ planner, createPreviewView }) {
  const state = useSyncExternalStore(planner.subscribe, planner.getState);
  const { model, fields, texts, busy, preview, message } = state;
  if (!model) return null;
  const errors = planner.errors(), locked = busy || model.editedOutside, changed = planner.hasChanges();
  const editable = fields.filter((f) => !f.derived), derived = fields.filter((f) => f.derived);
  const submit = (event) => { event.preventDefault(); void planner.preview(); };
  // Keys typed here belong to the form, not to the editor's shortcuts.
  return <section className="float model-params" id="model-params" aria-labelledby="model-params-title" aria-busy={String(busy)} onKeyDown={(event) => event.stopPropagation()}>
    <header><h4 id="model-params-title">Model settings</h4></header>
    <div className="body">
      <p className="model-params-name">{model.name}</p>
      {model.editedOutside && <p className="model-params-note" role="status">This model was moved or edited by hand after it was made, so its settings can no longer rebuild it. Undo those edits to use the settings again.</p>}
      {!editable.length && <p className="hint">This model has no settings you can change.</p>}
      <form id="model-params-form" className="model-params-fields" noValidate onSubmit={submit}>
        {editable.map((f) => <NumberField key={f.name} id={`model-param-${f.name}`} label={withUnit(f.label, f.unit)} text={texts[f.name] ?? ""} limits={f.limits}
          disabled={locked} invalid={!!errors[f.name]} describedBy="model-params-message" onText={(text) => planner.setText(f.name, text)} />)}
      </form>
      {derived.length > 0 && <dl className="model-params-derived" aria-label="Calculated from the settings">
        {derived.map((f) => <div key={f.name}><dt>{withUnit(f.label, f.unit)}</dt><dd>{format(f.value)}</dd></div>)}
      </dl>}
      {preview && <Preview preview={preview} createPreviewView={createPreviewView} />}
      <p id="model-params-message" className={"model-params-message" + (message?.error ? " error" : "")} role="status" aria-live="polite">{message?.text || ""}</p>
    </div>
    <footer>
      <button type="button" className="btn" id="model-params-reset" disabled={busy || !changed} onClick={planner.reset}>Reset</button>
      {preview
        ? <button type="button" className="btn primary" id="model-params-apply" disabled={busy} onClick={() => void planner.apply()}>Apply</button>
        : <button type="submit" form="model-params-form" className="btn primary" id="model-params-preview" disabled={locked || !changed}>Preview</button>}
    </footer>
  </section>;
}

// Mounts the card into `host` and returns `select(bodyIds)` for the editor selection.
export function initParameterCard({ host, request, subscribe, createPreviewView }) {
  const planner = createParameterPlanner({ request, notify: flushSync });
  subscribe((kind) => planner.documentChanged(kind));
  flushSync(() => createRoot(host).render(<ParameterCard planner={planner} createPreviewView={createPreviewView} />));
  return { select: planner.select };
}
