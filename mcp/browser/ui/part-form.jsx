import { useRef, useState } from "react";
import { numberValid } from "./field-text.js";
import { PART_TEMPLATES, PART_LIMITS, MAX_POCKETS } from "./part-planner.js";
import { Labelled, NumberField, MagnetControls, WallControls } from "./controls.jsx";
import { PocketForm, CompartmentFields, ThicknessFields } from "./part-options.jsx";

const ILLUSTRATIONS = { insert: "M5 9h30v24H5z M11 16h11v11H11z M29 18v7", bin: "M5 9h30v24H5z M5 15h30 M20 15v18", baseplate: "M5 7h30v28H5z M20 7v28 M5 21h30" };

// Mirrors the native validity marking: submit marks the first invalid field, a valid edit clears it.
export function useInvalidMarks() {
  const [ids, setIds] = useState(() => new Set());
  return {
    has: id => ids.has(id) || undefined,
    mark: id => setIds(current => new Set(current).add(id)),
    edit: (id, valid) => { if (valid && ids.has(id)) setIds(current => { const next = new Set(current); next.delete(id); return next; }); },
  };
}

// The Gridfinity part options of the editor's Parts dialog; `message` is the id that describes the fields.
export function PartForm({ planner, draft, summary, references, marks, onMagnets, idBase = "gp", wallsId = "gp-close-gaps", pocketTitle = "gp-pocket-title", message = "gp-message" }) {
  const { kind } = draft, addPocketRef = useRef(null), ids = name => `${idBase}-${name}`;
  const field = (name, label, disabled) => <NumberField id={ids(name)} label={label} text={draft.fields[name]} limits={PART_LIMITS[name]} describedBy={message}
    disabled={disabled} invalid={marks.has(ids(name))} onText={text => planner.setField(name, text)} onEdit={text => marks.edit(ids(name), numberValid(text, PART_LIMITS[name]))} />;
  const size = (name, label, axis) => {
    const id = ids(name), limits = PART_LIMITS[name], text = draft.fields[name];
    const set = next => { planner.setField(name, next); marks.edit(id, numberValid(next, limits)); };
    const step = change => { const input = document.getElementById(id); change < 0 ? input.stepDown() : input.stepUp(); set(input.value); };
    return <div className="ai-template-field">
      <label htmlFor={id}>{label}</label>
      <div className="ai-size-control">
        <button type="button" aria-label={`Decrease part ${axis}`} disabled={Number(text) <= limits.min} onClick={() => step(-1)}>−</button>
        <input id={id} name={name} type="number" min={limits.min} max={limits.max} step={limits.step} value={text} required aria-describedby={message}
          aria-invalid={marks.has(id) && "true"} onChange={event => set(event.target.value)} />
        <button type="button" aria-label={`Increase part ${axis}`} disabled={Number(text) >= limits.max} onClick={() => step(1)}>+</button>
      </div>
    </div>;
  };
  return <>
    <h3>Part type</h3>
    <div className="ai-template-list" aria-label="Gridfinity templates">
      {PART_TEMPLATES.map(([key, title, detail]) => <button key={key} type="button" className="ai-template-choice" aria-pressed={String(key === kind)} data-template={key}
        aria-label={`${title} ${detail}`} onClick={() => planner.setKind(key)}>
        <svg viewBox="0 0 40 40" aria-hidden="true"><path d={ILLUSTRATIONS[key]} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /></svg>
        <span><strong>{title}</strong><small>{detail}</small></span>
      </button>)}
    </div>
    <p className="ai-template-note">{PART_TEMPLATES.find(([key]) => key === kind)[2]}</p>
    <fieldset className="ai-template-group">
      <h4>Footprint</h4>
      <div className="ai-template-fields">{size("columns", "Width (cells)", "width")}{size("rows", "Depth (cells)", "depth")}</div>
      <p className="ai-template-note" aria-live="polite">{summary.dimensions}</p>
      <div className="ai-template-group" hidden={kind === "baseplate"}>
        <h4>Body height</h4>
        <div className="ai-template-shapes" role="group" aria-label="Part body height">
          {[2, 3, 5, 7].map(units => <button key={units} type="button" data-height={units} aria-pressed={String(Number(draft.fields.heightUnits) === units)}
            onClick={() => { planner.setField("heightUnits", String(units)); marks.edit(ids("heightUnits"), true); }}>{`${units * 7} mm`}</button>)}
        </div>
        <p className="ai-template-note">{summary.heightNote}</p>
        <details><summary>More heights</summary>{field("heightUnits", "Height (7 mm steps)", kind === "baseplate")}</details>
      </div>
      <details className="ai-template-group" hidden={kind !== "bin"}>
        <summary className="ai-with-pictogram"><Labelled icon="grid">Compartments &amp; stacking</Labelled></summary>
        <label className="ai-template-field" htmlFor={ids("lip")}>
          <input id={ids("lip")} type="checkbox" checked={draft.lip} disabled={kind !== "bin"} onChange={event => planner.setLip(event.target.checked)} />
          <span>Stackable rim</span>
        </label>
        <CompartmentFields id={ids("compartments")} texts={{ x: draft.fields.compartmentsX, y: draft.fields.compartmentsY }} disabled={kind !== "bin"} describedBy={message}
          invalid={axis => marks.has(ids(`compartments-${axis}`))} onText={(axis, text) => planner.setField(`compartments${axis.toUpperCase()}`, text)}
          onEdit={(axis, text) => marks.edit(ids(`compartments-${axis}`), numberValid(text, PART_LIMITS.compartmentsX))} />
        <WallControls id={wallsId} heading="Open sides" value={draft.openSides} closeGaps={draft.closeGaps} disabled={kind !== "bin"}
          onChange={planner.setWalls} onCloseGaps={planner.setCloseGaps} />
      </details>
      <section className="ai-template-group" hidden={kind !== "insert"}>
        <h3>Pockets</h3>
        <p className="ai-template-note">Clearance is per side. Suggested values need a fit test on your printer.</p>
        <div className="ai-template-pockets">
          {draft.pockets.map(pocket => <PocketForm key={pocket.index} pocket={pocket} id={name => ids(`${pocket.index}-${name}`)} titleId={`${pocketTitle}-${pocket.index}`}
            describedBy={message} disabled={kind !== "insert"} references={references} invalid={marks.has} onValidity={marks.edit}
            onPatch={patch => planner.setPocket(pocket.index, patch)} onField={(name, text) => planner.setPocketField(pocket.index, name, text)}
            onReference={body => planner.applyReference(pocket.index, body)} onRemove={() => { planner.removePocket(pocket.index); addPocketRef.current.focus(); }} />)}
        </div>
        <button ref={addPocketRef} type="button" disabled={draft.pockets.length >= MAX_POCKETS} onClick={planner.addPocket}>Add pocket</button>
      </section>
      <details className="ai-template-group">
        <summary className="ai-with-pictogram"><Labelled icon="magnet">Construction &amp; magnets</Labelled></summary>
        {kind !== "baseplate" && <ThicknessFields id={idBase} texts={draft.fields} describedBy={message} invalid={name => marks.has(ids(name))}
          onText={planner.setField} onEdit={(name, text) => marks.edit(ids(name), numberValid(text, PART_LIMITS[name]))} />}
        <MagnetControls id={ids("magnets")} value={draft.magnets} onChange={planner.setMagnets} onInput={planner.edited} onValid={(valid, value) => onMagnets({ valid, value })} />
      </details>
    </fieldset>
  </>;
}
