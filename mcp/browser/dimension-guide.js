import { el } from "../../src/util.js";

// A live sizing sketch is deliberately separate from the inspected native preview.
export function dimensionGuide({ title, note }) {
  const node = (name, attributes = {}, text) => {
    const element = document.createElementNS("http://www.w3.org/2000/svg", name);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
    if (text) element.textContent = text;
    return element;
  };
  const svg = node("svg", { viewBox: "0 0 520 340", role: "img", "aria-label": title });
  const drawing = node("g"), labels = node("g", { class: "ai-guide-labels" });
  svg.append(drawing, labels);
  const heading = el("h3", {}, title), caption = el("p", { class: "ai-template-note" }, note);
  const element = el("section", { class: "ai-dimension-guide", "aria-label": title }, heading, svg, caption);
  function update({ width, depth, height, kind = "bin", columns = 0, rows = 0 }) {
    const supplied = [width, depth, height].every(n => Number.isFinite(n) && n > 0);
    const scale = Math.max(width || 1, depth || 1, (height || 1) * 2);
    const w = supplied ? 140 * width / scale : 140, d = supplied ? 140 * depth / scale : 110;
    const h = supplied ? Math.max(6, 140 * height / scale) : 64;
    const a = [260, 65], b = [260 + w, 65 + w / 2], c = [260 + w - d, 65 + (w + d) / 2], e = [260 - d, 65 + d / 2];
    const down = p => [p[0], p[1] + h];
    const points = list => list.map(p => p.join(",")).join(" ");
    drawing.replaceChildren(
      node("polygon", { points: points([e, c, down(c), down(e)]), class: "ai-guide-face" }),
      node("polygon", { points: points([c, b, down(b), down(c)]), class: "ai-guide-side" }),
      node("polygon", { points: points([a, b, c, e]), class: "ai-guide-top" }),
    );
    if (kind === "bin" || kind === "drawer") {
      const center = [260 + (w - d) / 2, 65 + (w + d) / 4];
      drawing.append(node("polygon", { points: points([a, b, c, e].map(p => p.map((value, axis) => center[axis] + (value - center[axis]) * .84))), class: "ai-guide-opening" }));
    }
    if (kind === "baseplate" && columns > 0 && rows > 0) {
      for (let i = 1; i < columns; i++) drawing.append(node("line", { x1: a[0] + w * i / columns, y1: a[1] + w / 2 * i / columns, x2: e[0] + w * i / columns, y2: e[1] + w / 2 * i / columns, class: "ai-guide-grid" }));
      for (let i = 1; i < rows; i++) drawing.append(node("line", { x1: a[0] - d * i / rows, y1: a[1] + d / 2 * i / rows, x2: b[0] - d * i / rows, y2: b[1] + d / 2 * i / rows, class: "ai-guide-grid" }));
    }
    const format = n => new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(n);
    const widthText = supplied ? `${format(width)} mm wide` : kind === "drawer" ? "Inside width" : "Width", depthText = supplied ? `${format(depth)} mm deep` : kind === "drawer" ? "Inside depth" : "Depth", heightText = supplied ? `${format(height)} mm tall` : kind === "drawer" ? "Usable height" : "Height";
    labels.replaceChildren(node("text", { x: 150, y: 290, "text-anchor": "middle" }, widthText), node("text", { x: 365, y: 290, "text-anchor": "middle" }, depthText), node("text", { x: 260, y: 325, "text-anchor": "middle" }, heightText));
    svg.setAttribute("aria-label", `${title}: ${widthText}, ${depthText}, ${heightText}`);
  }
  update({});
  return { element, update, caption, heading };
}
