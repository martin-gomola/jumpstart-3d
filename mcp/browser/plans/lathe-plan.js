import { buildLathePiece } from '../../../src/latheGeometry.js';
import { packMesh, toB64, fromB64, contentId } from '../../../src/meshimport.js';

const IDENTITY = [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
const fail = message => { throw new Error(`Lathe plan: ${message}`); };
function number(value, label, min, max) {
  if (!Number.isFinite(value) || value < min || value > max) fail(`${label} must be between ${min} and ${max}`);
  return value;
}
function keys(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${label}.${key} is unsupported`);
}
export function validateLathePlan(input) {
  keys(input,['name','blank','profile','hollow','scale'],'plan');
  const name = input.name ?? 'Turned part';
  if (typeof name !== 'string' || !name.trim() || name.length > 120) fail('name must contain 1 to 120 characters');
  keys(input.blank,['kind','length','side','diameter'],'blank');
  const blank = input.blank, length = number(blank.length,'blank.length',10,500);
  if (!['square','round'].includes(blank.kind)) fail('blank.kind must be square or round');
  const size = number(blank.kind === 'square' ? blank.side : blank.diameter,'blank size',2,250);
  if ((blank.kind === 'square' && blank.diameter !== undefined) || (blank.kind === 'round' && blank.side !== undefined)) fail('blank dimensions do not match its kind');
  if (!Array.isArray(input.profile) || input.profile.length < 2 || input.profile.length > 128) fail('profile needs 2 to 128 axial mm / radius pairs');
  let previous = -1;
  const profile = input.profile.map((point,i) => {
    if (!Array.isArray(point) || point.length !== 2) fail(`profile[${i}] must be [axialMm,radius]`);
    const x=number(point[0],'profile axial position',0,length), radius=number(point[1],'profile radius',0.5,size/2);
    if (x <= previous) fail('profile axial positions must strictly increase');
    previous=x; return [x,radius];
  });
  if (profile[0][0] !== 0 || profile.at(-1)[0] !== length) fail('profile must span the entire blank from 0 to its length');
  let hollow;
  if (input.hollow !== undefined) {
    keys(input.hollow,['wall','base','end','style'],'hollow');
    hollow={wall:number(input.hollow.wall,'wall',0.4,size/2-0.8),base:number(input.hollow.base,'base',0.4,length-1),end:input.hollow.end ?? 'tail',style:input.hollow.style ?? 'follow'};
    if (!['tail','head'].includes(hollow.end) || !['follow','straight'].includes(hollow.style)) fail('unsupported hollow end or style');
    // A stopped cavity is ambiguous for an agent: require clearance throughout its intended depth.
    for (const [x,r] of profile) if ((hollow.end === 'tail' ? x >= hollow.base : x <= length-hollow.base) && r-hollow.wall < 0.8) fail('profile is too narrow for the requested hollow wall');
  }
  return {name,blank:{kind:blank.kind,length,...(blank.kind==='square'?{side:size}:{diameter:size})},profile,...(hollow?{hollow}:{}),scale:number(input.scale ?? 1,'scale',0.01,10)};
}

export function buildLathePlanMesh(input) {
  const plan=validateLathePlan(input), L=plan.blank.length;
  const N=Math.max(60,Math.min(520,Math.ceil(L/0.35)+1)), du=L/(N-1), A=96, radii=new Float32Array(N*A);
  const R=(plan.blank.side ?? plan.blank.diameter)/2;
  let segment=0;
  for(let i=0;i<N;i++) {
    const u=i*du;
    while(segment<plan.profile.length-2 && u>plan.profile[segment+1][0]) segment++;
    const [x0,r0]=plan.profile[segment], [x1,r1]=plan.profile[segment+1], radius=r0+(r1-r0)*(u-x0)/(x1-x0);
    for(let j=0;j<A;j++) { const t=2*Math.PI*j/A, blankRadius=plan.blank.kind==='square'?R/Math.max(Math.abs(Math.cos(t)),Math.abs(Math.sin(t))):R; radii[i*A+j]=Math.min(blankRadius,radius); }
  }
  const mesh=buildLathePiece({N,du,u0:0,L,r:radii},{a:0,b:N-1},plan.hollow?{...plan.hollow,on:true}:null);
  if(plan.hollow && !mesh.hollow) fail('native Lathe could not create the requested cavity');
  if(mesh.I.length/3>15000) fail('mesh exceeds 15000 triangles');
  // Native lathe coordinates (axial, radial X, radial Y) to upright world Z.
  for(let k=0;k<mesh.V.length;k+=3) { const axial=mesh.V[k], x=mesh.V[k+1], y=mesh.V[k+2]; mesh.V[k]=x; mesh.V[k+1]=y; mesh.V[k+2]=axial; }
  return {plan,mesh,sampling:{axialStepMm:du}};
}
function fingerprint(body) { return JSON.stringify({node:body.node,m:body.m,turned:body.turned}); }
export function compileLathePlan({document,plan:input,bodyId,idFactory = prefix => prefix+crypto.randomUUID().replaceAll('-','')}) {
  const {plan,mesh,sampling}=buildLathePlanMesh(input), doc=structuredClone(document);
  const previous=bodyId?doc.bodies.find(body=>body.id===bodyId):null;
  if(bodyId && (!previous || previous.locked || previous.lock || previous.node.t!=='mesh' || !previous.mcpLathe)) fail('revision requires an unlocked MCP Lathe mesh');
  if(previous && (!doc.assets?.[previous.node.asset]?.data || contentId(fromB64(doc.assets[previous.node.asset].data)) !== previous.node.asset)) fail('body mesh asset changed outside its Lathe recipe');
  if(previous && previous.mcpLathe.fingerprint!==fingerprint(previous)) fail('body changed outside its Lathe recipe; preview a new model instead');
  if(!previous && doc.bodies.length>=128) fail('document body limit exceeded');
  const bytes=packMesh(mesh), asset=contentId(bytes);
  doc.assets ??={}; doc.assets[asset]={kind:'mesh',name:plan.name,data:toB64(bytes)};
  doc.name=plan.name;
  doc.seq ??=0;
  const mods=plan.scale!==1?[{id:idFactory('f'),seq:++doc.seq,t:'scale',k:[plan.scale,plan.scale,plan.scale],o:[0,0,0]}]:[];
  const body={id:previous?.id ?? idFactory('b'),name:plan.name,seq:previous?.seq ?? ++doc.seq,color:previous?.color ?? '#9fb1c4',hole:false,hidden:false,m:IDENTITY.slice(),node:{t:'mesh',asset,keepPos:true,mods},turned:{hollow:mesh.hollow}};
  if(previous?.role !== undefined) body.role=previous.role;
  body.mcpLathe={version:1,plan,sampling,fingerprint:fingerprint(body)};
  if(previous) doc.bodies[doc.bodies.indexOf(previous)]=body; else doc.bodies.push(body);
  if(previous && previous.node.asset !== asset) {
    const oldAsset=previous.node.asset;
    let referenced=false;
    JSON.stringify(doc.bodies,(key,value)=>{if(key==='asset' && value===oldAsset) referenced=true;return value;});
    if(!referenced) delete doc.assets[oldAsset];
  }
  return {document:doc,plan,createdBodyIds:previous?[]:[body.id],affectedBodyIds:[body.id],featureBodyIds:{},warnings:['Native Lathe output is a mesh with an editable MCP recipe, not a sketch feature tree.',`Native hollow bottom positions are quantized to axial slices of ${sampling.axialStepMm} mm before scaling; inspect actual thickness.`]};
}
