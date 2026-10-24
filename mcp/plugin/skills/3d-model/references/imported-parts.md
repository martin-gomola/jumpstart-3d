# Imported parts

Load this reference for managed imports, mesh scaling, or STEP revisions.

- To import a file, call `jumpstart_list_imports` and choose a listed digest id.
  The operator places files in the local `imports/` directory. Use a typed
  `import` operation with that `assetId`; never request or invent a host path or
  send file bytes. STL requires explicit `units` (`mm`, `cm`, or `in`). Leave
  `units` out for 3MF and STEP so file semantics are preserved. Plans support at
  most four imports and 24 MiB total. STL and 3MF remain editable mesh bodies;
  STEP/STP become native STEP bodies. Use `jumpstart_preview_resize_body` for
  resizing an imported body, and do not claim parametric reconstruction.

## Resize and fit intent

Read body-local dimensions and world bounds. Establish whether resizing means
uniform scaling or independent axes. Scaling a mesh also scales its locking
details; it does not independently adjust a fit clearance. An imported STL remains
a mesh. Use native features for edits around it, and report physical fit as
unverified until supported measurements establish it.

## Preservation checklist

Name the exact target body and list existing bodies that must stay intact. Attach
`preserveBodyIds` in preview requirements. Source-preservation checks compare
native definitions, resolved inputs and placements; they do not prove exact
solid equality or recover a mesh feature tree. Inspect the changed region from
complete views before applying.
