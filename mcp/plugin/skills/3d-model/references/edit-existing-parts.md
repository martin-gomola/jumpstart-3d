# Edit existing parts

Use for local changes to an existing native part. Read current focused tool
schemas; the tool contracts own supported fields and limits.

## Contents

- Choose the representation and edit level
- Declare the change and preservation contract
- Preview an identified feature
- Inspect the delta and read back
- Capture repeatable agent evidence

## Choose the representation and edit level

Read the target's geometry fingerprint, placement matrix and `editing` context.
For known numeric edits, omit selectors and the full feature tree; the compact
context includes current supported values. Fetch the tree only when needed.
Prefer independent template parameters, then native bound parameters, then a
supported existing feature edit. Use a new modifier or boolean when the request
is genuinely an added feature. Reconstruct only the necessary target geometry
when the existing representation cannot express the edit and the user agrees.

A curve in a sketch is not necessarily a removable fillet. Do not invent a
feature id or treat an imported mesh as parametric history. The feature-edit
context lists supported ids, fields, dependency restrictions and preferred tool.
`$base` identifies a supported one-sided extrusion. Modifier ids are stable
within their document revision; geometric selectors still need fresh discovery
when an upstream change makes them ambiguous or stale.

The initial feature-edit API supports top-level fillet radius, chamfer/offset
distance, shell thickness, hole diameter/blind depth/single location, modifier
removal and a one-sided base extrusion distance. It rejects managed generators,
parameter bindings, variable-radius sets and linked dependents instead of
silently detaching them. Use the appropriate parameter/generator route first.
Unsupported native topology is a capability gap, not permission to edit app
source, execute JavaScript, replace unrelated parts or approximate with a mesh.

## Declare the change and preservation contract

Before preview, record the requested outcome, target ids and geometric evidence
needed to distinguish success from a plausible image. Separate three questions:
what material should be added/removed, which interfaces must remain unchanged,
and which measurements establish the requested relationship.

`requirements.intent` declares the goal and existing target body ids. Its optional
`changeRegion` is a world-space AABB: native material outside it must remain
unchanged. Other changed, added or removed bodies fail the intent check.
`preserveBodyIds` protects unrelated source definitions and placements.
`preserveRegions` compares baseline and candidate native material inside explicit
world-space boxes, including added and removed volume. Equal total volume or
bounds alone cannot establish preservation.

Derive these boxes from actual mating faces, measured interfaces and intended
feature extents. Do not assume a generator-specific protected base height for
arbitrary parts. A world AABB is only the supported initial region mask, not an
exact arbitrary feature boundary. Keep the mask meaningful rather than enlarging
it after a failed check to hide an unintended change.

Use dimension, bound, channel, component, sample and pair inspections as relevant.
A whole-body minimum distance can be zero at an unrelated contact while the
intended interface has a gap. Inspect the actual interface and use both material
and void evidence. Failed or unknown required checks block apply. Native region
queries initially require valid single native/STEP source solids, support empty
or disconnected clipped material, and do not certify surface tolerances or
minimum wall thickness everywhere. Mesh queries remain unsupported.

## Preview an identified feature

Use `jumpstart_preview_feature_edit` with the current `expectedRevision`, target
`expectedFingerprint`, `edit` and explicit single-target `requirements.intent`.
For example, choose an observed modifier id and its supported numeric field;
retain the other selector and placement data rather than rebuilding the part.
MCP geometry is always millimetres; `displayUnits` is only the editor UI setting.
Hole positions are body-local millimetres, so resolve world requests into that
frame before supplying a new location. Multi-location hole patterns require a
separate edit; do not silently move only one of their holes.

For local work, supply `detail` as a world AABB or use the intent's change region.
For an existing target, the preview returns an overview and a detail for both
`before` and `after`, with identical world framing for the detail. Keep the
complete overview to detect side effects and the detail to inspect the local
change. Section and detail comparison images are separate requests within the
four-image budget. Capturing images restores the editor camera and section.

## Inspect the delta and read back

Check that the target body identity, roles and companion bodies remain correct.
Inspect changed feature values, actual geometry and all acceptance results.
Feature values alone are not evidence that a bore moved, a wall thickened or a
joint closed. Use independent sections or probes of the old and new locations.

On a CAD error, inspect the first failing stage and its input selectors. Do not
repeat an identical preview, raise tolerances or strip failed requirements.
Requery geometry after a revision/fingerprint change. Apply only the successful
preview id, then read back the actual document. Preserve save, export and undo
boundaries from the main skill; do not substitute development shell commands
for ordinary MCP model edits.

## Capture repeatable agent evidence

The operator can enable server-side local recording with `JUMPSTART_MCP_TRACE=1`.
The agent continues using normal MCP tools. Compact capabilities report recording
status; no extra HTTP or shell transport is required. Recording is off by default,
local and bounded. It redacts credentials, separates image artifacts and reports
incomplete recording rather than changing modeling results on a logging failure.

A controlled trial needs the task, initial document, client/model configuration,
actual tool trace and independently verified geometry/export. Report tool calls,
failed previews, bytes and elapsed tool time separately from correctness. The
recorder cannot infer LLM tokens or hidden reasoning. Integration tests and skill
trigger fixtures do not establish agent success rates. Use varied generic edits
and compare equivalent runs before claiming that the skill improved efficiency.
