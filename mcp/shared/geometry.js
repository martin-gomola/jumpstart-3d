/** Pure inspection of generated tessellation, never plan parameters.
 * Mesh: flat xyz `vertices`, flat vertex-index `triangles`, optional column-major
 * affine `matrix` (16 numbers). All results use world coordinates, normally mm.
 * These bounded mesh checks do not establish BRep validity or physical fitness.
 */
const MAX_TRIANGLES = 200000;
const MAX_VERTICES = 600000;
const axes = { x: 0, y: 1, z: 2 };
function toleranceOf(value = 1e-5) {
  if (!Number.isFinite(value) || value < 1e-8 || value > 1) throw new Error('tolerance must be between 1e-8 and 1');
  return value;
}
function axisOf(axis) { axis = typeof axis === 'string' ? axis.toLowerCase() : axis; if (!(axis in axes)) throw new Error('axis must be x, y, or z'); return axes[axis]; }
function prepared(mesh) {
  const { vertices: p, triangles: t, matrix: m } = mesh || {};
  if (!p || !t || p.length % 3 || t.length % 3 || p.length > MAX_VERTICES * 3 || t.length > MAX_TRIANGLES * 3) throw new Error('Invalid mesh or mesh inspection limit exceeded');
  if (m && (m.length !== 16 || !Array.from(m).every(Number.isFinite) || m[3] !== 0 || m[7] !== 0 || m[11] !== 0 || m[15] !== 1)) throw new Error('matrix must be a finite affine matrix');
  const points = [];
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i], y = p[i + 1], z = p[i + 2];
    if (![x,y,z].every(Number.isFinite)) throw new Error('Mesh contains non-finite vertices');
    const q = m ? [m[0]*x+m[4]*y+m[8]*z+m[12],m[1]*x+m[5]*y+m[9]*z+m[13],m[2]*x+m[6]*y+m[10]*z+m[14]] : [x,y,z];
    if (!q.every(Number.isFinite) || q.some(v => Math.abs(v) > 1e9)) throw new Error('Mesh coordinate exceeds inspection range');
    points.push(q);
  }
  for (const index of t) if (!Number.isInteger(index) || index < 0 || index >= points.length) throw new Error('Mesh contains invalid triangle index');
  return { points, triangles: t };
}
const sub = (a,b) => a.map((v,i)=>v-b[i]);
const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const dot = (a,b) => a.reduce((s,v,i)=>s+v*b[i],0);
const distance = (a,b) => Math.hypot(...sub(a,b));

export function inspectTriangleMesh(mesh, { tolerance = 1e-5 } = {}) {
  tolerance = toleranceOf(tolerance);
  const { points, triangles } = prepared(mesh);
  const min = [Infinity,Infinity,Infinity], max = [-Infinity,-Infinity,-Infinity];
  const weld = new Map(), ids = points.map(p => {
    p.forEach((v,i)=>{min[i]=Math.min(min[i],v);max[i]=Math.max(max[i],v);});
    const key=p.map(v=>Math.round(v/tolerance)).join(',');
    if (!weld.has(key)) weld.set(key,weld.size);
    return weld.get(key);
  });
  const parent = Array.from({length:weld.size},(_,i)=>i), used = new Set(), edges = new Map();
  const root = i => { while(parent[i]!==i) {parent[i]=parent[parent[i]];i=parent[i];} return i; };
  let degenerateTriangles=0, signedVolume=0;
  for(let i=0;i<triangles.length;i+=3) {
    const indexes=[triangles[i],triangles[i+1],triangles[i+2]], [a,b,c]=indexes.map(j=>points[j]);
    const v=indexes.map(j=>ids[j]);
    if(new Set(v).size<3 || Math.hypot(...cross(sub(b,a),sub(c,a))) <= tolerance*tolerance) {degenerateTriangles++;continue;}
    signedVolume+=dot(a,cross(b,c))/6;
    v.forEach(j=>used.add(j)); parent[root(v[1])]=root(v[0]);parent[root(v[2])]=root(v[0]);
    for(let j=0;j<3;j++) { const a=v[j],b=v[(j+1)%3],key=a<b?`${a},${b}`:`${b},${a}`; const e=edges.get(key)||{count:0,direction:0};e.count++;e.direction+=a<b?1:-1;edges.set(key,e); }
  }
  const values=[...edges.values()];
  return {
    source:'generated triangle mesh', tolerance, triangleCount:triangles.length/3,
    bounds:points.length?{min,max,dimensions:max.map((v,i)=>v-min[i])}:null,
    degenerateTriangles, boundaryEdges:values.filter(e=>e.count===1).length,
    nonManifoldEdges:values.filter(e=>e.count>2).length,
    inconsistentWindingEdges:values.filter(e=>e.count===2&&e.direction!==0).length,
    disconnectedComponents:new Set([...used].map(root)).size,
    signedVolume,
    limitations:['Vertices are welded by quantized coordinates; results depend on tolerance.','Does not detect self-intersection, overlapping shells, minimum wall thickness, or physical printability.','Signed volume is meaningful only for consistently oriented closed meshes.'],
  };
}

export function sectionTriangleMesh(mesh, { axis='z', offset, tolerance=1e-5, maxSegments=10000 } = {}) {
  const ax=axisOf(axis); tolerance=toleranceOf(tolerance);
  if(!Number.isFinite(offset)||!Number.isInteger(maxSegments)||maxSegments<1||maxSegments>20000) throw new Error('Invalid section offset or segment limit');
  const {points,triangles}=prepared(mesh), segments=[], seen=new Set();let coplanarTriangles=0;
  for(let i=0;i<triangles.length;i+=3) {
    const p=[points[triangles[i]],points[triangles[i+1]],points[triangles[i+2]]], ds=p.map(q=>q[ax]-offset);
    if(ds.every(d=>Math.abs(d)<=tolerance)){coplanarTriangles++;continue;}
    const hits=[];
    const add=q=>{if(!hits.some(h=>distance(h,q)<=tolerance))hits.push(q);};
    for(let j=0;j<3;j++){const k=(j+1)%3;if(Math.abs(ds[j])<=tolerance)add(p[j]);if(ds[j]*ds[k]<0){const u=ds[j]/(ds[j]-ds[k]);add(p[j].map((v,a)=>v+u*(p[k][a]-v)));}}
    if(hits.length===2&&distance(...hits)>tolerance){const key=hits.map(p=>p.map(v=>Math.round(v/tolerance)).join(',')).sort().join('|');if(!seen.has(key)){seen.add(key);if(segments.length>=maxSegments)throw new Error('Section segment limit exceeded');segments.push(hits);}}
  }
  return {axis,offset,tolerance,segments,coplanarTriangles,limitations:['Tessellated section segments are not fitted analytic curves.','Coplanar triangles are omitted; choose an offset away from surface planes.']};
}

export function sampleSolidIntervals(mesh, { axis='z', point, tolerance=1e-5 } = {}) {
  const ax=axisOf(axis);tolerance=toleranceOf(tolerance);
  if(!Array.isArray(point)||point.length!==3||!point.every(Number.isFinite))throw new Error('point must contain three finite coordinates');
  const {points,triangles}=prepared(mesh), dir=[0,0,0];dir[ax]=1;
  const hits=[];let ambiguous=false;
  for(let i=0;i<triangles.length;i+=3){const a=points[triangles[i]],b=points[triangles[i+1]],c=points[triangles[i+2]],u=sub(b,a),v=sub(c,a),h=cross(dir,v),det=dot(u,h);if(Math.abs(det)<1e-12)continue;const s=sub(point,a),w=dot(s,h)/det,q=cross(s,u),r=dot(dir,q)/det;if(w < -1e-10||r < -1e-10||w+r>1+1e-10)continue;const t=dot(v,q)/det;hits.push(point[ax]+t);}
  hits.sort((a,b)=>a-b);const crossings=[];for(const hit of hits)if(!crossings.length||Math.abs(hit-crossings.at(-1))>tolerance)crossings.push(hit);
  if(crossings.length%2)ambiguous=true;
  return {axis,point,tolerance,crossings,intervals:ambiguous?[]:crossings.filter((_,i)=>i%2===0).map((v,i)=>[v,crossings[i*2+1]]),ambiguous,limitations:['Assumes a closed mesh with non-tangent intersections; a tangent or boundary sample may be ambiguous.','Intervals use even-odd pairing and do not establish solid validity.']};
}

// Möller–Trumbore against a triangle stored as corner a and edges u, v; written out to avoid allocation in the ray loop.
function rayTriangle(o,d,{a,u,v}) {
  const h0=d[1]*v[2]-d[2]*v[1],h1=d[2]*v[0]-d[0]*v[2],h2=d[0]*v[1]-d[1]*v[0],det=u[0]*h0+u[1]*h1+u[2]*h2;if(Math.abs(det)<1e-12)return -1;
  const s0=o[0]-a[0],s1=o[1]-a[1],s2=o[2]-a[2],w=(s0*h0+s1*h1+s2*h2)/det;if(w< -1e-10||w>1+1e-10)return -1;
  const q0=s1*u[2]-s2*u[1],q1=s2*u[0]-s0*u[2],q2=s0*u[1]-s1*u[0],r=(d[0]*q0+d[1]*q1+d[2]*q2)/det;if(r< -1e-10||w+r>1+1e-10)return -1;
  return (v[0]*q0+v[1]*q1+v[2]*q2)/det;
}
function boundingHierarchy(corners) {
  const tris=corners.map(([a,b,c])=>({a,u:sub(b,a),v:sub(c,a)}));
  const order=Uint32Array.from(corners.keys()), centers=corners.map(([a,b,c])=>a.map((x,i)=>(x+b[i]+c[i])/3));
  const build=(start,end)=>{
    const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
    for(let i=start;i<end;i++)for(const p of corners[order[i]])for(let k=0;k<3;k++){min[k]=Math.min(min[k],p[k]);max[k]=Math.max(max[k],p[k]);}
    if(end-start<=2)return {min,max,start,end};
    const extent=max.map((v,k)=>v-min[k]),k=extent.indexOf(Math.max(...extent)),mid=(start+end)>>1;
    order.subarray(start,end).sort((i,j)=>centers[i][k]-centers[j][k]);
    return {min,max,left:build(start,mid),right:build(mid,end)};
  };
  return {root:build(0,tris.length),order,tris};
}
function boxEntry(node,o,inv,maxT,eps) {
  let near=0,far=maxT;
  for(let k=0;k<3&&near<=far;k++){const t1=(node.min[k]-eps-o[k])*inv[k],t2=(node.max[k]+eps-o[k])*inv[k];near=Math.max(near,Math.min(t1,t2));far=Math.min(far,Math.max(t1,t2));}
  return near<=far?near:Infinity;
}
// Nearest hit along a unit ray within maxT, ignoring hits closer than eps (the starting surface).
function nearestHit({root,order,tris},o,d,maxT,eps,budget) {
  const inv=d.map(v=>1/(Math.abs(v)<1e-12?1e-12:v));let best=maxT+eps;const stack=[root],entries=[0];
  if(boxEntry(root,o,inv,best,eps)===Infinity)return null;
  while(stack.length){
    const node=stack.pop();if(entries.pop()>best)continue;
    if(node.left){
      const l=boxEntry(node.left,o,inv,best,eps),r=boxEntry(node.right,o,inv,best,eps);
      if(l<=r){if(r!==Infinity){stack.push(node.right);entries.push(r);}if(l!==Infinity){stack.push(node.left);entries.push(l);}}
      else{if(l!==Infinity){stack.push(node.left);entries.push(l);}stack.push(node.right);entries.push(r);}
      continue;
    }
    for(let i=node.start;i<node.end;i++){if(--budget.tests<0)throw new Error('Printability ray-test budget exceeded; inspect a coarser tessellation');const t=rayTriangle(o,d,tris[order[i]]);if(t>eps&&t<best)best=t;}
  }
  return best<=maxT?best:null;
}

/** Overhangs and thin walls for printing along world +Z with the bed at the lowest Z.
 * A triangle overhangs when it faces down more than overhangAngle from vertical and is not on the bed;
 * one wholly within baseZone of the bed is reported separately as base overhang.
 * With minWall, four points per triangle are probed along the inward normal; material that ends
 * within minWall marks that share of the triangle as thin wall. Heuristic, not a print certification.
 */
export function inspectPrintability(mesh, { overhangAngle=45, minWall, baseZone=1, tolerance=1e-5, maxRayTests=20000000 } = {}) {
  tolerance=toleranceOf(tolerance);
  if(!Number.isFinite(baseZone)||baseZone<0||baseZone>10)throw new Error('baseZone must be between 0 and 10 mm');
  if(!Number.isFinite(overhangAngle)||overhangAngle<0||overhangAngle>89)throw new Error('overhangAngle must be between 0 and 89 degrees');
  if(minWall!==undefined&&(!Number.isFinite(minWall)||minWall<=0||minWall>100))throw new Error('minWall must be between 0 and 100 mm');
  const validation=inspectTriangleMesh(mesh,{tolerance});
  if(!validation.triangleCount||validation.boundaryEdges||validation.nonManifoldEdges||validation.inconsistentWindingEdges)throw new Error('Printability needs a closed, consistently wound mesh');
  const {points,triangles}=prepared(mesh),outward=validation.signedVolume<0?-1:1,bed=validation.bounds.min[2],eps=tolerance*10;
  // 0.1° of slack: a tessellated face at exactly the limit (a 45° chamfer or teardrop) is not an overhang.
  const limit=-Math.sin((overhangAngle+0.1)*Math.PI/180), tris=[], faces=[];
  for(let i=0;i<triangles.length;i+=3){
    const tri=[points[triangles[i]],points[triangles[i+1]],points[triangles[i+2]]],n=cross(sub(tri[1],tri[0]),sub(tri[2],tri[0])),length=Math.hypot(...n);
    if(length<=tolerance*tolerance)continue;
    tris.push(tri);faces.push({tri,area:length/2,normal:n.map(v=>v*outward/length)});
  }
  const grow=(box,tri)=>{for(const p of tri)for(let k=0;k<3;k++){box.min[k]=Math.min(box.min[k],p[k]);box.max[k]=Math.max(box.max[k],p[k]);}};
  const emptyBox=()=>({min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]});
  let surfaceArea=0,overhangArea=0,overhangTriangles=0,baseOverhangArea=0,bedContactArea=0,worstOverhangAngle=null,thinWallArea=0,thinWallTriangles=0,thinnestWall=null;
  const overhangBox=emptyBox(),thinBox=emptyBox(),thinSamples=[],budget={tests:maxRayTests};
  const hierarchy=minWall===undefined?null:boundingHierarchy(tris);
  for(const {tri,area,normal} of faces){
    surfaceArea+=area;
    const onBed=tri.every(p=>p[2]-bed<=eps);
    if(onBed&&normal[2]< -0.999)bedContactArea+=area;
    if(normal[2]<limit&&!onBed){
      // Downward faces within baseZone of the bed are a base fillet or chamfer that the first layers carry.
      if(Math.max(...tri.map(p=>p[2]))-bed<=baseZone)baseOverhangArea+=area;
      else{overhangArea+=area;overhangTriangles++;grow(overhangBox,tri);worstOverhangAngle=Math.max(worstOverhangAngle??0,Math.asin(Math.min(1,-normal[2]))*180/Math.PI);}
    }
    if(!hierarchy)continue;
    const center=tri[0].map((v,k)=>(v+tri[1][k]+tri[2][k])/3),inward=normal.map(v=>-v);let hits=0;
    for(const point of [center,...tri.map(p=>p.map((v,k)=>(v+center[k])/2))]){
      const thickness=nearestHit(hierarchy,point,inward,minWall,eps,budget);
      if(thickness===null)continue;
      hits++;thinnestWall=Math.min(thinnestWall??Infinity,thickness);thinSamples.push({point,thickness});
    }
    if(hits){thinWallArea+=area*hits/4;grow(thinBox,tri);if(hits>=2)thinWallTriangles++;}
  }
  thinSamples.sort((a,b)=>a.thickness-b.thickness);
  const [width,depth,height]=validation.bounds.dimensions;
  return {source:'generated triangle mesh',buildDirection:'+Z',bedZ:bed,overhangAngle,surfaceArea,overhangArea,overhangTriangles,overhangBounds:overhangTriangles?overhangBox:null,
    worstOverhangAngle,highestOverhangAboveBed:overhangTriangles?overhangBox.max[2]-bed:null,baseZone,baseOverhangArea,bedContactArea,
    slenderness:height/Math.max(Math.min(width,depth),tolerance),thinnestDimension:Math.min(width,depth,height),
    ...(hierarchy?{minWall,thinWallArea,thinWallTriangles,thinnestWall,thinWallBounds:thinWallArea?thinBox:null,thinnestSamples:thinSamples.slice(0,5),rayTests:maxRayTests-budget.tests}:{}),
    limitations:['Assumes printing along world +Z with the bed at the lowest Z; inspect the intended print pose.','Overhangs use per-triangle normals; bridges, chamfered support and slicer settings are not modelled.','Slenderness and thinnest dimension use the axis-aligned bounds; a part lying diagonally reads wider than it is.',
      ...(hierarchy?['Thin walls are probed at four points per triangle along the inward normal; walls thinner than minWall between probes or measured obliquely can be missed.']:[]),'Does not certify printability, strength or slicer success.']};
}

// Column-major rotation turning unit direction d onto -Z (the bed).
function rotationToBed(d) {
  const c=-d[2];
  if(c>1-1e-9)return [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
  if(c<-1+1e-9)return [1,0,0,0,0,-1,0,0,0,0,-1,0,0,0,0,1];
  const [x,y,z]=cross(d,[0,0,-1]),k=1/(1+c);
  const r=[[1-k*(y*y+z*z),-z+k*x*y,y+k*x*z],[z+k*x*y,1-k*(x*x+z*z),-x+k*y*z],[-y+k*x*z,x+k*y*z,1-k*(x*x+y*y)]];
  return [r[0][0],r[1][0],r[2][0],0,r[0][1],r[1][1],r[2][1],0,r[0][2],r[1][2],r[2][2],0,0,0,0,1];
}

/** Read-only print pose candidates: the six axis directions and the largest flat faces, each laid on the bed. */
export function rankPrintOrientations(mesh, { overhangAngle=45, baseZone=1, tolerance=1e-5, faces=6 } = {}) {
  tolerance=toleranceOf(tolerance);
  const validation=inspectTriangleMesh(mesh,{tolerance});
  if(!validation.triangleCount||validation.boundaryEdges||validation.nonManifoldEdges||validation.inconsistentWindingEdges)throw new Error('Print orientation needs a closed, consistently wound mesh');
  const {points,triangles}=prepared(mesh),outward=validation.signedVolume<0?-1:1;
  const candidates=[[0,0,-1],[0,0,1],[1,0,0],[-1,0,0],[0,1,0],[0,-1,0]].map(down=>({down,source:'axis'})),flats=new Map();
  for(let i=0;i<triangles.length;i+=3){
    const a=points[triangles[i]],n=cross(sub(points[triangles[i+1]],a),sub(points[triangles[i+2]],a)),length=Math.hypot(...n);
    if(length<=tolerance*tolerance)continue;
    const normal=n.map(v=>v*outward/length),key=normal.map(v=>Math.round(v*50)).join(),entry=flats.get(key)||{normal,area:0};
    entry.area+=length/2;flats.set(key,entry);
  }
  for(const {normal,area} of [...flats.values()].sort((p,q)=>q.area-p.area).slice(0,faces))
    if(!candidates.some(({down})=>dot(down,normal)>0.999))candidates.push({down:normal,source:'flat face',faceArea:area});
  const vertices=points.flat();
  const ranked=candidates.map(({down,source,faceArea})=>{
    const matrix=rotationToBed(down),measured=inspectPrintability({vertices,triangles,matrix},{overhangAngle,baseZone,tolerance});
    const heights=points.map(p=>matrix[2]*p[0]+matrix[6]*p[1]+matrix[10]*p[2]);
    return {down,source,...(faceArea?{faceArea}:{}),rotation:matrix,current:dot(down,[0,0,-1])>0.999,overhangArea:measured.overhangArea,baseOverhangArea:measured.baseOverhangArea,
      bedContactArea:measured.bedContactArea,height:Math.max(...heights)-Math.min(...heights),slenderness:measured.slenderness};
  }).sort((p,q)=>p.overhangArea-q.overhangArea||q.bedContactArea-p.bedContactArea||p.height-q.height);
  return {source:'generated triangle mesh',overhangAngle,baseZone,candidates:ranked,
    limitations:['Ranks by unsupported overhang area, then bed contact, then height; strength along layers, surface finish and support removal are not scored.','rotation is a column-major matrix about the world origin; the candidate is evaluated as if dropped onto the bed and does not change the document.','Thin walls are not re-probed per orientation.']};
}

/** Native signatures are body-local. This helper deliberately accepts data predicates only. */
export function selectGeometry(selectors, { kind, predicate={}, expectedFingerprint, currentFingerprint } = {}) {
  if(!expectedFingerprint||expectedFingerprint!==currentFingerprint)throw new Error('Stale or missing geometry fingerprint');
  kind = kind === 'edge' ? 'edges' : kind === 'face' ? 'faces' : kind;
  if(!['edges','faces'].includes(kind)||!Array.isArray(selectors?.[kind])||selectors[kind].length>512)throw new Error('Invalid or excessive geometry selectors');
  if(Object.keys(predicate).some(k=>!['type','extreme','axis','coordinate','tolerance','near','unique','external','radius','normal'].includes(k)))throw new Error('Unsupported semantic predicate');
  const tolerance=toleranceOf(predicate.tolerance);
  const ax=axisOf(predicate.axis||'z');
  if(predicate.extreme&&!['min','max'].includes(predicate.extreme))throw new Error('extreme must be min or max');
  if(predicate.coordinate!==undefined&&!Number.isFinite(predicate.coordinate))throw new Error('coordinate must be finite');
  if(predicate.near!==undefined&&(!Array.isArray(predicate.near)||predicate.near.length!==3||!predicate.near.every(Number.isFinite)))throw new Error('near must contain three finite coordinates');
  let candidates=selectors[kind].filter(s=>(!predicate.type||s.t===predicate.type));
  if(predicate.external!==undefined){if(typeof predicate.external!=='boolean')throw new Error('external must be boolean');candidates=candidates.filter(s=>s.ext===predicate.external);}
  if(predicate.radius!==undefined){if(!Number.isFinite(predicate.radius)||predicate.radius<=0)throw new Error('radius must be positive');candidates=candidates.filter(s=>Number.isFinite(s.r)&&Math.abs(s.r-predicate.radius)<=tolerance);}
  if(predicate.normal!==undefined){if(!Array.isArray(predicate.normal)||predicate.normal.length!==3||!predicate.normal.every(Number.isFinite)||Math.hypot(...predicate.normal)<1e-9)throw new Error('normal must be a nonzero finite vector');const norm=predicate.normal.map(v=>v/Math.hypot(...predicate.normal));candidates=candidates.filter(s=>s.t==='PLANE'&&Array.isArray(s.n)&&distance(s.n,norm)<=tolerance);}
  const center=s=>s.c||s.m;
  if(predicate.near)candidates=candidates.filter(s=>center(s)&&distance(center(s),predicate.near)<=tolerance);
  if(predicate.coordinate!==undefined)candidates=candidates.filter(s=>center(s)&&Math.abs(center(s)[ax]-predicate.coordinate)<=tolerance);
  if(predicate.extreme){const valid=candidates.filter(s=>center(s)&&Number.isFinite(center(s)[ax]));const limit=predicate.extreme==='max'?Math.max(...valid.map(s=>center(s)[ax])):Math.min(...valid.map(s=>center(s)[ax]));candidates=valid.filter(s=>Math.abs(center(s)[ax]-limit)<=tolerance);}
  return {status:selectors.truncated?'incomplete':candidates.length===1?'selected':candidates.length?'ambiguous':'not_found',selected:!selectors.truncated&&candidates.length===1?candidates[0]:null,candidates,fingerprint:currentFingerprint,coordinateSpace:'body-local',limitations:['Selection compares existing native signature centers or midpoints; it does not infer design intent.']};
}
