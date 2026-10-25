import { ICON } from "../../src/icons.js";
import { el } from "../../src/util.js";

// Keep the editor's icon geometry while inheriting each control's theme and state.
export function iconLabel(element, name, label = element.textContent) {
  const icon = el("span", { class: "ai-pictogram", "aria-hidden": "true", html: ICON[name] });
  const svg = icon.querySelector("svg");
  svg.setAttribute("aria-hidden", "true"); svg.setAttribute("focusable", "false");
  for (const node of svg.querySelectorAll("[stroke],[fill]")) {
    for (const attribute of ["stroke", "fill"]) {
      if (node.hasAttribute(attribute) && node.getAttribute(attribute) !== "none") node.setAttribute(attribute, "currentColor");
    }
  }
  element.classList.add("ai-with-pictogram");
  element.replaceChildren(icon, el("span", { class: "ai-control-label" }, label));
  return element;
}
