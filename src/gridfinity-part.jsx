import { useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { store } from "./store.js";
import { el } from "./util.js";
import { bodyRole } from "./bodyRoles.js";
import { compileMcpModel } from "../mcp/browser/plans/models.js";
import { createPartPlanner, partFit, partReady, partState, partSummary, templatePlan } from "../mcp/browser/ui/part-planner.js";
import { PartForm, useInvalidMarks } from "../mcp/browser/ui/part-form.jsx";
import { savedPrintArea } from "../mcp/shared/print-area.js";

// A saved parameter model, so Model settings can revise the part later.
function PartDialog({ planner, references, area, onMagnets }) {
  const state = useSyncExternalStore(planner.subscribe, planner.getState);
  const [magnets, setMagnets] = useState({ valid: true, value: false });
  const marks = useInvalidMarks();
  const draft = { ...state.draft, magnets: magnets.value };
  const summary = partSummary(draft, magnets.valid), fit = partFit(draft, magnets.valid, area);
  const error = state.message.error || (!state.message.text && !!fit.error);
  return <div className="ai-controls gp-form">
    <PartForm planner={planner} draft={state.draft} summary={summary} references={references} marks={marks}
      onMagnets={value => { setMagnets(value); onMagnets(value); }} />
    {fit.rotated && <p className="ai-template-note">Turn this part 90° on the print bed to fit your printer area.</p>}
    <p id="gp-message" className="ai-template-message" role="status" aria-live="polite" data-error={error ? "true" : undefined}>{state.message.text || fit.error}</p>
  </div>;
}

export function initGridfinityPart(app, { openCmd, commit, schedulePreview }) {
  // Builds the part into `doc` in place and keeps the editor's mode; returns the new body ids.
  function build(doc, draft, at) {
    const plan = templatePlan(partState(draft));
    plan.operations[0].position = at;
    const mode = doc.mode, compiled = compileMcpModel(doc, plan), out = compiled.document;
    for (const key of Object.keys(doc)) if (!(key in out)) delete doc[key];
    Object.assign(doc, out, { mode });
    return compiled.createdBodyIds;
  }

  function add(spec = {}, at = [0, 0, 0]) {
    const planner = createPartPlanner();
    if (spec.kind) planner.setKind(spec.kind);
    for (const [name, value] of Object.entries(spec.fields || {})) planner.setField(name, String(value));
    let ids;
    store.update(doc => { ids = build(doc, planner.getState().draft, at); }, "Add Gridfinity part");
    return ids;
  }

  function cmd() {
    const planner = createPartPlanner({ notify: flushSync });
    const t = app.vp.view.target, g = 10, area = savedPrintArea(globalThis.localStorage);
    const st = { at: [Math.round(t.x / g) * g, Math.round(t.y / g) * g, 0], magnets: { valid: true, value: false }, ids: [], draft: planner.getState().draft, root: null };
    const references = store.view.bodies.filter(body => bodyRole(body) === "reference" && !body.hidden).flatMap(body => {
      const box = app.scene.bodyWorldBox(body.id);
      return box ? [{ id: body.id, name: body.name, dimensions: { x: box.max.x - box.min.x, y: box.max.y - box.min.y, z: box.max.z - box.min.z } }] : [];
    });
    const failed = () => planner.getState().message.error;
    const def = {
      title: "Gridfinity part",
      okLabel: "Create",
      wide: true,
      valid: () => partReady(planner.getState().draft, st.magnets.valid),
      canOk: () => def.valid() && !failed() && !partFit({ ...planner.getState().draft, magnets: st.magnets.value }, st.magnets.valid, area).error,
      apply(doc) {
        try { st.ids = build(doc, planner.getState().draft, st.at); }
        catch (error) { if (!app.previewing) throw error; planner.showError(error); throw error; }
        if (failed()) planner.edited();
      },
      ok() {
        commit(def, "Add Gridfinity part");
        if (!app.command) app.select(st.ids);
      },
      hint: () => "A native Gridfinity bin, insert or baseplate. Afterwards, Model settings changes its size and pockets.",
      build(body) {
        st.root?.unmount();
        const mount = el("div", { class: "ai-template-form" });
        body.append(mount);
        st.root = createRoot(mount);
        flushSync(() => st.root.render(<PartDialog planner={planner} references={references} area={area} onMagnets={value => { st.magnets = value; schedulePreview(def); }} />));
      },
      cleanup() { unsubscribe(); st.root?.unmount(); st.root = null; },
    };
    // Messages also notify; only a changed draft needs a new preview.
    const unsubscribe = planner.subscribe(() => {
      const { draft } = planner.getState();
      if (draft === st.draft) { def.refreshOk?.(); return; }
      st.draft = draft; schedulePreview(def);
    });
    openCmd(def);
    schedulePreview(def);
  }

  return { cmd, add };
}
