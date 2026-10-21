import test from "node:test";
import assert from "node:assert/strict";
import { fitPreviewCamera } from "../browser/preview-camera.js";

test("preview fit synchronizes the camera before measuring and after zoom", () => {
  for (const [w,h] of [[1300,550],[320,700],[700,320]]) {
    let synced = false, distance = 100, updates = 0;
    const point = { clone() { return { set(x,y,z) { return {x,y,z}; } }; } };
    const vp = {w,h,useOrtho:true,view:{dist:100},camera:{updateMatrixWorld(){synced=true;distance=vp.view.dist;updates++;}},updateCamera(){synced=false;},project(p){assert(synced,"Camera matrices must be current");return [w/2+p.x*w/distance,h/2-p.y*w/distance,0];}};
    const result = fitPreviewCamera(vp,{min:{...point,x:-43,y:-43,z:0},max:{x:43,y:43,z:10},isEmpty:()=>false});
    assert(result.fullyVisible);assert.equal(updates,2);
    assert(result.bounds.maxX-result.bounds.minX <= w*.8+.001);
    assert(result.bounds.maxY-result.bounds.minY <= h*.8+.001);
  }
});
