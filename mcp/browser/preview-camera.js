export function fitPreviewCamera(vp, box, occupancy = 0.8) {
  if (!vp.useOrtho || !(vp.w > 0 && vp.h > 0) || box.isEmpty()) throw new Error("Preview needs an available orthographic viewport and bounds");
  const project = () => {
    vp.updateCamera();
    // lookAt changes the pose, but projection reads matrixWorldInverse before render.
    vp.camera.updateMatrixWorld(true);
    const corners = [];
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) corners.push(vp.project(box.min.clone().set(x, y, z)));
    if (corners.flat().some(value => !Number.isFinite(value))) throw new Error("Preview bounds could not be projected");
    return { minX: Math.min(...corners.map(p => p[0])), maxX: Math.max(...corners.map(p => p[0])), minY: Math.min(...corners.map(p => p[1])), maxY: Math.max(...corners.map(p => p[1])) };
  };
  const initial = project();
  vp.view.dist *= Math.max((initial.maxX - initial.minX) / (vp.w * occupancy), (initial.maxY - initial.minY) / (vp.h * occupancy), 0.001);
  const bounds = project();
  const fullyVisible = bounds.minX >= 0 && bounds.maxX <= vp.w && bounds.minY >= 0 && bounds.maxY <= vp.h;
  if (!fullyVisible) throw new Error("Preview model does not fit inside the viewport");
  return { viewport: { width: vp.w, height: vp.h }, bounds, occupancy, fullyVisible };
}
