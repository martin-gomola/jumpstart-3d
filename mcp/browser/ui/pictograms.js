import { ICON } from "../../../src/icons.js";
import { el } from "../../../src/util.js";

const svgCache = new Map();
// Keep the editor's icon geometry while inheriting each control's theme and state.
export function pictogramSvg(name) {
  if (!svgCache.has(name)) svgCache.set(name, ICON[name]
    .replace(/\s(stroke|fill)="(?!none")[^"]*"/g, ' $1="currentColor"')
    .replace("<svg", '<svg aria-hidden="true" focusable="false"'));
  return svgCache.get(name);
}

export function iconLabel(element, name, label = element.textContent) {
  element.classList.add("ai-with-pictogram");
  element.replaceChildren(el("span", { class: "ai-pictogram", "aria-hidden": "true", html: pictogramSvg(name) }), el("span", { class: "ai-control-label" }, label));
  return element;
}
