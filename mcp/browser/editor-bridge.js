import { featureEditContext, compileFeatureEdit } from "./feature-edit.js";
import { inspectProtectedRegions } from "./inspection/region-inspection.js";
import { validateRegionBox } from "../shared/edit-contracts.js";
import { inspectNativePairs } from "./inspection/pair-inspection.js";
import { bodyRole, selectExportBodies } from "../../src/bodyRoles.js";
import { evaluatePairChecks, validatePairThresholds } from "../shared/pairs.js";
import { validateRequirements, evaluateRequirements, comparePreviewBodies } from "./inspection/preview-requirements.js";
import { compileFramePlan } from "./plans/frame-plan.js";
import { store, resolveNode, newDoc } from "../../src/store.js";
import { applyFeaturePatterns, resizeBodyDocument } from "./plans/model-plan.js";
import { getUnit } from "../../src/units.js";
import { clone } from "../../src/util.js";
import { compileMcpModel, mcpModelEdited, refreshMcpModelBodyState, reviseMcpParameters } from "./plans/models.js";
import { inspectGeometry } from "./inspection/inspection.js";
import { selectGeometry } from "../shared/geometry.js";
import { initAgentStatus, initAiSetupPanel, STATUS_HOLD_MS } from "./ui/ai-status.js";
import { initTemplatePanel } from "./ui/template-panel.jsx";
import { initParameterCard } from "./ui/parameter-card.jsx";
import { previewViewer } from "./preview-viewer.js";
import { checkPrintFit } from "../shared/print-area.js";
import { composeDrawing, drawingCameras, drawingPDF, drawingSVG, normalizeDrawing } from "../shared/drawing-sheet.js";
import { summarizeDrawerLayouts } from "./plans/drawer-layout.js";

import { createNativeParametricModel, reviseNativeParameters } from "./native-parameters.js";
import { compileLathePlan } from "./plans/lathe-plan.js";
import { buildHolePattern } from "./plans/hole-pattern.js";
import { fitPreviewCamera } from "./preview-camera.js";
import { tutorialSession } from "./tutorial-session.js";
import { fromB64, isZip, packMesh, readMeshFile, simplify, toB64, MESH_LIMIT } from "../../src/meshimport.js";

const BRIDGE = "/__mcp";
const HEARTBEAT_MS = 5_000;
const BUILD_TIMEOUT_MS = 24_000;
const MAX_EXPORT_BYTES = 32 * 1024 * 1024;
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function id() {
  return globalThis.crypto?.randomUUID?.() ?? `js3d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function fingerprint(doc) {
  const value = JSON.stringify(doc);
  let first = 0x811c9dc5, second = 0x9e3779b9;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ (code + i), 0x85ebca6b);
  }
  return `${value.length}-${(first >>> 0).toString(16)}-${(second >>> 0).toString(16)}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function base64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function bodyInfo(body, app, includeGeometry = false, options = {}) {
  const view = app.scene.views.get(body.id);
  const box = app.scene.bodyWorldBox(body.id);
  const localBox = view?.data?.kbbox || view?.data?.bbox;
  const size = box ? { x: box.max.x - box.min.x, y: box.max.y - box.min.y, z: box.max.z - box.min.z } : null;
  const localSize = localBox ? { x: localBox.max[0] - localBox.min[0], y: localBox.max[1] - localBox.min[1], z: localBox.max[2] - localBox.min[2] } : null;
  const result = {
    id: body.id,
    name: body.name,
    role: bodyRole(body),
    ...(body.mcpDrawerLayout ? { drawerLayout: { layoutId: body.mcpDrawerLayout.layoutId, partId: body.mcpDrawerLayout.partId } } : {}),
    ...(body.mcpGridfinity ? { gridfinity: Object.fromEntries(Object.entries(clone(body.mcpGridfinity)).filter(([key]) => !["nodeSignature", "sketchSignatures"].includes(key))) } : {}),
    ...(body.mcpDrawerSpacer ? { drawerSpacer: Object.fromEntries(Object.entries(clone(body.mcpDrawerSpacer)).filter(([key]) => key !== "sketchSignatures")) } : {}),
    ...(body.mcpBaseplateClip ? { baseplateClip: Object.fromEntries(Object.entries(clone(body.mcpBaseplateClip)).filter(([key]) => key !== "sketchSignatures")) } : {}),
    ...(body.mcpPrintFit ? { printFit: (() => {
      if (!size || view?.pending || !body.mcpDrawerLayout?.definition?.printArea) return { configured: true, status: "unknown", source: "current bounds" };
      try { return { ...checkPrintFit(body.mcpDrawerLayout.definition.printArea, size.x, size.y, size.z, body.name), status: "passed", source: "current bounds" }; }
      catch (error) { return { configured: true, status: "failed", error: error.message, source: "current bounds" }; }
    })() } : {}),
    ...(body.mcpPockets ? { pockets: clone(body.mcpPockets) } : {}),
    feature: body.node?.t ?? "unknown",
    ...(includeGeometry ? {placementMatrix:body.m.slice(),geometryFingerprint:fingerprint({node:resolveNode(body.node,store.view),matrix:body.m}),geometryState:view?.pending?"building":app.scene.errors.has(body.id)?"failed":view?.data?"ready":"missing"} : {}),
    ...(includeGeometry ? { editing: featureEditContext(store.view,body) } : {}),
    ...(body.turned ? { turned: clone(body.turned) } : {}),
    ...(body.mcpLathe ? { latheRecipe: clone(body.mcpLathe.plan), latheSampling: clone(body.mcpLathe.sampling) } : {}),
    ...(body.mcpPhoneCradle ? { phoneCradle: clone(body.mcpPhoneCradle) } : {}),
    hidden: !!body.hidden,
    locked: !!body.locked,
    error: app.scene.errors.get(body.id) ?? null,
    dimensions: size ? { x: size.x, y: size.y, z: size.z } : null,
    bounds: box ? {
      min: [box.min.x, box.min.y, box.min.z],
      max: [box.max.x, box.max.y, box.max.z],
      center: [(box.min.x + box.max.x) / 2, (box.min.y + box.max.y) / 2, (box.min.z + box.max.z) / 2],
    } : null,
    localDimensions: localSize,
    volume: view?.data?.volume ?? null,
    triangleCount: view?.data?.triangles?.length ? view.data.triangles.length / 3 : null,
  };
  if (includeGeometry && options.includeFeatureTree !== false) result.featureTree = featureTree(body.node);
  else result.modifierCount = body.node?.mods?.length ?? 0;
  if (includeGeometry && options.includeSelectors !== false) {
    const edges = view?.data?.edgeInfo || [];
    const faces = view?.data?.faceInfo || [];
    result.geometrySelectors = {
      edges: edges.slice(0, 512).map((edge, index) => ({ index, ...clone(edge) })),
      faces: faces.slice(0, 512).map((face, index) => ({ index, ...clone(face) })),
      truncated: edges.length > 512 || faces.length > 512,
      fingerprint: fingerprint({ node: resolveNode(body.node, store.view), matrix: body.m }),
    };
  }
  return result;
}

function featureTree(value, depth = 0) {
  if (depth > 16) return { truncated: true };
  if (Array.isArray(value)) return value.length > 2048 ? [...value.slice(0, 2048).map((item) => featureTree(item, depth + 1)), { truncated: true }] : value.map((item) => featureTree(item, depth + 1));
  if (!value || typeof value !== "object") return typeof value === "string" ? value.slice(0, 2000) : value;
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    if (["assetData", "positions", "vertices", "triangles", "normals", "bytes", "data"].includes(key)) continue;
    out[key] = featureTree(child, depth + 1);
  }
  return out;
}

function referencedSketchIds(body, document, visited = new Set(), ids = new Set()) {
  if (!body || visited.has(body.id)) return ids;
  visited.add(body.id);
  JSON.stringify(body.node, (key, value) => {
    if (key === "sketch" && typeof value === "string") ids.add(value);
    if (key === "srcBody" && typeof value === "string") referencedSketchIds(document.bodies.find((entry) => entry.id === value), document, visited, ids);
    return value;
  });
  return ids;
}

function documentSummary(app, editorId, revision, includeGeometry = false, options = {}) {
  const doc = store.doc;
  const wanted = options.bodyIds ? new Set(options.bodyIds) : null;
  if (wanted && (wanted.size !== options.bodyIds.length || [...wanted].some((id) => !doc.bodies.some((body) => body.id === id)))) throw new Error("bodyIds must contain unique existing body ids");
  const bodies = doc.bodies.filter((body) => !body.cutPreview && (!wanted || wanted.has(body.id)));
  const sketchIds = new Set();
  if (wanted) for (const body of bodies) for (const id of referencedSketchIds(body, doc)) sketchIds.add(id);
  return {
    editorId,
    revision,
    document: { id: doc.id, name: doc.name, mode: doc.mode ?? app.mode },
    units: "mm", displayUnits: getUnit(),
    selectedBodyIds: (app.sel || []).filter((id) => doc.bodies.some((body) => body.id === id && !body.cutPreview)),
    nativeParameters: (doc.params || []).slice(0, 256).map((parameter) => ({
      id: String(parameter.id || "").slice(0, 120), name: String(parameter.name || "").slice(0, 120),
      expression: String(parameter.expr || "").slice(0, 2000), unit: String(parameter.unit || "mm").slice(0, 30),
      value: Number.isFinite(parameter.value) ? parameter.value : null,
    })),
    nativeParametersTruncated: (doc.params?.length || 0) > 256,
    viewport: { target: app.vp.view.target.toArray(), azimuth: app.vp.view.az, elevation: app.vp.view.el, distance: app.vp.view.dist, roll: app.vp.view.roll || 0, orthographic: app.vp.useOrtho, section: clone(app.section?.info || null) },
    sketches: (options.includeSketches === false ? [] : (doc.sketches || []).filter((sketch) => !wanted || sketchIds.has(sketch.id))).map((sketch) => ({
      id: sketch.id,
      name: sketch.name,
      plane: clone(sketch.plane),
      pointCount: sketch.pts?.length ?? 0,
      entityCount: sketch.ents?.length ?? 0,
      hidden: !!sketch.hidden,
      ...(includeGeometry ? { points: sketch.pts?.slice(0, 512) ?? [], entities: sketch.ents?.slice(0, 512) ?? [], constraints: featureTree(sketch.cons?.slice(0, 512) || []), truncated: (sketch.pts?.length ?? 0) > 512 || (sketch.ents?.length ?? 0) > 512 || (sketch.cons?.length ?? 0) > 512 } : {}),
    })),
    planes: (doc.planes || []).map((plane) => ({ id: plane.id, name: plane.name, kind: plane.kind, plane: clone(plane.plane), hidden: !!plane.hidden })),
    bodies: bodies.map((body) => bodyInfo(body, app, includeGeometry, options)),
    drawerLayouts: summarizeDrawerLayouts(doc).filter(layout => !wanted || layout.bodyIds.some(id => wanted.has(id))),
    ...(wanted ? { selection: { bodyIds: [...wanted], totalBodies: doc.bodies.filter((body) => !body.cutPreview).length, returnedBodies: bodies.length } } : {}),
    parametricModels: (doc.mcpModels || []).filter((model) => !wanted || model.bodyIds.some((id) => wanted.has(id))).map(({ bodyState, sketchState, planeState, ...model }) => ({ ...clone(model), editedOutside: mcpModelEdited(doc, { bodyState, sketchState, planeState, ...model }), sourceState: "saved parameter template; native edits are checked before regeneration" })),
  };
}

function buildStl(app, bodies) {
  const items = bodies
    .map((body) => ({ body, view: app.scene.views.get(body.id) }))
    .filter(({ view }) => view?.data?.triangles?.length);
  const triangleCount = items.reduce((total, { view }) => total + view.data.triangles.length / 3, 0);
  if (!triangleCount) throw new Error("No built solid bodies are available to export");
  const byteLength = 84 + triangleCount * 50;
  if (byteLength > MAX_EXPORT_BYTES) throw new Error(`STL export exceeds the ${MAX_EXPORT_BYTES} byte local export limit`);
  const buffer = new ArrayBuffer(byteLength);
  const dv = new DataView(buffer);
  const header = "JumpStart 3D MCP export (mm)";
  for (let i = 0; i < header.length; i++) dv.setUint8(i, header.charCodeAt(i));
  dv.setUint32(80, triangleCount, true);
  let offset = 84;
  let writtenTriangles = 0;
  const bodyTriangles = [];
  for (const { body, view } of items) {
    const bodyStart = writtenTriangles;
    const { vertices: P, triangles: T } = view.data;
    const M = view.group.matrix.elements;
    const determinant = M[0] * (M[5] * M[10] - M[9] * M[6]) - M[4] * (M[1] * M[10] - M[9] * M[2]) + M[8] * (M[1] * M[6] - M[5] * M[2]);
    const point = (index) => {
      const x = P[index * 3], y = P[index * 3 + 1], z = P[index * 3 + 2];
      return [M[0] * x + M[4] * y + M[8] * z + M[12], M[1] * x + M[5] * y + M[9] * z + M[13], M[2] * x + M[6] * y + M[10] * z + M[14]];
    };
    for (let i = 0; i < T.length; i += 3) {
      const a = point(T[i]);
      let b = point(T[i + 1]);
      let c = point(T[i + 2]);
      if (determinant < 0) [b, c] = [c, b];
      const u = b.map((v, j) => v - a[j]);
      const v = c.map((q, j) => q - a[j]);
      let normal = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const length = Math.hypot(...normal);
      if (!Number.isFinite(length)) throw new Error("Cannot export non-finite triangle geometry");
      if (length <= 1e-12) continue;
      normal = normal.map((q) => q / length);
      for (const q of [...normal, ...a, ...b, ...c]) { dv.setFloat32(offset, q, true); offset += 4; }
      dv.setUint16(offset, 0, true);
      offset += 2;
      writtenTriangles++;
    }
    bodyTriangles.push({ id: body.id, triangles: writtenTriangles - bodyStart });
  }
  if (!writtenTriangles) throw new Error("No non-degenerate triangles are available to export");
  dv.setUint32(80, writtenTriangles, true);
  return { bytes: new Uint8Array(buffer, 0, offset), bodyTriangles };
}

function readyBodies(app, bodyIds) {
  const document = store.view;
  const results = bodyIds.map((bodyId) => {
    const body = document.bodies.find((entry) => entry.id === bodyId);
    if (!body) return { id: bodyId, error: "Body no longer exists" };
    const error = app.scene.errors.get(bodyId);
    const view = app.scene.views.get(bodyId);
    if (error) return { id: bodyId, error };
    if (!view?.data || view.pending) return { id: bodyId, pending: true };
    return { id: bodyId, body, view };
  });
  return results;
}

function imageDataUrl(app, box, coordinateFrame = {}) {
  app.vp.render();
  const source = app.vp.renderer.domElement;
  if (!source.width || !source.height || app.vp.renderer.getContext().isContextLost()) throw new Error("Viewport is unavailable or its WebGL context is lost");
  let sx = 0, sy = 0, sw = source.width, sh = source.height;
  if (box && !box.isEmpty()) {
    const projected = [];
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) projected.push(app.vp.project(box.min.clone().set(x, y, z)));
    const ratioX = source.width / app.vp.w, ratioY = source.height / app.vp.h;
    const minX = Math.min(...projected.map((p) => p[0])) * ratioX, maxX = Math.max(...projected.map((p) => p[0])) * ratioX;
    const minY = Math.min(...projected.map((p) => p[1])) * ratioY, maxY = Math.max(...projected.map((p) => p[1])) * ratioY;
    const padding = Math.max(16, (maxX - minX) * 0.06, (maxY - minY) * 0.06);
    sx = Math.max(0, Math.floor(minX - padding)); sy = Math.max(0, Math.floor(minY - padding));
    sw = Math.max(1, Math.min(source.width - sx, Math.ceil(maxX + padding) - sx));
    sh = Math.max(1, Math.min(source.height - sy, Math.ceil(maxY + padding) - sy));
  }
  const scale = Math.min(1, 1024 / sw, 1024 / sh);
  const canvas = document.createElement("canvas");
  const imageWidth = Math.max(1, Math.round(sw * scale));
  const imageHeight = Math.max(1, Math.round(sh * scale));
  const footerHeight = Math.max(48, Math.round(imageWidth * 0.08));
  canvas.width = imageWidth;
  canvas.height = imageHeight + footerHeight;
  const context = canvas.getContext("2d");
  context.drawImage(source, sx, sy, sw, sh, 0, 0, imageWidth, imageHeight);
  const center = box.getCenter(box.min.clone());
  const axisLength = Math.max(...box.getSize(box.min.clone()).toArray()) * 0.18;
  const ratioX = source.width / app.vp.w, ratioY = source.height / app.vp.h;
  const project = (point) => {
    const value = app.vp.project(point);
    return [(value[0] * ratioX - sx) * scale, (value[1] * ratioY - sy) * scale];
  };
  const unit = Math.max(canvas.width / 34, 14), fontSize = Math.max(canvas.width / 80, 10);
  const theme = getComputedStyle(document.documentElement);
  const accent = theme.getPropertyValue("--accent").trim() || "CanvasText";
  const panel = theme.getPropertyValue("--glass").trim() || "Canvas";
  const ink = theme.getPropertyValue("--ink").trim() || "CanvasText";
  const footerY = imageHeight;
  const origin = project(center), anchor = [unit * 1.2, footerY + footerHeight / 2];
  context.fillStyle = panel;
  context.fillRect(0, footerY, canvas.width, footerHeight);
  const axes = [
    { label: "X", point: center.clone().set(center.x + axisLength, center.y, center.z) },
    { label: "Y", point: center.clone().set(center.x, center.y + axisLength, center.z) },
    { label: "Z", point: center.clone().set(center.x, center.y, center.z + axisLength) },
  ];
  for (const axis of axes) {
    const end = project(axis.point), dx = end[0] - origin[0], dy = end[1] - origin[1], length = Math.hypot(dx, dy);
    const ux = length > 0.001 ? dx / length : 0, uy = length > 0.001 ? dy / length : -1;
    const x1 = anchor[0] + ux * unit, y1 = anchor[1] + uy * unit;
    context.strokeStyle = accent; context.fillStyle = accent; context.lineWidth = unit * 0.1;
    context.beginPath(); context.moveTo(anchor[0], anchor[1]); context.lineTo(x1, y1); context.stroke();
    context.beginPath(); context.arc(length > 0.001 ? x1 : anchor[0], length > 0.001 ? y1 : anchor[1], unit * 0.12, 0, Math.PI * 2); context.fill();
    context.font = `600 ${fontSize}px sans-serif`; context.fillText(axis.label, x1 + unit * 0.16, y1 - unit * 0.1);
  }
  context.fillStyle = ink; context.font = `${fontSize}px sans-serif`;
  const textX = unit * 3.4, firstLine = footerY + fontSize * 1.25;
  context.fillText(coordinateFrame.description || "World axes", textX, firstLine);
  context.fillText(coordinateFrame.orientation || "+X / +Y / +Z", textX, firstLine + fontSize * 1.35);
  if (coordinateFrame.screen) context.fillText(coordinateFrame.screen, textX, firstLine + fontSize * 2.7);
  return canvas.toDataURL("image/jpeg", 0.78);
}

function previewImages(app, box, section, coordinateFrame = { description: "World axes", orientation: "+X / +Y / +Z" }, bodyIds, detail, phase) {
  const vp = app.vp;
  const visibleBodies = new Set(bodyIds);
  const visibility = new Map([...app.scene.views.values()].map(view => [view.group, view.group.visible]));
  const saved = { view: { ...vp.view, target: vp.view.target.clone() }, ortho: vp.useOrtho, anim: vp.anim, grid: vp.grid.visible, overlay: vp.overlay.visible, section: clone(app.section?.info || null), time: performance.now() };
  const images = [], imageErrors = [];
  try {
    vp.anim = null; vp.useOrtho = true; vp.grid.visible = false; vp.overlay.visible = false;
    app.section?.clear();
    // Frame and render the same proposal, excluding existing overlapping parts.
    for (const [id, view] of app.scene.views) view.group.visible &&= visibleBodies.has(id);
    // Selection tint hides same-normal channel floors in orthographic previews.
    for (const body of store.view.bodies) {
      const view = app.scene.views.get(body.id);
      if (view?.mesh) { view.applyStyle(body, { ...app.scene.styleFor(body), selected: false, hovered: false, tool: false, edgesStrong: true }); view.setFaceStates(new Map()); }
    }
    const views = detail ? [["isometric","home"],["detail","home"]] : [ ["top", "top"], ["side", "front"], ["isometric", "home"] ];
    if (section) views.push(["section", section.axis === "X" ? "right" : section.axis === "Y" ? "front" : "top"]);
    for (const [name, view] of views) {
      try {
        const frameBox = name === "detail" ? box.clone().set(box.min.clone().fromArray(detail.min),box.max.clone().fromArray(detail.max)) : box;
        vp.setView(view, frameBox);
        Object.assign(vp.view, vp.anim.to); vp.anim = null;
        vp.view.target = vp.view.target.clone();
        const framing = fitPreviewCamera(vp, frameBox);
        if (name === "section") {
          if (!app.section) throw new Error("Native section rendering is unavailable");
          const n = [0, 0, 0]; n[["X", "Y", "Z"].indexOf(section.axis)] = section.axis === "Y" ? -1 : 1;
          const o = [0, 0, 0]; o[["X", "Y", "Z"].indexOf(section.axis)] = section.offset;
          app.section.set({ ref: { n, o }, d: 0, flip: section.flip === true, hatch: true });
        }
        const viewDirection = name === "top" ? "Camera from +Z toward -Z" : name === "side" ? "Camera from -Y toward +Y" : name === "isometric" ? "Home isometric view" : name === "detail" ? "Detail in the fixed world-space region" : `Section from ${section.axis}`;
        images.push({ view: name, ...(phase?{phase}:{}), ...(name==="detail"?{focusRegion:detail}:{}), viewDirection, framing, projection: "orthographic", coordinateFrame, ...(name === "section" ? { section } : {}), dataUrl: imageDataUrl(app, frameBox, coordinateFrame) });
      } catch (error) { imageErrors.push({ view: name, error: error.message }); }
    }
  } finally {
    for (const [group, visible] of visibility) group.visible = visible;
    app.section?.set(saved.section);
    vp.view = saved.view; vp.useOrtho = saved.ortho; vp.grid.visible = saved.grid; vp.overlay.visible = saved.overlay;
    vp.anim = saved.anim;
    if (vp.anim) vp.anim.t0 += performance.now() - saved.time;
    app.scene.refresh();
    vp.render(); vp.request();
  }
  return { images, imageErrors, cameraRestored: true, sectionRestored: true };
}

export function initMcp(app) {
  // Static and offline builds have no local broker. Only the broker's
  // served shell or an explicit loopback opt-in should start MCP networking;
  // the Create workspace and model settings run in the page either way.
  const local = location.protocol === "http:" && ["localhost", "127.0.0.1"].includes(location.hostname);
  const enabled = local && (document.querySelector('meta[name="jumpstart-mcp-bridge"]')?.content === "1" || new URLSearchParams(location.search).get("mcp") === "1");
  const tutorials = tutorialSession(app, () => store.doc);
  const drawStatus = initAgentStatus();
  const workspace = initAiSetupPanel();
  const status = { checking: true, online: false, connected: false, recent: false };
  let statusTimer;
  const showStatus = (changes) => { Object.assign(status, changes); drawStatus(status); };
  const finishStatus = (outcome, error) => {
    clearTimeout(statusTimer);
    showStatus({ action: null, outcome, error });
    statusTimer = setTimeout(() => showStatus({ outcome: null, error: null }), STATUS_HOLD_MS);
  };
  showStatus(enabled ? {} : { checking: false, hosted: true });
  let editorId;
  try {
    editorId = sessionStorage.getItem("jumpstart.mcp.editorId") || id();
    sessionStorage.setItem("jumpstart.mcp.editorId", editorId);
  } catch {
    editorId = id();
  }

  const previews = new Map();
  const applied = new Map();
  let stopped = false;
  let polling = false;
  let pollAbort = null;
  let retryTimer = null;

  const currentRevision = () => fingerprint(store.doc);

  async function post(path, payload, signal) {
    const response = await fetch(`${BRIDGE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) throw new Error(result?.error || `Local MCP bridge returned HTTP ${response.status}`);
    return result;
  }

  function assertIdle() {
    if (app.mode === "arch") throw new Error("Switch from Architect to Beginner or Advanced before using MCP edits");
    if (app.floorPlanOpen) throw new Error("Close the Floor Planner before using MCP edits");
    if (app.cam?.isOpen || app.voxel?.isOpen || app.cosforge?.isOpen || app.carve?.active) throw new Error("Close CAM, Voxel, CosForge or Chip Carve before using MCP edits");
    if (app.lathe?.active) throw new Error("Finish the interactive Lathe before using MCP edits");
    if (app.command || app.sketcher.active) throw new Error("Finish or cancel the open Sketch or CAD command before using MCP edits");
    if (store.preview) throw new Error("Finish or cancel the current preview before using MCP edits");
    if (app.mode === "chisel" || app.simLock) throw new Error("Leave Chisel or Print Simulation before using MCP edits");
  }

  function checkRevision(expectedRevision) {
    if (expectedRevision !== undefined && expectedRevision !== currentRevision()) throw new Error("The document changed; read it again before continuing");
  }

  async function previewCompiled(compiled, plan, includeImage, section, extra = {}) {
    const baseSnapshot = currentRevision();
    const { requirements, detail: requestedDetail, ...metadata } = extra;
    const detail = requestedDetail || (!section ? requirements?.intent?.changeRegion : undefined);
    if (detail) validateRegionBox(detail);
    if (detail && section) throw new Error("Choose a detail comparison or section images in one preview, within the four-image budget");
    validateRequirements(requirements);
    const signatures = (document) => {
      const assets = new Map(Object.entries(document.assets || {}).map(([id, asset]) => [id, fingerprint(asset)]));
      return new Map(document.bodies.map((body) => {
        const resolved = resolveNode(body.node, document), references = {};
        JSON.stringify(resolved, (key, value) => { if (key === "asset" && typeof value === "string") references[value] = assets.get(value); return value; });
        const sketches = [...referencedSketchIds(body, document)].map((id) => document.sketches.find((sketch) => sketch.id === id));
        return [body.id, fingerprint({ body, resolved, sketches, assets: references })];
      }));
    };
    const beforeNative = new Map(store.doc.bodies.map(body=>[body.id,{node:resolveNode(body.node,store.doc),m:body.m.slice()}]));
    const beforeSignatures = signatures(store.doc);
    const beforeBodies = new Map(store.doc.bodies.map((body) => [body.id, bodyInfo(body, app)]));
    let beforeImages;
    if (includeImage && detail) {
      const ids=compiled.affectedBodyIds.filter(id=>store.doc.bodies.some(b=>b.id===id));
      const box=app.scene.allBox(b=>ids.includes(b.id));
      if (ids.length && !box.isEmpty()) beforeImages=previewImages(app,box,undefined,undefined,ids,detail,"before");
    }
    let ownedPreview;
    const setCompiledPreview = () => {
      const previewDocument = clone(compiled.document);
      previewDocument.bodies.forEach((body) => { if (compiled.affectedBodyIds.includes(body.id)) body.cmdPreview = true; });
      store.setPreview((doc) => {
        for (const key of Object.keys(doc)) delete doc[key];
        Object.assign(doc, previewDocument);
      });
      ownedPreview = store.preview;
    };
    setCompiledPreview();
    const assertOwned = () => {
      checkRevision(baseSnapshot);
      if (store.preview !== ownedPreview || app.command || app.sketcher.active) throw new Error("Another editor command replaced the MCP preview; finish it and retry");
    };
    try {
      const requirementTargets = [...(requirements?.bodies || []).map(({ target }) => target), ...(requirements?.pairs || []).flatMap(({ a, b }) => [a, b]), ...(requirements?.preserveRegions || []).map(r=>r.bodyId), ...(requirements?.intent?.targetBodyIds || [])];
      const requirementBodyIds = requirementTargets.flatMap((target) => {
        const bodyId = compiled.featureBodyIds?.[target] ?? target;
        return typeof bodyId === "string" && compiled.document.bodies.some((body) => body.id === bodyId) ? [bodyId] : [];
      });
      const previewBodyIds = [...new Set([...compiled.affectedBodyIds, ...requirementBodyIds])];
      const waitForBuild = async () => {
        const deadline = Date.now() + BUILD_TIMEOUT_MS;
        let current;
        while (Date.now() < deadline) {
          assertOwned();
          current = readyBodies(app, previewBodyIds);
          if (current.every((result) => !result.pending)) return current;
          await sleep(50);
        }
        return readyBodies(app, previewBodyIds);
      };
      let results = await waitForBuild();
      const holePatterns = [];
      for (const pattern of compiled.pendingHolePatterns || []) {
        const entry = results.find((result) => result.id === pattern.bodyId);
        if (!entry?.view || entry.error || entry.pending) throw new Error(entry?.error || `Hole pattern target ${pattern.bodyId} did not build`);
        const generated = buildHolePattern(entry.body, entry.view.data, pattern);
        const target = compiled.document.bodies.find((body) => body.id === pattern.bodyId);
        target.node.mods = target.node.mods || [];
        if (generated.mod) target.node.mods.push(generated.mod);
        else {
          generated.sketch.seq = pattern.sketchSeq;
          compiled.document.sketches.push(generated.sketch);
          target.node.mods.push({ id: pattern.featureId, seq: pattern.seq, t: "bool", op: "cut", tool: generated.tool, m: IDENTITY.slice() });
        }
        holePatterns.push({ id: pattern.id, bodyId: pattern.bodyId, shape: generated.shape || "round", faceIndex: generated.faceIndex, holes: generated.holes, total: generated.total, dropped: generated.dropped, fittedPitch: generated.fittedPitch });
      }
      const featurePatterns = applyFeaturePatterns(compiled.document, compiled.pendingFeaturePatterns || []);
      if (holePatterns.length || featurePatterns.length) {
        refreshMcpModelBodyState(compiled.document, compiled.modelId);
        setCompiledPreview();
        results = await waitForBuild();
      }
      const errors = results.filter((entry) => entry.error || entry.pending).map((entry) => ({ id: entry.id, error: entry.error || "Geometry build timed out", category: entry.pending ? "timeout" : "cad_construction", cause: "unverified", nextChecks: [entry.pending ? "Read current build state before retrying with a smaller feature stage." : "Inspect the reported source feature and intermediate geometry before changing it."] }));
      const result = {
        previewId: id(), valid: !errors.length, errors, revision: currentRevision(),
        validation: { schema: "passed", cadConstruction: errors.length ? "failed" : "passed", geometricRequirements: "not_requested", physicalFit: "unverified", manufacturingPerformance: "unverified" },
        document: { id: store.doc.id, name: plan.name },
        modelId: compiled.modelId, parameters: compiled.parameters, diff: compiled.diff, designContext: compiled.designContext,
        ...(holePatterns.length ? { holePatterns } : {}),
        ...(featurePatterns.length ? { featurePatterns } : {}),
        bodies: results.filter((entry) => entry.view).map(({ body, view }) => ({ ...bodyInfo(body, app, true), volume: view.data.volume, triangleCount: view.data.triangles.length / 3 })),
        ...metadata,
      };
      const afterSignatures = signatures(compiled.document);
      if (result.valid) for (const { body } of results) {
        const area = body.mcpDrawerLayout?.definition?.printArea;
        if (!area || !compiled.affectedBodyIds.includes(body.id)) continue;
        const dimensions = bodyInfo(body, app).dimensions;
        try {
          if (!dimensions) throw new Error("Printer fit requires measured preview bounds.");
          const fit = checkPrintFit(area, dimensions.x, dimensions.y, dimensions.z, body.name);
          const report = result.bodies.find(entry => entry.id === body.id); if (report) report.printFit = { ...fit, source: "measured preview bounds" };
        } catch (error) { result.valid = false; result.validation.geometricRequirements = "failed"; errors.push({ id: body.id, category: "acceptance", error: error.message }); }
      }
      const afterBodies = new Map(compiled.document.bodies.map((body) => [body.id, bodyInfo(body, app)]));
      result.changes = comparePreviewBodies(beforeBodies, afterBodies, beforeSignatures, afterSignatures);
      if (result.valid) {
        const box = app.scene.allBox((body) => compiled.affectedBodyIds.includes(body.id));
        const phoneCradle = compiled.document.bodies.find((body) => body.mcpPhoneCradle)?.mcpPhoneCradle;
        const coordinateFrame = phoneCradle?.coordinateFrame || { description: "X across · Y depth · Z up", orientation: "+X / +Y / +Z" };
        if (phoneCradle) result.phoneCradle = clone(phoneCradle);
        const imageSection = section || (detail ? undefined : { axis: "X", offset: (box.min.x + box.max.x) / 2, default: true });
        if (includeImage && !box.isEmpty()) Object.assign(result, previewImages(app, box, imageSection, coordinateFrame, compiled.affectedBodyIds,detail,detail?"after":undefined));
        if (beforeImages) {
          result.images = [...beforeImages.images,...(result.images || [])];
          result.imageErrors = [...beforeImages.imageErrors,...(result.imageErrors || [])];
          result.comparison = {region:detail,views:"overview and identical world-space detail framing before/after"};
        }
        const geometries = new Map(results.map(({ body, view }) => [body.id, {
          nativeBody: { node: resolveNode(body.node, compiled.document), m: body.m.slice() },
          mesh: { vertices: view.data.vertices, triangles: view.data.triangles, matrix: Array.from(view.group.matrix.elements) },
          selectors: bodyInfo(body, app, true).geometrySelectors,
          ...(body.mcpPhoneCradle ? { phoneCradle: clone(body.mcpPhoneCradle) } : {}),
        }]));
        if (compiled.designContext?.preset === "rectangular_frame") {
          const expected = Object.fromEntries(["outerWidth", "outerDepth", "height", "wall"].map(name => [name, compiled.parameters[name].value]));
          const inspection = inspectGeometry([...geometries.values()][0].mesh, { frame: expected, tolerance: 0.01 });
          result.frameInspection = { ...inspection.frame, meshValidation: inspection.meshValidation };
          if (!inspection.frame.passed || !inspection.meshValidation.valid) {
            result.valid = false; result.errors.push({ error: "Generated frame failed independent geometry checks" });
            result.validation.geometricRequirements = "failed";
          } else result.validation.geometricRequirements = "passed";
        }
        const bytes = [...geometries.values()].reduce((sum, { mesh }) => sum + (mesh.vertices.byteLength || mesh.vertices.length * 8) + (mesh.triangles.byteLength || mesh.triangles.length * 8), 0);
        if (bytes > 32 * 1024 * 1024) throw new Error("Preview geometry exceeds the 32 MiB inspection cache budget");
        if (result.valid) {
          const pairResults = requirements?.pairs ? await inspectNativePairs(requirements.pairs, geometries, compiled.featureBodyIds, app.kernel) : [];
          const regionResults = await inspectProtectedRegions(requirements?.preserveRegions || [],beforeNative,geometries,app.kernel,requirements?.intent);
          assertOwned();
          const acceptance = evaluateRequirements(requirements, { document: compiled.document, featureBodyIds: compiled.featureBodyIds, geometries, beforeSignatures, afterSignatures, pairResults, regionResults });
          if (acceptance) {
            result.acceptance = acceptance;
            result.validation.geometricRequirements = acceptance.status;
            result.valid = acceptance.passed;
            if (!acceptance.passed) result.errors.push({ error: "Preview requirements did not pass", category: "acceptance", nextChecks: ["Inspect the acceptance checks and correct the plan before applying."] });
          }
          previews.set(result.previewId, { plan, compiled, baseSnapshot, baseDocumentId: store.doc.id, revision: currentRevision(), geometries, bytes, acceptance });
        }
        const cacheBytes = () => [...previews.values()].reduce((sum, entry) => sum + entry.bytes, 0);
        while (previews.size > 20 || cacheBytes() > 64 * 1024 * 1024) previews.delete(previews.keys().next().value);
      }
      assertOwned();
      return result;
    } finally {
      // A human can begin a native preview while the worker is building. Do not
      // clear a preview now owned by that command when abandoning this request.
      if (store.preview === ownedPreview) store.setPreview(null);
    }
  }

  async function prepareImportDocument(rawPlan, importAssets) {
    const operations = (rawPlan.operations || []).filter((operation) => operation.type === "import");
    if (!operations.length) {
      if (importAssets?.length) throw new Error("Unexpected managed import bytes were supplied without import operations");
      return store.doc;
    }
    if (!Array.isArray(importAssets) || importAssets.length !== operations.length || operations.length > 4) throw new Error("Managed import payload does not match the typed import operations");
    const byId = new Map(importAssets.map((asset) => [asset.assetId, asset]));
    if (byId.size !== operations.length || operations.some((operation) => !byId.has(operation.assetId))) throw new Error("Managed import payload ids do not match the typed plan");
    const document = clone(store.doc);
    document.assets ||= {};
    let total = 0;
    for (const operation of operations) {
      const asset = byId.get(operation.assetId);
      if (!/^[a-f0-9]{64}$/.test(asset.assetId) || typeof asset.name !== "string" || asset.name.includes("/") || asset.name.includes("\\") || !Number.isSafeInteger(asset.sizeBytes) || typeof asset.base64 !== "string") throw new Error("Managed import metadata is invalid");
      const format = String(asset.format).toLowerCase();
      const extension = asset.name.slice(asset.name.lastIndexOf(".") + 1).toLowerCase();
      if (!["stl", "3mf", "step"].includes(format) || !(extension === format || (format === "step" && extension === "stp"))) throw new Error("Managed import file type does not match its filename");
      if (asset.sizeBytes < 1 || asset.sizeBytes > 24 * 1024 * 1024 || asset.base64.length > 32 * 1024 * 1024) throw new Error("Managed import exceeds the 24 MiB file limit");
      total += asset.sizeBytes;
      if (total > 24 * 1024 * 1024) throw new Error("Managed imports exceed the 24 MiB per-plan limit");
      const bytes = fromB64(asset.base64);
      if (bytes.byteLength !== asset.sizeBytes) throw new Error("Managed import size does not match its metadata");
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (value) => value.toString(16).padStart(2, "0")).join("");
      if (hash !== asset.assetId || hash !== operation.assetId) throw new Error("Managed import digest changed after listing; list the imports again");
      let kind = "step", data = bytes;
      if (format === "stl" || format === "3mf") {
        if ((format === "3mf") !== isZip(bytes)) throw new Error(`The ${format.toUpperCase()} import contents do not match the declared file type`);
        const parsed = await readMeshFile(bytes);
        if (format === "3mf" && !parsed.unitFromFile) throw new Error("The 3MF import did not provide file units");
        if (format === "stl" && operation.units !== "mm" && operation.units !== "cm" && operation.units !== "in") throw new Error("STL import requires explicit units: mm, cm, or in");
        kind = "mesh";
        const mesh = parsed.mesh.I.length / 3 > MESH_LIMIT ? simplify(parsed.mesh, MESH_LIMIT).mesh : parsed.mesh;
        data = packMesh(mesh);
      } else if (operation.units !== undefined) throw new Error("STEP import must preserve units encoded in its file");
      document.assets[asset.assetId] = { kind, name: asset.name, data: toB64(data) };
    }
    return document;
  }

  async function previewModel(rawPlan, includeImage = true, replaceBodyIds = [], section, expectedRevision, importAssets = [], requirements, detail) {
    assertIdle(); checkRevision(expectedRevision);
    const sourceDocument = await prepareImportDocument(rawPlan, importAssets);
    const compiled = compileMcpModel(sourceDocument, rawPlan, replaceBodyIds);
    return previewCompiled(compiled, compiled.plan, includeImage, section, { requirements, detail });
  }

  async function previewParameters(p) {
    assertIdle(); checkRevision(p.expectedRevision);
    const compiled = reviseMcpParameters(store.doc, p.modelId, p.values);
    return previewCompiled(compiled, compiled.plan, p.includeImage !== false, p.section, { requirements: p.requirements, detail:p.detail });
  }

  async function previewResizeBody(bodyId, size, anchor = "base", includeImage = true, section, expectedRevision, requirements, detail) {
    assertIdle(); checkRevision(expectedRevision);
    const body = store.doc.bodies.find((entry) => entry.id === bodyId);
    if (!body) throw new Error("Body does not exist in the current document");
    const view = app.scene.views.get(bodyId);
    const edit = resizeBodyDocument(store.doc, bodyId, view?.data?.kbbox || view?.data?.bbox, size, anchor);
    // Resizing a generated model directly invalidates its saved template ownership.
    edit.document.mcpModels = (edit.document.mcpModels || []).filter((model) => !model.bodyIds.includes(bodyId));
    const compiled = { document: edit.document, createdBodyIds: [bodyId], featureBodyIds: { [bodyId]: bodyId }, affectedBodyIds: [bodyId] };
    return previewCompiled(compiled, { name: `Resize ${body.name}`.slice(0, 80), mode: store.doc.mode }, includeImage, section, { bodyId, anchor, requestedLocalDimensionsMm: { ...size }, factors: edit.factors, requirements, detail });
  }

  function inspectionSource(p) {
    assertIdle(); checkRevision(p.expectedRevision);
    if (p.previewId) {
      const preview = previews.get(p.previewId);
      if (!preview || preview.baseDocumentId !== store.doc.id || preview.baseSnapshot !== currentRevision()) throw new Error("Preview expired or stale; preview again before inspecting");
      const geometry = preview.geometries.get(p.bodyId);
      if (!geometry) throw new Error("Body is not part of the requested preview");
      return geometry;
    }
    const [status] = readyBodies(app, [p.bodyId]);
    if (status.error || status.pending) throw new Error(status.error || "Geometry is still building; retry read-only inspection");
    return { nativeBody: { node: resolveNode(status.body.node, store.doc), m: status.body.m.slice() }, mesh: { vertices: status.view.data.vertices, triangles: status.view.data.triangles, matrix: Array.from(status.view.group.matrix.elements) }, selectors: bodyInfo(status.body, app, true).geometrySelectors, ...(status.body.mcpPhoneCradle ? { phoneCradle: clone(status.body.mcpPhoneCradle) } : {}) };
  }

  function applyModel(previewId) {
    assertIdle();
    if (applied.has(previewId)) return applied.get(previewId);
    const preview = previews.get(previewId);
    if (!preview) throw new Error("Preview expired or unknown; preview the model again");
    if (store.doc.id !== preview.baseDocumentId || fingerprint(store.doc) !== preview.baseSnapshot) {
      previews.delete(previewId);
      throw new Error("The document changed after preview; preview the plan again before applying it");
    }
    if (preview.acceptance && !preview.acceptance.passed) throw new Error("Preview requirements did not pass; correct the model and preview again before applying");
    const checkedCandidates = new Set([...(preview.compiled.createdBodyIds || []), ...(preview.compiled.affectedBodyIds || [])]);
    const cradleBodyIds = preview.compiled.document.bodies.filter((body) => checkedCandidates.has(body.id) && body.mcpPhoneCradle).map((body) => body.id);
    if (cradleBodyIds.some((bodyId) => !preview.meshChecks?.has(bodyId))) throw new Error("Inspect every phone-cradle preview with mesh validation before applying it");
    if (preview.failedMesh || [...(preview.checks?.values() || [])].some((pass) => !pass)) throw new Error("Preview has failed requested geometry checks; correct the model or resolve the reported measurement before applying");
    const bodies = {};
    for (const bodyId of checkedCandidates) {
      const geometry = preview.geometries.get(bodyId);
      if (!geometry) continue;
      try { bodies[bodyId] = inspectGeometry(geometry.mesh, {}).meshValidation; }
      catch (error) { bodies[bodyId] = { valid: null, error: error.message }; }
    }
    const meshValidation = { source: "tessellation of the applied native document, built during preview", valid: Object.values(bodies).every((entry) => entry.valid === true), bodies };
    const next = clone(preview.compiled.document);
    store.update((doc) => {
      for (const key of Object.keys(doc)) delete doc[key];
      Object.assign(doc, next);
    }, `AI model: ${preview.plan.name}`);
    app.setMode(preview.plan.mode || "advanced");
    app.select(preview.compiled.createdBodyIds.length ? preview.compiled.createdBodyIds : preview.compiled.affectedBodyIds);
    const result = { applied: true, previewId, revision: currentRevision(), bodyIds: preview.compiled.createdBodyIds, featureBodyIds: preview.compiled.featureBodyIds, modelId: preview.compiled.modelId, parameters: preview.compiled.parameters, meshValidation };
    previews.delete(previewId);
    applied.set(previewId, result);
    if (applied.size > 100) applied.delete(applied.keys().next().value);
    return result;
  }

  async function exportModel(format, name, options = {}) {
    assertIdle();
    const revision = currentRevision();
    const bodies = selectExportBodies(store.doc.bodies, options);
    if (!bodies.length) throw new Error(`No eligible bodies for ${options.scope || "printable"} export`);
    const selection = { scope: options.scope || "printable", bodyIds: bodies.map(body => body.id), roles: bodies.map(body => ({ id: body.id, role: bodyRole(body) })) };
    const statuses = readyBodies(app, bodies.map((body) => body.id));
    const errors = statuses.filter((entry) => entry.error || entry.pending).map((entry) => ({ id: entry.id, error: entry.error || "Geometry is still building" }));
    if (errors.length) throw new Error(`Cannot export while geometry errors remain: ${JSON.stringify(errors)}`);
    if (format === "3mf") {
      const bytes = await app.projects.threeMFBytes(bodies);
      checkRevision(revision);
      if (bytes.byteLength > MAX_EXPORT_BYTES) throw new Error("3MF export exceeds the local export budget");
      return { format, name, ...selection, revision, byteLength: bytes.byteLength, base64: base64(bytes) };
    }
    if (format === "stl") {
      const { bytes, bodyTriangles } = buildStl(app, bodies);
      return { format, name, ...selection, revision, byteLength: bytes.byteLength, base64: base64(bytes), bodyTriangles };
    }
    if (format === "step") {
      const resolved = bodies.map((body) => ({ node: resolveNode(body.node, store.doc), m: body.m }));
      const buffer = await app.kernel.step(resolved);
      checkRevision(revision);
      if (buffer.byteLength > MAX_EXPORT_BYTES) throw new Error(`STEP export exceeds the ${MAX_EXPORT_BYTES} byte local export limit`);
      return { format, name, ...selection, revision, byteLength: buffer.byteLength, base64: base64(new Uint8Array(buffer)) };
    }
    throw new Error("Export format must be stl, step or 3mf");
  }

  async function drawingSheet(p) {
    assertIdle(); checkRevision(p.expectedRevision);
    const revision = currentRevision();
    const drawing = normalizeDrawing({ ...p.drawing, date: p.drawing?.date ?? new Date().toISOString().slice(0, 10) });
    const bodies = selectExportBodies(store.doc.bodies, { scope: p.scope, bodyIds: p.bodyIds });
    if (!bodies.length) throw new Error(`No eligible bodies to draw in ${p.scope || "printable"} scope`);
    const errors = readyBodies(app, bodies.map((body) => body.id)).filter((entry) => entry.error || entry.pending).map((entry) => ({ id: entry.id, error: entry.error || "Geometry is still building" }));
    if (errors.length) throw new Error(`Cannot draw while geometry errors remain: ${JSON.stringify(errors)}`);
    const projections = await app.kernel.project(bodies.map((body) => ({ node: resolveNode(body.node, store.doc), m: body.m })), drawingCameras(drawing.views), { hidden: drawing.hiddenLines });
    checkRevision(revision);
    return { revision, bodyIds: bodies.map((body) => body.id), sheet: composeDrawing(projections, drawing) };
  }

  async function drawingImage(svg, { width, height }, pixels = 1600) {
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    try {
      const image = new Image();
      await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error("Could not render the drawing image")); image.src = url; });
      const canvas = document.createElement("canvas");
      canvas.width = pixels; canvas.height = Math.round((pixels * height) / width);
      const context = canvas.getContext("2d");
      context.fillStyle = "#fff"; context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/png");
    } finally { URL.revokeObjectURL(url); }
  }

  async function execute(command) {
    const p = command.params || {};
    switch (command.action) {
      case "start_tutorial":
        assertIdle(); checkRevision(p.expectedRevision); return tutorials.start(p.tutorialId);
      case "get_tutorial_status": return tutorials.status();
      case "preview_native_model": {
        assertIdle(); checkRevision(p.expectedRevision);
        const compiled = createNativeParametricModel(store.doc, p.plan);
        return previewCompiled(compiled, compiled.plan, p.includeImage !== false, p.section, { requirements: p.requirements, detail:p.detail });
      }
      case "preview_native_parameters": {
        assertIdle(); checkRevision(p.expectedRevision);
        const compiled = reviseNativeParameters(store.doc, { values: p.values });
        return previewCompiled(compiled, compiled.plan, p.includeImage !== false, p.section, { requirements: p.requirements, detail:p.detail });
      }
      case "preview_frame": {
        assertIdle(); checkRevision(p.expectedRevision);
        const compiled = compileFramePlan(store.doc, p.plan);
        return previewCompiled(compiled, compiled.plan, p.includeImage !== false, p.section, { requirements: p.requirements, detail:p.detail });
      }
      case "preview_lathe": {
        assertIdle(); checkRevision(p.expectedRevision);
        const compiled = compileLathePlan({ document: store.doc, plan: p.plan, bodyId: p.bodyId });
        return previewCompiled(compiled, { ...compiled.plan, mode: store.doc.mode }, p.includeImage !== false, p.section, { warnings: compiled.warnings, requirements: p.requirements, detail:p.detail });
      }
      case "list_editors": return { editors: [{ editorId, documentId: store.doc.id, documentName: store.doc.name, mode: app.mode, bodyCount: store.doc.bodies.length, focused: document.visibilityState === "visible" && document.hasFocus() }] };
      case "get_document": return documentSummary(app, editorId, currentRevision(), p.includeGeometry === true, p);
      case "preview_new_document": {
        assertIdle(); checkRevision(p.expectedRevision);
        const document = newDoc(p.name || "Untitled", p.mode || "beginner");
        return previewCompiled({ document, createdBodyIds: [], affectedBodyIds: [], featureBodyIds: {} }, { name: document.name, mode: document.mode }, false, undefined, { newDocument: { id: document.id, name: document.name, mode: document.mode }, replacesDocument: store.doc.id, requirements: p.requirements });
      }
      case "preview_model": return previewModel(p.plan, p.includeImage !== false, p.replaceBodyIds || [], p.section, p.expectedRevision, p.importAssets || [], p.requirements,p.detail);
      case "preview_resize_body": return previewResizeBody(p.bodyId, p.size, p.anchor || "base", p.includeImage !== false, p.section, p.expectedRevision, p.requirements,p.detail);
      case "preview_parameters": return previewParameters(p);
      case "preview_feature_edit": {
        assertIdle(); checkRevision(p.expectedRevision);
        const body=store.doc.bodies.find(b=>b.id===p.edit.bodyId);
        if (body && (!app.scene.views.get(body.id)?.data || app.scene.views.get(body.id)?.pending || app.scene.errors.has(body.id))) throw new Error("Wait for valid current geometry before a feature edit");
        if (!body || bodyInfo(body,app,true,{includeSelectors:false,includeFeatureTree:false}).geometryFingerprint !== p.expectedFingerprint) throw new Error("Feature geometry fingerprint changed; reread the body before editing");
        if (!p.requirements?.intent || p.requirements.intent.targetBodyIds.length !== 1 || p.requirements.intent.targetBodyIds[0] !== p.edit.bodyId) throw new Error("Feature edit requires an explicit intent for its single target body");
        const compiled=compileFeatureEdit(store.doc,p.edit);
        return previewCompiled(compiled,{name:`Edit ${body.name}`.slice(0,80),mode:store.doc.mode},p.includeImage!==false,p.section,{requirements:p.requirements,featureEdit:compiled.edit,detail:p.detail});
      }
      case "inspect_geometry": {
        if (p.againstBodyId && !p.expectedRevision) throw new Error("expectedRevision is required for pair inspection");
        if (p.pairChecks && !p.againstBodyId) throw new Error("pairChecks require againstBodyId");
        if (p.pairChecks) validatePairThresholds(p.pairChecks);
        const source = inspectionSource(p);
        const result = { ...inspectGeometry(source.mesh, p), bodyId: p.bodyId, revision: currentRevision() };
        if (p.againstBodyId) {
          const other = inspectionSource({ ...p, bodyId: p.againstBodyId });
          const geometries = new Map([[p.bodyId, source], [p.againstBodyId, other]]);
          const [pair] = await inspectNativePairs([{ id: "inspection", a: p.bodyId, b: p.againstBodyId }], geometries, {}, app.kernel);
          inspectionSource(p); // Recheck the pinned revision/preview after native work completes.
          result.pair = pair;
          if (p.pairChecks) {
            result.pair.acceptance = evaluatePairChecks(pair, p.pairChecks);
            const statuses = [result.geometricRequirements, result.pair.acceptance.status];
            result.geometricRequirements = statuses.includes("failed") ? "failed" : statuses.includes("unknown") ? "unknown" : "passed";
          }
        }
        if (source.phoneCradle) {
          const connectedComponents = result.meshValidation?.disconnectedComponents ?? null;
          result.phoneCradle = { ...clone(source.phoneCradle), supportConnectivity: { connectedComponents, expectedComponents: 1, passed: connectedComponents === 1 && result.meshValidation?.valid === true, source: "independent tessellated mesh component check" } };
        }
        if (p.previewId) {
          const preview = previews.get(p.previewId);
          preview.checks ||= new Map();
          if (result.pair?.acceptance) preview.checks.set(`pair:${p.bodyId}:${p.againstBodyId}`, result.pair.acceptance.passed);
          for (const check of result.checks) preview.checks.set(`${p.bodyId}:${check.id}`, check.pass);
          if (result.frame) preview.checks.set(`${p.bodyId}:rectangularFrame`, result.frame.passed);
          if (result.meshValidation) { preview.meshChecks ||= new Map(); preview.meshChecks.set(p.bodyId, result.meshValidation.valid); preview.failedMesh = [...preview.meshChecks.values()].some((pass) => !pass); }
        }
        return result;
      }
      case "select_geometry": {
        const { selectors } = inspectionSource(p);
        const { kind, ...predicate } = p.query;
        return selectGeometry(selectors, { kind, predicate, expectedFingerprint: p.expectedFingerprint, currentFingerprint: selectors.fingerprint });
      }
      case "save_document": {
        assertIdle(); checkRevision(p.expectedRevision);
        const result = app.projects.saveLocalMcp({ versioned: p.versioned === true });
        return { ...result, revision: currentRevision() };
      }
      case "reopen_document": {
        assertIdle(); checkRevision(p.expectedRevision);
        const result = app.projects.reopenLocalMcp(p.documentId);
        const deadline = Date.now() + BUILD_TIMEOUT_MS;
        while (readyBodies(app, store.doc.bodies.map((body) => body.id)).some((entry) => entry.pending) && Date.now() < deadline) await sleep(50);
        return { ...result, revision: currentRevision(), document: documentSummary(app, editorId, currentRevision(), true) };
      }
      case "apply_model": return applyModel(p.previewId);
      case "undo": {
        assertIdle();
        if (p.expectedRevision !== currentRevision()) throw new Error("The document changed; read it again before undoing");
        if (!store.undoStack.length) throw new Error("Nothing to undo");
        const undone = store.undo();
        if (!undone) throw new Error("Nothing to undo");
        if (app.mode !== store.doc.mode) app.setMode(store.doc.mode || "beginner", true);
        return { undone: true, revision: currentRevision(), document: documentSummary(app, editorId, currentRevision()) };
      }
      case "export_complete":
        checkRevision(p.expectedRevision);
        if (!["stl", "step", "3mf"].includes(p.format)) throw new Error("Unknown export completion format");
        app.onExport && app.onExport(p.format); return { notified: true };
      case "export_model": return exportModel(p.format, p.name || store.doc.name || "design", { scope: p.scope, bodyIds: p.bodyIds });
      case "render_drawing": {
        const { revision, bodyIds, sheet } = await drawingSheet(p);
        return { revision, bodyIds, ...sheet.report, imageDataUrl: await drawingImage(drawingSVG(sheet), sheet.sheet, sheet.sheet.size === "A3" ? 2000 : 1600) };
      }
      case "export_drawing": {
        if (!["svg", "pdf"].includes(p.format)) throw new Error("Drawing format must be svg or pdf");
        const { revision, bodyIds, sheet } = await drawingSheet(p);
        const bytes = p.format === "pdf" ? drawingPDF(sheet) : new TextEncoder().encode(drawingSVG(sheet));
        if (bytes.byteLength > MAX_EXPORT_BYTES) throw new Error("Drawing export exceeds the local export budget");
        return { format: p.format, revision, bodyIds, report: sheet.report, byteLength: bytes.byteLength, base64: base64(bytes) };
      }
      default: throw new Error(`Unknown JumpStart MCP action: ${command.action}`);
    }
  }

  const heartbeat = () => post("/heartbeat", {
    editorId,
    documentId: store.doc.id,
    documentName: store.doc.name,
    mode: app.mode,
    bodyCount: store.doc.bodies.length,
    revision: currentRevision(),
    focused: document.visibilityState === "visible" && document.hasFocus(),
  }, AbortSignal.timeout(3000)).then((response) => showStatus({ checking: false, online: true, connected: response.agent?.clientConnected === true, recent: response.agent?.recentClientActivity === true })).catch(() => showStatus({ checking: false, online: false, connected: false, recent: false }));

  const submitResult = (commandId, ok, data, error) => post("/result", { editorId, commandId, ok, data, error }).catch(() => undefined);
  let commandQueue = Promise.resolve();
  const enqueue = command => {
    const result = commandQueue.then(() => execute(command));
    commandQueue = result.catch(() => {});
    return result;
  };
  const localRequest = (action, params) => enqueue({ action, params });
  const createPreviewView = previewId => {
    const preview = previews.get(previewId);
    if (!preview) throw new Error("Preview expired. Generate it again.");
    return previewViewer(preview.compiled.affectedBodyIds.map(id => preview.geometries.get(id).mesh));
  };
  const templates = initTemplatePanel({ request: localRequest, subscribe: listener => store.on(listener), createPreviewView });
  const openWorkspace = view => { templates?.show(view); workspace.open(); };
  const parameterHost = document.createElement("div");
  parameterHost.id = "model-params-root";
  document.getElementById("viewport").append(parameterHost);
  const parameterCard = initParameterCard({ host: parameterHost, request: localRequest, subscribe: listener => store.on(listener), createPreviewView });
  app.uiListeners.add(() => parameterCard.select(app.sel));
  if (!enabled) return { enabled, openWorkspace };

  const poll = async () => {
    if (polling || stopped) return;
    polling = true;
    let retry = false;
    pollAbort = new AbortController();
    try {
      const { command } = await post("/poll", { editorId }, pollAbort.signal);
      if (command) {
        const reading = ["get_document", "inspect_geometry", "select_geometry", "list_editors", "get_tutorial_status", "render_drawing", "export_drawing"].includes(command.action);
        if (!reading) clearTimeout(statusTimer);
        showStatus({ action: command.action, checking: false, online: true, recent: true, ...(reading ? {} : { error: null, outcome: null }) });
        const before = currentRevision();
        try {
          const result = await enqueue(command);
          const failed = result?.valid === false || ["failed", "unknown"].includes(result?.geometricRequirements);
          const changesDocument = ["apply_model", "undo", "reopen_document"].includes(command.action);
          const outcome = command.action.startsWith("preview_") || ["save_document", "export_model"].includes(command.action) ? command.action : changesDocument ? before !== currentRevision() ? command.action : "no_change" : null;
          if (reading && !failed) showStatus({ action: null });
          else finishStatus(failed ? null : outcome, failed ? "The requested geometry checks failed. The saved model was not changed by inspection." : null);
          await submitResult(command.id, true, result);
        }
        catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          finishStatus(null, message);
          await submitResult(command.id, false, undefined, message);
        }
      }
    } catch (error) {
      showStatus({ checking: false, online: false, connected: false, recent: false });
      retry = !stopped && (!(error instanceof DOMException) || error.name !== "AbortError");
    } finally {
      pollAbort = null;
      polling = false;
      if (!stopped) {
        if (retry) retryTimer = setTimeout(() => { retryTimer = null; void poll(); }, 1_000);
        else void poll();
      }
    }
  };

  heartbeat();
  const heartbeatTimer = setInterval(heartbeat, HEARTBEAT_MS);
  void poll();
  window.addEventListener("pagehide", () => {
    stopped = true;
    clearInterval(heartbeatTimer);
    clearTimeout(statusTimer);
    clearTimeout(retryTimer);
    pollAbort?.abort();
  }, { once: true });
  return { enabled, openWorkspace };
}
