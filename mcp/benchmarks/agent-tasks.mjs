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
  { id:"edit-resize-hole",kind:"edit",targetName:"Mount plate",request:"In Mount plate, open both 4.0 mm through-holes to 4.5 mm so M4 screws pass freely. Keep their positions, the 60x40x5 plate, its identity and the companion body. Use a targeted feature edit, independent old/new hole-wall samples, preview/apply, save/reopen, targeted STL export and undo.",startingDocument:"Mount plate 60x40x5 (centred, Z 0-5) with one native simple through-hole feature, diameter 4, at (-20,0) and (20,0), plus an unrelated companion body.",dimensions:{x:60,y:40,z:5},field:{kind:"hole",key:"dia",expected:4.5},baselineSamples:[{id:"baseline-hole-wall",axis:"Z",point:[22.1,0,-1],intervals:[[0,5]]}],samples:[{id:"right-hole-opened",axis:"Z",point:[22.1,0,-1],intervals:[]},{id:"left-hole-opened",axis:"Z",point:[-22.1,0,-1],intervals:[]},{id:"plate-intact",axis:"Z",point:[0,0,-1],intervals:[[0,5]]}] },
  { id:"edit-add-chamfer",kind:"edit",targetName:"Mount plate",request:"Add a 1 mm chamfer to the four top outside edges of Mount plate so it is not sharp. Keep the holes, the 60x40x5 envelope, its identity and the companion body. Add a native chamfer to the existing body with an edit intent, measure old/new edge samples, preview/apply, save/reopen, targeted STL export and undo.",startingDocument:"Mount plate 60x40x5 (centred, Z 0-5) with one native simple through-hole feature, diameter 4, at (-20,0) and (20,0), plus an unrelated companion body.",dimensions:{x:60,y:40,z:5},addedKind:"chamfer",previewTools:["jumpstart_preview_model","jumpstart_preview_feature_edit"],baselineSamples:[{id:"baseline-edge",axis:"Z",point:[29.6,0,-1],intervals:[[0,5]]}],samples:[{id:"chamfer-x-edge",axis:"Z",point:[29.6,0,-1],intervals:[[0,4.4]]},{id:"chamfer-y-edge",axis:"Z",point:[0,19.6,-1],intervals:[[0,4.4]]}] },
  // Printed parts for the default X2D profile. `grader` probes run at the candidate checkpoint
  // and are never shown to the agent; mcp/tests/agent-calibration-*.browser.mjs calibrate each one.
  {
    id: "wall-bracket",
    request: "Design an editable L-shaped shelf bracket in PLA for my Bambu Lab X2D (0.4 mm nozzle). Legs 80 mm (wall side) and 60 mm (shelf side), 5 mm thick, 40 mm wide, with a 10 mm fillet in the inside corner. Add two countersunk holes for 4 mm wood screws in the wall leg: 4.5 mm through, 90 degree countersink 9 mm across, centred across the width at 30 mm and 65 mm from the outer corner. The screw heads sit on the inside face of the wall leg. Model it in print pose lying on its side: outer corner at the origin, wall leg along +Y on X 0-5 (wall face on X=0), shelf leg along +X on Y 0-5, width from Z=0 to Z=40. Preview, check printability, apply, export STL and undo.",
    startingDocument: "A fresh empty document.",
    dimensions: { x: 60, y: 80, z: 40 },
    grader: [{ id: "bracket", samples: [
      { id: "hole-low-open", axis: "X", point: [0, 30, 20], intervals: [] },
      { id: "hole-high-open", axis: "X", point: [0, 65, 20], intervals: [] },
      { id: "countersink-inside-face", axis: "X", point: [0, 33.5, 20], intervals: [[0, 4]], tolerance: 0.1 },
      { id: "solid-wall-leg", axis: "X", point: [0, 50, 20], intervals: [[0, 5]] },
      { id: "inner-fillet", axis: "X", point: [0, 8, 20], intervals: [[0, 7.859]], tolerance: 0.1 },
    ], checks: [
      { id: "one-piece", kind: "components", expected: 1 },
      { id: "print", kind: "printability", overhangAngle: 45, maxOverhangArea: 40, minWall: 1.2, maxThinWallArea: 5 },
    ] }],
    nativeMods: [{ t: "hole", kind: "csink" }],
    requires: ["images", "grader", "native-mods", "undo"],
  },
  {
    id: "box-friction-lid",
    request: "Make a small storage box with a friction-fit lid as two separate printable bodies named Box and Lid. Box: 80 x 60 x 40 mm outside, 2 mm walls and floor, open top, centred on the origin with its floor on Z=0. Lid: an 80 x 60 x 2 mm top plate with a 3 mm deep, 1.6 mm thick locating lip that drops inside the box with 0.2 mm clearance per side. Make the per-side clearance a named parameter. Leave the lid assembled on the rim so the fit can be measured; I will flip it in Bambu Studio. Verify the lid does not overlap the box, preview, apply, save and reopen, export STL and undo.",
    startingDocument: "A fresh empty document.",
    bodies: 2,
    dimensions: { x: 80, y: 60, z: 42 },
    grader: [
      { id: "box", body: "Box", samples: [
        { id: "walls-x", axis: "X", point: [0, 0, 38.5], intervals: [[-40, -38], [38, 40]] },
        { id: "walls-y", axis: "Y", point: [0, 0, 38.5], intervals: [[-30, -28], [28, 30]] },
        { id: "floor", axis: "Z", point: [0, 0, -1], intervals: [[0, 2]] },
      ], checks: [
        { id: "one-piece", kind: "components", expected: 1 },
        { id: "print", kind: "printability", maxOverhangArea: 0, minWall: 1.8 },
      ] },
      { id: "lid", body: "Lid", samples: [
        { id: "lip-x", axis: "X", point: [0, 0, 38.5], intervals: [[-37.8, -36.2], [36.2, 37.8]] },
        { id: "lip-y", axis: "Y", point: [0, 0, 38.5], intervals: [[-27.8, -26.2], [26.2, 27.8]] },
        { id: "plate", axis: "Z", point: [0, 0, -1], intervals: [[40, 42]] },
      ], checks: [{ id: "one-piece", kind: "components", expected: 1 }] },
      { id: "no-overlap", body: "Box", against: "Lid", pairChecks: { maximumOverlapVolume: 0 } },
    ],
    requires: ["images", "parameters", "reopen", "grader", "undo"],
  },
  {
    id: "snap-hook",
    request: "Design a cantilever snap-fit hook. Base block 10 x 8 mm, beam 1.6 mm thick and 15 mm long, hook lip 1 mm deep with a flat retention face and a 30 degree lead-in (from the beam axis) at the free end, 0.8 mm fillet where the beam meets the base, 6 mm wide overall. Print it on its side so layers run along the beam: profile in the XY plane extruded Z=0 to 6; base X 0-10, Y 0-8; beam along +Y on X 0-1.6 up to Y=23; hook protruding toward -X with its retention face at Y=20. Check printability, preview, apply, export STL and undo.",
    startingDocument: "A fresh empty document.",
    dimensions: { x: 11, y: 23, z: 6 },
    grader: [{ id: "hook", samples: [
      { id: "base", axis: "X", point: [0, 4, 3], intervals: [[0, 10]] },
      { id: "beam", axis: "X", point: [0, 15, 3], intervals: [[0, 1.6]] },
      { id: "hook-lip", axis: "X", point: [0, 20.5, 3], intervals: [[-1, 1.6]] },
      { id: "lead-in", axis: "X", point: [0, 22, 3], intervals: [[-0.577, 1.6]], tolerance: 0.1 },
      { id: "root-fillet", axis: "X", point: [0, 8.3, 3], intervals: [[0, 1.776]], tolerance: 0.1 },
    ], checks: [
      { id: "one-piece", kind: "components", expected: 1 },
      { id: "print", kind: "printability", maxOverhangArea: 0, minWall: 1.2, maxThinWallArea: 1 },
    ] }],
    requires: ["images", "grader", "undo"],
  },
  {
    id: "gridfinity-bin-1x1",
    request: "Make a Gridfinity 1x1 bin, 3 units tall, with the standard stacking lip, 1.2 mm walls and floor, no magnets and no dividers, for PLA on my X2D. Standard footprint centred on the origin, base on Z=0. Preview, check printability, apply, export STL and undo.",
    startingDocument: "A fresh empty document.",
    dimensions: { x: 41.5, y: 41.5, z: 25.4 },
    grader: [{ id: "bin", samples: [
      { id: "walls", axis: "X", point: [0, 0, 15], intervals: [[-20.75, -19.55], [19.55, 20.75]] },
    ], checks: [
      { id: "one-piece", kind: "components", expected: 1 },
      { id: "print", kind: "printability", overhangAngle: 50, maxOverhangArea: 2 },
    ] }],
    requires: ["images", "grader", "undo"],
  },
  {
    id: "cable-clip",
    request: "Design a screw-down clip for a 6.5 mm round cable: ring inner diameter 6.6 mm, 1.6 mm ring wall, and a 5.2 mm wide snap-in opening cut straight up from the ring centre. Mounting tab 20 x 2 mm, clip 8 mm wide, with two 3.5 mm screw holes through the tab 7 mm either side of centre. Print it on its side: profile in XY extruded Z=0 to 8, tab on Y 0-2 spanning X -10 to 10, ring centre at (0, 6.5). Preview, check printability, apply, export STL and undo.",
    startingDocument: "A fresh empty document.",
    dimensions: { x: 20, y: 10.653, z: 8 },
    grader: [{ id: "clip", samples: [
      { id: "ring-sides", axis: "X", point: [0, 6, 4], intervals: [[-4.874, -3.262], [3.262, 4.874]], tolerance: 0.1 },
      { id: "opening", axis: "X", point: [0, 9.5, 4], intervals: [[-3.874, -2.6], [2.6, 3.874]], tolerance: 0.1 },
      { id: "base", axis: "Y", point: [0, 0, 4], intervals: [[0, 3.2]], tolerance: 0.1 },
      { id: "screw-hole", axis: "Y", point: [7, 0, 4], intervals: [] },
      { id: "tab", axis: "Y", point: [7, 0, 6.8], intervals: [[0, 2]] },
    ], checks: [
      { id: "one-piece", kind: "components", expected: 1 },
      { id: "print", kind: "printability", maxOverhangArea: 20, minWall: 1.2, maxThinWallArea: 40 },
    ] }],
    requires: ["images", "grader", "undo"],
  },
  {
    id: "knob-d-shaft",
    request: "Make a knurled knob for a potentiometer with a 6 mm D-shaft (4.5 mm across the flat). Knob 30 mm diameter, 15 mm tall, 30 straight grip grooves. Blind D bore 10 mm deep with 0.15 mm clearance per side: bore radius 3.15 mm, flat 1.65 mm from the axis, flat facing +X. Model it in print pose with the top face on the bed and the bore opening facing +Z: axis on Z through the origin, Z 0-15. Preview, check printability, apply, export STL and undo.",
    startingDocument: "A fresh empty document.",
    dimensions: { z: 15 },
    grader: [{ id: "knob", samples: [
      { id: "inside-round", axis: "Z", point: [-2.5, 0, -1], intervals: [[0, 5]] },
      { id: "inside-near-flat", axis: "Z", point: [1.4, 0, -1], intervals: [[0, 5]] },
      { id: "beyond-flat", axis: "Z", point: [1.9, 0, -1], intervals: [[0, 15]] },
      { id: "beside-bore", axis: "Z", point: [0, 3.4, -1], intervals: [[0, 15]] },
    ], checks: [
      { id: "diameter", kind: "dimension", axis: "X", expected: 30, tolerance: 0.3 },
      { id: "one-piece", kind: "components", expected: 1 },
      { id: "print", kind: "printability", maxOverhangArea: 0, minWall: 1 },
    ] }],
    requires: ["images", "grader", "undo"],
  },
  {
    id: "leg-cap",
    request: "I need a replacement cap for a 22 mm square furniture leg. Outside 26 x 26 x 18 mm, a 22.4 x 22.4 mm socket 15 mm deep (3 mm floor), 2 mm radius on the four vertical outside edges and a 1 mm chamfer around the bottom outside edge. Print floor-down: centred on the origin, floor on Z=0, socket opening at the top. Preview, check printability, apply, save and reopen, export STL and undo.",
    startingDocument: "A fresh empty document.",
    dimensions: { x: 26, y: 26, z: 18 },
    grader: [{ id: "cap", samples: [
      { id: "walls", axis: "X", point: [0, 0, 10], intervals: [[-13, -11.2], [11.2, 13]] },
      { id: "floor", axis: "Z", point: [0, 0, -1], intervals: [[0, 3]] },
      { id: "bottom-chamfer", axis: "Z", point: [12.6, 0, -1], intervals: [[0.6, 18]] },
      { id: "corner-radius", axis: "X", point: [0, 12, 10], intervals: [[-12.732, 12.732]], tolerance: 0.1 },
    ], checks: [
      { id: "one-piece", kind: "components", expected: 1 },
      { id: "print", kind: "printability", maxOverhangArea: 0, minWall: 1.6 },
    ] }],
    nativeMods: [{ t: "fillet" }, { t: "chamfer" }],
    requires: ["images", "reopen", "grader", "native-mods", "undo"],
  },
  {
    id: "phone-stand-65deg",
    request: "Design a desk phone stand that holds a phone (with case, up to 12 mm thick) at 65 degrees from horizontal. 75 mm wide, 90 mm deep, 6 mm base. A front lip 4 mm thick and 16 mm tall stops the phone sliding; the phone sits in a 12 mm slot between the lip and a back support whose front face rises at 65 degrees from the slot's back edge to 80 mm above the base. Print it on its side: profile in XY with X front-to-back from the front of the lip at X=0 and Y up from the base bottom, extruded Z=0 to 75. Check printability, preview, apply, export STL and undo.",
    startingDocument: "A fresh empty document.",
    dimensions: { x: 90, y: 86, z: 75 },
    grader: [{ id: "stand", samples: [
      { id: "lip-and-slot", axis: "X", point: [0, 10, 37.5], starts: [0, 17.865], ends: [4], tolerance: 0.1 },
      { id: "support-low", axis: "X", point: [0, 30, 37.5], starts: [27.191], tolerance: 0.1 },
      { id: "support-high", axis: "X", point: [0, 70, 37.5], starts: [45.844], tolerance: 0.1 },
    ], checks: [
      { id: "one-piece", kind: "components", expected: 1 },
      { id: "print", kind: "printability", maxOverhangArea: 0, minWall: 2 },
    ] }],
    requires: ["images", "grader", "undo"],
  },
  {
    id: "print-in-place-hinge",
    request: "Design a print-in-place hinge as two separate bodies named Leaf A and Leaf B that print assembled and rotate afterwards. Hinge axis along X at Y=0, Z=3; 40 mm long; each leaf 25 mm wide from the axis and 2.4 mm thick lying on Z=0. Three 6 mm knuckles: Leaf A owns X 0-12.8 and 27.2-40 plus a 3 mm pin through all three; Leaf B owns the middle knuckle X 13.2-26.8 with a 3.8 mm bore. Nothing may touch or fuse: keep at least 0.35 mm between the leaves everywhere. Verify clearance, preview, apply, export STL and undo.",
    startingDocument: "A fresh empty document.",
    bodies: 2,
    dimensions: { x: 40, y: 50, z: 6 },
    grader: [
      { id: "leaf-a", body: "Leaf A", samples: [
        { id: "pin", axis: "Z", point: [20, 0, -1], intervals: [[1.5, 4.5]] },
        { id: "outer-knuckles", axis: "X", point: [0, 0, 5.5], intervals: [[0, 12.8], [27.2, 40]] },
      ], checks: [
        { id: "one-piece", kind: "components", expected: 1 },
        { id: "print", kind: "printability", maxOverhangArea: 100 },
      ] },
      { id: "leaf-b", body: "Leaf B", samples: [
        { id: "bore", axis: "Z", point: [20, 0, -1], intervals: [[0, 1.1], [4.9, 6]] },
        { id: "middle-knuckle", axis: "X", point: [0, 0, 5.5], intervals: [[13.2, 26.8]] },
      ], checks: [{ id: "one-piece", kind: "components", expected: 1 }] },
      { id: "clearance", body: "Leaf A", against: "Leaf B", pairChecks: { minimumClearance: 0.35, maximumOverlapVolume: 0 } },
    ],
    requires: ["images", "grader", "undo"],
  },
  {
    id: "heat-set-bosses",
    request: "Make an electronics base plate 60 x 40 x 3 mm with four standoffs for M3 heat-set inserts. Standoffs 7 mm diameter, 8 mm tall above the plate, centred at (+-22, +-12). Each gets a 4.0 mm insert hole 6 mm deep from the top (inserts are 5.7 mm long), solid below. Centred on the origin, plate bottom on Z=0. Check walls and printability, preview, apply, export STL and undo.",
    startingDocument: "A fresh empty document.",
    dimensions: { x: 60, y: 40, z: 11 },
    grader: [{ id: "plate", samples: [
      { id: "hole-depth", axis: "Z", point: [22, 12, -1], intervals: [[0, 5]] },
      { id: "hole-depth-opposite", axis: "Z", point: [-22, -12, -1], intervals: [[0, 5]] },
      { id: "boss-walls", axis: "X", point: [0, 12, 8], intervals: [[-25.5, -24], [-20, -18.5], [18.5, 20], [24, 25.5]], tolerance: 0.1 },
      { id: "plate", axis: "Z", point: [0, 0, -1], intervals: [[0, 3]] },
    ], checks: [
      { id: "one-piece", kind: "components", expected: 1 },
      { id: "print", kind: "printability", maxOverhangArea: 0, minWall: 1.4 },
    ] }],
    nativeMods: [{ t: "hole" }],
    requires: ["images", "grader", "native-mods", "undo"],
  },
  {
    id: "name-plate",
    request: "Make a door sign 80 x 25 x 3 mm with 3 mm rounded corners and the word WORKSHOP raised 1 mm in 8 mm tall letters, centred. Add two 3.5 mm screw holes at X = +-36 on the centreline. Centred on the origin, back on Z=0. Preview, check printability, apply, export STL and undo.",
    startingDocument: "A fresh empty document.",
    dimensions: { x: 80, y: 25, z: 4 },
    grader: [{ id: "sign", samples: [
      { id: "hole-right", axis: "Z", point: [36, 0, -1], intervals: [] },
      { id: "hole-left", axis: "Z", point: [-36, 0, -1], intervals: [] },
      { id: "plate-below-text", axis: "Z", point: [0, -10, -1], intervals: [[0, 3]] },
    ], checks: [
      { id: "one-piece", kind: "components", expected: 1 },
      { id: "print", kind: "printability", maxOverhangArea: 0, minWall: 0.8, maxThinWallArea: 4 },
    ] }],
    nativeMods: [{ t: "emboss", str: "WORKSHOP" }],
    requires: ["images", "grader", "native-mods", "undo"],
  },
  {
    id: "nut-trap-block",
    request: "Make a 30 x 30 x 15 mm clamp block with a captive M5 nut: a hex pocket 8.2 mm across flats and 4.2 mm deep in the top face, with two flats perpendicular to X, and a 5.4 mm clearance hole straight through. Centred on the origin, bottom on Z=0, pocket opening up for printing. Preview, check printability, apply, export STL and undo.",
    startingDocument: "A fresh empty document.",
    dimensions: { x: 30, y: 30, z: 15 },
    grader: [{ id: "block", samples: [
      { id: "pocket-flats", axis: "X", point: [0, 0, 13], intervals: [[-15, -4.1], [4.1, 15]] },
      { id: "pocket-corners", axis: "Y", point: [0.5, 0, 13], intervals: [[-15, -4.445], [4.445, 15]], tolerance: 0.1 },
      { id: "pocket-floor", axis: "Z", point: [3.5, 0, -1], intervals: [[0, 10.8]] },
      { id: "bore-open", axis: "Z", point: [0, 0, -1], intervals: [] },
      { id: "bore-diameter", axis: "X", point: [0, 0, 5], intervals: [[-15, -2.7], [2.7, 15]], tolerance: 0.1 },
    ], checks: [
      { id: "one-piece", kind: "components", expected: 1 },
      { id: "print", kind: "printability", maxOverhangArea: 0, minWall: 2 },
    ] }],
    requires: ["images", "grader", "undo"],
  },
  {
    id: "screw-cap-m30",
    request: "Make a screw-on cap for a printed M30 x 2 threaded neck: 36 mm outside diameter, 15 mm tall, 2 mm closed top, internal M30 x 2 thread over the remaining depth with 0.3 mm extra print clearance. Print top-down: axis on Z through the origin, top on Z=0, opening at Z=15. Preview, apply, export STL and undo; say plainly if the internal thread cannot be built or verified.",
    startingDocument: "A fresh empty document.",
    dimensions: { x: 36, y: 36, z: 15 },
    grader: [{ id: "cap", samples: [
      { id: "top", axis: "Z", point: [0, 0, -1], intervals: [[0, 2]] },
      { id: "outer-wall", axis: "X", point: [0, 0, 8], starts: [-18], tolerance: 0.1 },
    ], checks: [{ id: "one-piece", kind: "components", expected: 1 }] }],
    nativeMods: [{ t: "thread", pitch: 2 }],
    requires: ["images", "grader", "native-mods", "undo"],
  },
]);

export function agentTask(id) {
  const task = AGENT_TASKS.find((entry) => entry.id === id);
  if (!task) throw new Error(`Unknown task ${id}; choose ${AGENT_TASKS.map((entry) => entry.id).join(", ")}`);
  return task;
}
