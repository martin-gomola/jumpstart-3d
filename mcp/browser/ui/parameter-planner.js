// Draft controller for a saved parameter model under the editor selection. No DOM access.
const UNITS = { mm: "mm", deg: "°", count: "", scalar: "" };

export function parameterLabel(name) {
  const words = name.replace(/_/g, " ").replace(/([a-z0-9])([A-Z])/g, "$1 $2").trim().split(/\s+/);
  return words.map((word, i) => (i ? word.toLowerCase() : word[0].toUpperCase() + word.slice(1))).join(" ");
}

// Independent parameters are editable; derived ones (expressions) are shown read-only.
export function parameterFields(model) {
  return Object.entries(model.parameters || {}).map(([name, p]) => ({
    name, label: parameterLabel(name), unit: UNITS[p.unit] ?? "", value: p.value, derived: typeof p.expression === "string",
    limits: { min: p.min, max: p.max, step: p.unit === "count" ? 1 : "any" }, integer: p.unit === "count",
  }));
}

export function parameterError(field, text) {
  const value = Number(text);
  if (text.trim() === "" || !Number.isFinite(value)) return `${field.label} needs a number.`;
  if (field.integer && !Number.isInteger(value)) return `${field.label} must be a whole number.`;
  if (field.limits.min !== undefined && value < field.limits.min || field.limits.max !== undefined && value > field.limits.max)
    return `${field.label} must be between ${field.limits.min ?? "−∞"} and ${field.limits.max ?? "∞"}${field.unit ? " " + field.unit : ""}.`;
  return null;
}

// The single saved model that owns every selected body, if any.
export function selectedModel(models, bodyIds) {
  if (!bodyIds.length) return null;
  const owners = models.filter((model) => bodyIds.some((id) => model.bodyIds.includes(id)));
  return owners.length === 1 && bodyIds.every((id) => owners[0].bodyIds.includes(id)) ? owners[0] : null;
}

const EMPTY = { model: null, fields: [], texts: {}, preview: null, message: null };

export function createParameterPlanner({ request, notify = (fn) => fn(), delay = 150 }) {
  const listeners = new Set();
  let state = { ...EMPTY, busy: false };
  let selection = [], loadSeq = 0, timer = null;
  const emit = () => notify(() => { for (const fn of listeners) fn(); });
  const put = (patch) => { state = { ...state, ...patch }; emit(); };

  const errors = () => Object.fromEntries(state.fields.filter((f) => !f.derived).map((f) => [f.name, parameterError(f, state.texts[f.name] ?? "")]).filter(([, e]) => e));
  function changedValues() {
    const values = {};
    for (const field of state.fields) {
      const value = Number(state.texts[field.name]);
      if (!field.derived && value !== field.value) values[field.name] = value;
    }
    return values;
  }
  async function load() {
    clearTimeout(timer);
    const seq = ++loadSeq;
    if (!selection.length) { put(EMPTY); return; }
    try {
      const summary = await request("get_document", { bodyIds: selection, includeSketches: false });
      if (seq !== loadSeq) return;
      const model = selectedModel(summary.parametricModels || [], selection);
      if (!model) { put(EMPTY); return; }
      const fields = parameterFields(model);
      const editedOutside = model.editedOutside === true;
      const same = state.model?.id === model.id && state.model.editedOutside === editedOutside && JSON.stringify(state.model.parameters) === JSON.stringify(model.parameters);
      put({ model: { id: model.id, name: model.template?.name || "Generated model", parameters: model.parameters, editedOutside },
        fields, ...(same ? {} : { texts: Object.fromEntries(fields.map((f) => [f.name, String(f.value)])), preview: null, message: null }) });
    } catch {
      if (seq === loadSeq) put(EMPTY);
    }
  }
  const reload = () => { clearTimeout(timer); timer = setTimeout(() => void load(), delay); };

  return {
    getState: () => state,
    subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    errors,
    hasChanges: () => Object.keys(changedValues()).length > 0,
    select(bodyIds) {
      const next = [...bodyIds].sort();
      if (JSON.stringify(next) === JSON.stringify(selection)) return;
      selection = next;
      void load();
    },
    documentChanged(kind) {
      if (kind !== "preview" && !state.busy && selection.length) reload();
    },
    setText(name, text) { put({ texts: { ...state.texts, [name]: text }, preview: null, message: null }); },
    reset() { put({ texts: Object.fromEntries(state.fields.map((f) => [f.name, String(f.value)])), preview: null, message: null }); },
    async preview() {
      if (state.busy || !state.model || state.model.editedOutside) return;
      const invalid = Object.values(errors());
      if (invalid.length) { put({ message: { text: invalid[0], error: true } }); return; }
      put({ busy: true, preview: null, message: { text: "Building preview…", error: false } });
      try {
        const before = await request("get_document", { bodyIds: selection, includeSketches: false });
        const result = await request("preview_parameters", { modelId: state.model.id, values: changedValues(), expectedRevision: before.revision, includeImage: false });
        if (!result.valid) throw new Error(result.errors?.map((entry) => entry.error).join(". ") || "The new settings do not build a valid model.");
        put({ preview: { previewId: result.previewId, dimensions: result.bodies?.[0]?.dimensions || null }, message: { text: "Preview ready. Nothing changes until you apply.", error: false } });
      } catch (error) {
        put({ message: { text: error.message || String(error), error: true } });
      } finally { put({ busy: false }); }
    },
    async apply() {
      if (state.busy || !state.preview) return;
      put({ busy: true });
      let message;
      try {
        await request("apply_model", { previewId: state.preview.previewId });
        message = { text: "Updated. Use Undo to go back.", error: false };
      } catch (error) {
        message = { text: error.message || String(error), error: true };
      }
      state = { ...state, busy: false, preview: null };
      await load();
      put({ message });
    },
  };
}
