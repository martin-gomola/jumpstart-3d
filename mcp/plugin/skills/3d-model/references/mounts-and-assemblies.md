# Mounts and assemblies

## Assemble and mount imported parts

1. Describe each part's role and the intended relationship before transforming
   anything: which face mates, which direction hooks or clips point, what sits
   in front of or behind the board, and whether an existing mount stays or is
   replaced. If the user's reference or wording does not settle a critical
   orientation, ask before applying a transform.
2. When the editor is open at localhost and a browser screenshot tool is
   available, capture the full viewport if its current camera or visible part
   arrangement will help resolve the assembly. Use the screenshot only as visual
   context; use MCP document data for body identity and dimensions. Do not use
   browser UI actions to edit the model or bypass preview/apply.
3. Read each body's local dimensions, world bounds, and feature tree. Use
   geometry selectors where available to ground local features. Imported meshes
   are opaque geometry; do not assume a hook is a separate editable feature.
   Do not choose placement from bounding-box overlap alone.
4. Preview the assembly from the reference pose. Inspect a complete isometric
   view and a view from the mating side. Check that the retaining features face
   the board and the holder sits on the intended side. Use a board model and
   measured thickness/pitch for clearance checks where the available geometry
   tools support them. Without a board model or a supported clearance check,
   report board engagement and physical fit as unverified.
5. Distinguish a spatial assembly from a fused solid. A valid mesh check only
   establishes the mesh properties reported by the inspector; it does not prove
   contact, clearance, fit, or printability. If a boolean times out, do not
   describe two overlapping bodies as a fused or print-ready part. Explain the
   result and preview an alternative only when it still meets the user's stated
   assembly intent.
6. Before apply, confirm the document revision still matches the preview. If it
   changed, reread and summarize the current document. Treat changes not
   explained by your preview as user work: do not undo, replace, or save them
   until their intent is clear.
7. After apply, reread the document and inspect the final assembly. Save only
   when requested or already part of the agreed task.

## Classify assembly context

Keep phones, boards and cavity envelopes visible as `reference`; classify purchased
screws and nuts as `hardware`. Parts being manufactured are `design`, the default
for unclassified bodies and generated fasteners. A printed bolt can remain design.
Assign the role with a `setRole` operation through preview, inspection and explicit
apply; its target can be a current body id or an earlier alias in the same plan:

```json
{ "id": "phone-context", "type": "setRole", "target": "phone", "role": "reference" }
```

Check returned body roles before export. Printable scope excludes references and
hardware; assembly scope includes hardware and still excludes references. Use
explicit `bodyIds` for a subset. The export result lists the actual selected ids.
Do not hide, delete or move context bodies simply to keep them out of a print.
The native project retains all roles through save/reopen and parameter revision.

A union or intersection involving reference/hardware geometry conservatively
inherits that classification. A cut retains the target role. Inspect before
reclassifying a fused result. Native ungroup restores original child roles; it
does not copy an assembly's later role assignment onto every child.

## Vehicle phone holders

For vehicle-mounted parts, establish X across, +Y toward the dashboard, and Z up.
State which direction the phone top edge leans, which way its screen faces, and
where the lower stop sits. Resolve critical orientation before applying.

Use `phoneCradle` for a thin contact plate, two side ribs and a lower stop. Supply
contact width and length, angle, plate/rib thickness, stop dimensions, lower-edge
position and `topEdgeToward`. `+Y` leans the phone top toward the dashboard and
faces the screen toward -Y, the driver. Combine the previewed body with an
editable tray or base as needed. Require a connected support-mesh inspection
before apply, and compare complete driver-side, top and isometric views.

A charger cover describes a top outline; it does not establish the dimensions of
the tapered cavity beneath it. Keep conceptual cavity dimensions labeled as
estimates. Check how the phone is inserted and removed, access to ports, and
space for the gear selector. Add only requested storage and support material.
