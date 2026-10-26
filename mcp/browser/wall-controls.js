import { el } from "../../src/util.js";
import { BIN_SIDES, normalizeOpenSides } from "../shared/gridfinity-walls.js";

export function wallControls({ value = [], closeGaps = false, id = "ai-wall-close-gaps", onChange, onCloseGaps }) {
  let sides = normalizeOpenSides(value);
  const buttons = new Map();
  let disabled = false;
  const flush = el("input", { id, type: "checkbox", checked: closeGaps, "aria-describedby": `${id}-note` });
  const flushNote = el("p", { id: `${id}-note`, class: "ai-template-note" }, "Square ends meet at the grid boundary above the base. Enable on both neighbours. No connector; printed fit needs checking.");
  flush.onchange = () => onCloseGaps?.(flush.checked);
  const choices = el("div", { class: "ai-template-fields ai-wall-choices", role: "group", "aria-label": "Open sides" });
  const paths = { left: "M4 4v16", right: "M20 4v16", front: "M4 20h16", back: "M4 4h16" };
  const node = (name, attributes) => {
    const element = document.createElementNS("http://www.w3.org/2000/svg", name);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
    return element;
  };
  function set(value) {
    sides = normalizeOpenSides(value);
    if (!sides.length) flush.checked = false;
    flush.disabled = disabled || !sides.length;
    for (const [side, button] of buttons) {
      const open = sides.includes(side);
      button.setAttribute("aria-pressed", String(open));
      button.querySelector(".ai-wall-edge").setAttribute("stroke-dasharray", open ? "2 2" : "none");
      button.querySelector("small").textContent = open ? "Open" : "Closed";
    }
  }
  for (const side of BIN_SIDES) {
    const icon = node("svg", { viewBox: "0 0 24 24", "aria-hidden": "true", focusable: "false", class: "ai-wall-icon" });
    icon.append(node("path", { d: BIN_SIDES.filter(name => name !== side).map(name => paths[name]).join(" "), class: "ai-wall-other" }), node("path", { d: paths[side], class: "ai-wall-edge" }));
    const button = el("button", { type: "button", class: "ai-wall-choice", "aria-label": `Open ${side} side`, "aria-pressed": "false" }, icon, el("span", {}, side[0].toUpperCase() + side.slice(1)), el("small", {}));
    button.onclick = () => {
      const next = sides.includes(side) ? sides.filter(name => name !== side) : [...sides, side];
      set(next); onChange([...sides], flush.checked);
    };
    buttons.set(side, button); choices.append(button);
  }
  const element = el("section", { class: "ai-template-group ai-wall-controls" }, el("h4", {}, "Open sides"),
    el("p", { class: "ai-template-note" }, "Open matching sides on neighbouring bins for long items. Each part prints separately. Standard edges retain a small seam."), choices,
    el("label", { class: "ai-template-field", for: id }, flush, el("span", {}, "Close gaps on open sides")), flushNote);
  set(sides);
  return { element, get: () => [...sides], getCloseGaps: () => flush.checked, set, setDisabled: value => { disabled = value; buttons.forEach(button => { button.disabled = value; }); flush.disabled = value || !sides.length; } };
}
