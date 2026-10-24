// Roles describe manufacturing intent, independently of visibility and geometry.
export const BODY_ROLES = Object.freeze(["design", "reference", "hardware"]);

export function bodyRole(body) {
  const role = body.role === undefined ? "design" : body.role;
  if (!BODY_ROLES.includes(role)) throw new Error(`Unsupported body role: ${String(role)}`);
  return role;
}

// Conservatively classify joined geometry; cutters do not become output material.
export function combinedRole(bodies, operation) {
  if (operation === "cut") return bodies[0].role;
  if (!bodies.some(body => body.role !== undefined)) return undefined;
  const roles = bodies.filter(body => !body.hole).map(bodyRole);
  return roles.includes("reference") ? "reference" : roles.includes("hardware") ? "hardware" : "design";
}

export function selectExportBodies(bodies, { scope = "printable", bodyIds } = {}) {
  if (!["printable", "assembly"].includes(scope)) throw new Error("Export scope must be printable or assembly");
  const eligible = body => !body.hidden && !body.hole && !body.cutPreview &&
    (bodyRole(body) === "design" || scope === "assembly" && bodyRole(body) === "hardware");
  if (bodyIds !== undefined) {
    if (!Array.isArray(bodyIds) || !bodyIds.length || bodyIds.length > 128 || bodyIds.some(id => typeof id !== "string" || !id) || new Set(bodyIds).size !== bodyIds.length) {
      throw new Error("Export bodyIds must contain 1 to 128 unique body ids");
    }
    return bodyIds.map(id => {
      const body = bodies.find(body => body.id === id);
      if (!body) throw new Error(`Unknown export body: ${id}`);
      if (!eligible(body)) throw new Error(`Body ${id} is not eligible for ${scope} export; check its role, visibility and hole state`);
      return body;
    });
  }
  return bodies.filter(eligible);
}
