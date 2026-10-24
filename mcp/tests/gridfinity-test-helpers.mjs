import { findRegions, resolveSketch } from "../../src/regions.js";

// Resolve only the native nodes emitted by the Gridfinity fixture. Runtime
// document resolution is independently exercised when the browser loads it.
export function resolveGridfinityFixture(node, document) {
  const result = structuredClone(node);
  const profile = id => {
    const sketch = document.sketches.find(entry => entry.id === id);
    return { plane: sketch.plane, region: findRegions(resolveSketch(sketch))[0] };
  };
  if (node.t === "loft") result.sections = node.sections.map(section => profile(section.sketch));
  if (node.t === "extrude") {
    const { plane, region } = profile(node.sketch);
    result.plane = plane; result.regions = [region];
  }
  if (node.children) result.children = node.children.map(child => ({ ...child, node: resolveGridfinityFixture(child.node, document) }));
  result.mods = (node.mods || []).map(mod => ({ ...mod, ...(mod.tool ? { tool: resolveGridfinityFixture(mod.tool, document) } : {}) }));
  return result;
}
