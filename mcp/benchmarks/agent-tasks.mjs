// Requests only: deliberately contains no model plans or feature recipes.
export const AGENT_TASKS = Object.freeze([
  {
    id: "coaster-revision",
    request: "Starting with the existing tutorial coaster, change it to 110 mm diameter with nine evenly spaced drainage channels. Keep each channel 4 mm wide and 3 mm deep and preserve the existing floor thickness. Keep the channels symmetric and open at both ends. Preview before applying, inspect the resulting geometry, save and reopen it, export STL, exercise retry and stale-edit protection, and undo back to the original coaster.",
    startingDocument: "An existing tutorial coaster; begin must capture its original geometry and parameters.",
    dimensions: { x: 110, y: 110 },
    channelRequirements: { count: 9, width: 4, depth: 3, symmetric: true, openEnds: true, preserveFloor: true },
    requires: ["images", "parameters", "reopen", "undo", "retry", "stale", "channels"],
  },
  {
    id: "offset-tray",
    request: "Design an editable rectangular parts tray, 83 mm by 57 mm by 12 mm overall. Use a 2 mm floor and walls. Add one divider parallel to the short side, leaving clear compartment lengths of 25 mm and 52 mm. Keep it open at the top. Inspect the actual walls and floor, preview, apply, save and reopen, export STL, then undo. Ask for clarification if the dimensions are inconsistent.",
    startingDocument: "A fresh empty document.",
    dimensions: { x: 83, y: 57, z: 12 },
    requires: ["images", "parameters", "reopen", "undo", "tray-sections"],
  },
  {
    id: "reject-and-correct",
    request: "Make an editable 74 mm diameter coaster, 5 mm tall, with channels 8 mm deep and at least 2 mm of floor beneath them. First explain and reject that impossible combination without changing the document. Then use the corrected channel depth of 3 mm, create the model, inspect it, export STL, and undo.",
    startingDocument: "A fresh empty document.",
    dimensions: { x: 74, y: 74, z: 5 },
    requires: ["images", "undo", "rejected-request", "corrected-depth"],
  },
  { id:"edit-move-hole",kind:"edit",targetName:"Plate",request:"Move the existing single through-hole from X=-20 to X=20, Y=0 in Plate. Keep its 10 mm diameter, plate 80x60x10 mm, identity and companion bodies. Use a targeted feature edit, independent old/new hole samples, preview/apply, save/reopen, targeted STL export and undo.",startingDocument:"Plate 80x60x10 with a 10 mm through-hole at (-20,0), plus an unrelated companion body.",dimensions:{x:80,y:60,z:10},baselineSamples:[{id:"baseline-old-hole",axis:"Z",point:[-20,0,-1],intervals:[]},{id:"baseline-new-location",axis:"Z",point:[20,0,-1],intervals:[[0,10]]}],samples:[{id:"old-hole-filled",axis:"Z",point:[-20,0,-1],intervals:[[0,10]]},{id:"new-hole-open",axis:"Z",point:[20,0,-1],intervals:[]}] },
  { id:"edit-wall-thickness",kind:"edit",targetName:"Housing",request:"Change Housing's inward shell wall from 2 to 3 mm. Preserve its 80x60x30 outer envelope and all companion bodies. Independently measure 3 mm side walls and floor, preview/apply, save/reopen, targeted STL export and undo.",startingDocument:"An open-top 80x60x30 box with a native inward shell, wall/floor 2 mm, and one unrelated companion.",dimensions:{x:80,y:60,z:30},field:{kind:"shell",key:"th",expected:3},samples:[{id:"side-walls",axis:"X",point:[0,0,10],intervals:[[-40,-37],[37,40]]},{id:"floor",axis:"Z",point:[0,0,-1],intervals:[[0,3]]}] },
  { id:"edit-fillet-radius",kind:"edit",targetName:"Rounded block",request:"Change the existing vertical-edge fillet radius from 2 to 4 mm on Rounded block. Preserve the 60x40x20 envelope and companions. Use its feature id, measure native volume and mesh, preview/apply, save/reopen, targeted STL export and undo.",startingDocument:"A 60x40x20 box rounded only on its four vertical edges, plus an unrelated companion.",dimensions:{x:60,y:40,z:20},volume:(60*40-(4-Math.PI)*16)*20,field:{kind:"fillet",key:"r",expected:4} },
  { id:"edit-preserve-interface",kind:"edit",targetName:"Boss",request:"Extend Boss from 40 to 60 mm high, keeping its 40x30 footprint and exact material in the bottom 6 mm mounting interface. Preserve companion bodies. Attach a native region requirement and inspect the local before/after detail, preview/apply, save/reopen, targeted STL export and undo.",startingDocument:"A one-sided 40x30 native extrusion, 40 mm high, and a companion body.",dimensions:{x:40,y:30,z:60},volume:40*30*60,protectRegion:true,protectedBox:{min:[-20,-15,0],max:[20,15,6]} },
  { id:"edit-remove-feature",kind:"edit",targetName:"Rounded block",request:"Remove the existing vertical-edge fillet from Rounded block, retaining the independent 10 mm centre through-hole and all companion bodies. Preserve a native region around the bore, inspect the result, preview/apply, save/reopen, targeted STL export and undo.",startingDocument:"A 60x40x20 block, four vertical edges filleted radius 3, with an independent centre through-hole diameter 10, plus a companion body.",dimensions:{x:60,y:40,z:20},volume:60*40*20-Math.PI*25*20,removedKind:"fillet",protectRegion:true,protectedBox:{min:[-10,-10,0],max:[10,10,20]} },
  { id:"edit-reject-floor-breach",kind:"edit",targetName:"Plate",request:"Preview blind-hole depth 12 mm in the 10 mm Plate with a required preserved 2 mm bottom floor. Confirm failed acceptance is not applied. Correct to depth 8, preserve companions, independently inspect the 2 mm floor, apply, save/reopen, targeted STL export and undo.",startingDocument:"An 80x60x10 plate with a native blind-hole diameter 10, depth 5, plus a companion body.",dimensions:{x:80,y:60,z:10},field:{kind:"hole",key:"depth",expected:8},protectRegion:true,protectedBox:{min:[-40,-30,0],max:[40,30,2]},rejectedPreview:true,samples:[{id:"floor",axis:"Z",point:[0,0,-1],intervals:[[0,2]]}] },
]);

export function agentTask(id) {
  const task = AGENT_TASKS.find((entry) => entry.id === id);
  if (!task) throw new Error(`Unknown task ${id}; choose ${AGENT_TASKS.map((entry) => entry.id).join(", ")}`);
  return task;
}
