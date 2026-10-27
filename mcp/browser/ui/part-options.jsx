import { useRef } from "react";
import { numberValid } from "./field-text.js";
import { POCKET_LIMITS, COMPARTMENT_LIMITS, pocketFieldUsed } from "./pocket-draft.js";
import { NumberField } from "./controls.jsx";

// Options shared by the Gridfinity part dialog and the drawer's bin inspector. Each caller owns the texts and decides when an edit is committed.
const SHAPES = [["roundedRect", "Rounded"], ["circle", "Circle"], ["capsule", "Capsule"]];
const EVIDENCE = [["estimate", "Estimate"], ["measured", "Measured"], ["manufacturer", "Published"], ["model", "Model"]];
export const THICKNESS_LIMITS = { floor: { min: 0.8, max: 6 }, wall: { min: 0.8, max: 4 } };

export function ThicknessFields({ id, texts, onText, onCommit, onEdit, invalid = () => undefined, disabled, describedBy }) {
  return <div className="ai-template-fields">
    {[["floor", "Floor thickness (mm)"], ["wall", "Wall thickness (mm)"]].map(([name, label]) => <NumberField key={name} id={`${id}-${name}`} label={label} text={texts[name]}
      limits={THICKNESS_LIMITS[name]} disabled={disabled} describedBy={describedBy} invalid={invalid(name)}
      onText={text => onText(name, text)} onEdit={text => onEdit?.(name, text)} onCommit={onCommit && (text => onCommit(name, text))} />)}
  </div>;
}

export function CompartmentFields({ id, texts, onText, onCommit, onEdit, invalid = () => undefined, disabled, describedBy }) {
  return <div className="ai-template-fields">
    {[["x", "Compartments across width"], ["y", "Compartments along depth"]].map(([axis, label]) => <NumberField key={axis} id={`${id}-${axis}`} label={label} text={texts[axis]}
      limits={COMPARTMENT_LIMITS} disabled={disabled} describedBy={describedBy} invalid={invalid(axis)}
      onText={text => onText(axis, text)} onEdit={text => onEdit?.(axis, text)} onCommit={onCommit && (text => onCommit(axis, text))} />)}
  </div>;
}

// `onPatch(patch, commit)` commits discrete choices at once; typed text commits through `onCommit` when the field changes.
export function PocketForm({ pocket, id, titleId, describedBy, disabled, references, onPatch, onField, onCommit = () => {}, onReference, onRemove, invalid = () => undefined, onValidity = () => {} }) {
  const { index, shape } = pocket;
  const widthRef = useRef(null);
  const field = (name, label) => {
    const off = !pocketFieldUsed(shape, name);
    return <NumberField id={id(name)} label={label} text={pocket.fields[name]} limits={POCKET_LIMITS[name]} describedBy={describedBy}
      disabled={disabled || off} hidden={off} inputRef={name === "width" ? widthRef : undefined} invalid={invalid(id(name))}
      onText={text => onField(name, text)} onEdit={text => onValidity(id(name), numberValid(text, POCKET_LIMITS[name]))} onCommit={() => onCommit()} />;
  };
  const choices = (label, entries, current, key) => <div className="ai-template-shapes" aria-label={label}>
    {entries.map(([value, text]) => <button key={value} type="button" aria-pressed={String(value === current)} disabled={disabled} onClick={() => onPatch({ [key]: value }, true)}>{text}</button>)}
  </div>;
  const text = (name, label, type, maxLength) => <label className="ai-template-field" htmlFor={id(name)}>
    <span>{label}</span>
    <input id={id(name)} type={type} maxLength={maxLength} value={pocket[name]} disabled={disabled} aria-invalid={name === "url" && invalid(id(name)) && "true"}
      onChange={event => { onPatch({ [name]: event.target.value }, false); if (name === "url") onValidity(id(name), event.target.validity.valid); }} onBlur={() => onCommit()} />
  </label>;
  return <section className="ai-template-pocket" aria-labelledby={titleId}>
    <header>
      <h4 id={titleId}>{`Pocket ${index}`}</h4>
      <button type="button" className="ai-template-remove" aria-label={`Remove pocket ${index}`} disabled={disabled} onClick={onRemove}>Remove</button>
    </header>
    {shape === "contour" ? <p className="ai-template-note">{`Traced outline, ${pocket.profile.segments.length} segments. Its shape is fixed here; position, depth and fit stay editable.`}</p>
      : choices(`Pocket ${index} shape`, SHAPES, shape, "shape")}
    <div className="ai-template-fields">{field("width", "Width / diameter (mm)")}{field("height", "Length (mm)")}{field("depth", "Pocket depth (mm)")}</div>
    <details>
      <summary>Position &amp; fit</summary>
      <div className="ai-template-fields">
        {field("radius", "Corner radius (mm)")}{field("clearance", "Clearance per side (mm)")}
        {field("x", "Centre X (mm)")}{field("y", "Centre Y (mm)")}{field("rotation", "Rotation about Z (degrees)")}
        <label className="ai-template-field" htmlFor={id("merge")}>
          <input id={id("merge")} type="checkbox" checked={pocket.merge} disabled={disabled} onChange={event => onPatch({ merge: event.target.checked }, true)} />
          <span>Allow overlap with earlier pockets</span>
        </label>
      </div>
    </details>
    <details>
      <summary>Reference and dimensions</summary>
      <div className="ai-template-reference" hidden={shape === "contour"}>
        <p className="ai-template-note">{references.length ? "Use a reference body's bounding dimensions as an envelope." : "No visible reference bodies. Enter measured dimensions above."}</p>
        {references.map(body => <button key={body.id} type="button" disabled={disabled} aria-pressed={String(pocket.referenceBodyId === body.id)}
          onClick={() => { onReference(body); widthRef.current.focus(); }}>{body.name}</button>)}
      </div>
      <div className="ai-template-group">
        <span>Dimension evidence</span>
        {choices("Dimension evidence", EVIDENCE, pocket.evidenceKind, "evidenceKind")}
        <span>Original source units. Pocket dimensions are always entered in millimetres.</span>
        {choices("Original dimension units", ["mm", "cm", "in"].map(units => [units, units]), pocket.sourceUnits, "sourceUnits")}
        {text("product", "Item / model variant", "text", 160)}
        {text("url", "Dimension source URL (optional)", "url", 2000)}
      </div>
    </details>
  </section>;
}
