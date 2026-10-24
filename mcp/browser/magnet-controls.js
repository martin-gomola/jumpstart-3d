import { el } from "../../src/util.js";
import { DEFAULT_MAGNET_POCKETS } from "../shared/gridfinity-magnets.js";

export function magnetControls({ id, label = "Magnet pockets", onChange, onInput = () => {} }) {
  let disabled = false;
  const enabled = el("input", { id, type: "checkbox" });
  const diameter = el("input", { id: `${id}-diameter`, type: "number", min: 2, max: 8, step: "any", value: DEFAULT_MAGNET_POCKETS.diameter, required: true });
  const depth = el("input", { id: `${id}-depth`, type: "number", min: 0.5, max: 4, step: "any", value: DEFAULT_MAGNET_POCKETS.depth, required: true });
  const note = el("p", { class: "ai-template-note", id: `${id}-note` }, "Defaults allow glue clearance for nominal 6 × 2 mm magnets. Adjust pocket sizes for your magnets and printer.");
  for (const input of [diameter, depth]) input.setAttribute("aria-describedby", note.id);
  const fields = el("div", { class: "ai-template-group", hidden: true }, el("div", { class: "ai-template-fields" },
    el("label", { class: "ai-template-field", for: diameter.id }, el("span", {}, "Pocket diameter (mm)"), diameter),
    el("label", { class: "ai-template-field", for: depth.id }, el("span", {}, "Pocket depth (mm)"), depth)), note);
  const element = el("div", { class: "ai-template-group" }, el("label", { class: "ai-template-field", for: id }, enabled, el("span", {}, label)), fields);
  const sync = () => { fields.hidden = !enabled.checked; enabled.disabled = disabled; for (const input of [diameter, depth]) input.disabled = disabled || !enabled.checked; };
  const get = () => enabled.checked ? { diameter: Number(diameter.value), depth: Number(depth.value) } : false;
  enabled.onchange = () => { sync(); onChange(get()); };
  for (const input of [diameter, depth]) {
    input.oninput = onInput;
    input.onchange = () => { input.setAttribute("aria-invalid", String(!input.validity.valid)); onChange(get()); };
  }
  sync();
  return { element, get, valid: () => !enabled.checked || diameter.validity.valid && depth.validity.valid,
    set(value) {
      enabled.checked = !!value;
      if (value) { const config = value === true ? DEFAULT_MAGNET_POCKETS : value; diameter.value = config.diameter ?? DEFAULT_MAGNET_POCKETS.diameter; depth.value = config.depth ?? DEFAULT_MAGNET_POCKETS.depth; }
      for (const input of [diameter, depth]) input.removeAttribute("aria-invalid");
      sync();
    }, setDisabled(value) { disabled = value; sync(); } };
}
