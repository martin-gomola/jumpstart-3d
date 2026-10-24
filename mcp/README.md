# JumpStart MCP

## Ownership and layout

The [SOMA/text-to-cad adoption checklist](ADOPTION-CHECKLIST.md) records the
implemented fit-check slice, verification evidence, and the remaining feature backlog.

This is the MCP interface for the self-hosted JumpStart build. MCP code, tests,
benchmarks, fixtures, and status tokens live here. The editor source is in
`src/`, based on the author source snapshot documented in [SOURCES.md](../SOURCES.md).

```text
mcp/
  browser/     Editor adapter, native model mapping, inspection, and status UI
  server/      Local server, stdio proxy, presence, and tool contracts
  shared/      Parameter evaluator, geometry helpers, and input validation
  tests/       Contract and regression coverage
  benchmarks/  Tutorial and agent tasks, runners, and recorded results
  tokens/      AI status component tokens
```

`browser/` adapts the editor document, scene, and project APIs. `shared/`
contains validation and geometry helpers for browser and Node code. `server/`
owns transport, presence, and tool contracts; it does not depend on browser
editor globals. The editor and MCP stay in one repository because native feature
nodes and preview/apply behavior share editor contracts.

### Editor integration points

Keep the editor-specific surface small and review it when adapting a source
update:

| File | Integration |
| --- | --- |
| [src/app.js](../src/app.js) | Start the MCP browser adapter after the editor and local project store are ready. |
| [src/index.html](../src/index.html) | Show local client status and setup instructions. |
| [src/viewport.js](../src/viewport.js) | Preserve the drawing buffer only for MCP preview screenshots. |
| [src/projects.js](../src/projects.js) | Expose verified local save, versioned save, and reopen operations. |
| [src/latheGeometry.js](../src/latheGeometry.js) | Share the Lathe finishing builder with MCP. |
| [build.mjs](../build.mjs) | Add status-panel styles to the generated app shell. |

Project persistence stays with JumpStart's project store. The bridge validates
inputs and coordinates operations; it does not duplicate project storage,
feature geometry, or undo behavior.

Root `Makefile`, Docker configuration, and npm commands are entry points.
`MCP.md` redirects to this guide.

### Updating source references

The author source and Max's community project have separate Git histories from
this product. Do not merge either repository directly. Record the source commit,
compare files, and adapt selected changes into this tree. See
[SOURCES.md](../SOURCES.md) for the current pins and workflow.

Regenerate `build/site/` with `npm run build`; do not edit generated bundles by hand.
Run focused checks and a local MCP smoke check after changes to document,
kernel, selector, persistence, or export behavior. Keep tool contracts,
`/__mcp` routes, revision checks, and loopback binding stable unless an explicit
product migration changes them.

## Local modeling

JumpStart exposes the running local editor through a stdio MCP server. The server binds its browser bridge to loopback and serves the built app at `http://localhost:3210/?mcp=1`.

### AI workspace templates

Open **AI → Generators → Gridfinity**, then choose **Drawer layout** or
**Single part** for an insert, bin, or baseplate. These workflows belong to the
Gridfinity generator; other generators can have their own controls. On desktop, the workspace expands to show scrollable
settings beside the model preview, dimensions, and Add/Cancel actions. The
Generators panel uses the same typed plans and preview/apply checks as the agent.

Changing a value keeps the last preview visible with an **Out of date** label
and disables **Add to document**. Select **Preview** to rebuild and inspect the
new values before adding them. **Cancel preview** discards the proposal. The
Connection tab contains client setup instructions.

Preview images show only the proposed or changed bodies. Existing document parts
remain in the editor but are excluded from the image, even when they overlap the
proposal's position.

The drawer's **3D preview** is interactive: drag to rotate, scroll to zoom, or
choose **Top view** and **Reset view**. With the viewer focused, arrow keys rotate,
plus/minus zoom, and zero resets. This local viewer uses cached preview meshes;
camera changes do not edit the document or apply the layout. If interactive
rendering is unavailable, the static preview image remains available.

**Drawer layout** begins with inside width, depth, and usable height in mm.
Choose **New drawer** beside the drawer heading to clear the draft and enter new
measurements in one click. **Undo layout** restores the previous draft; already
applied document parts are unchanged.
Selecting a bin brings its inspector into view in the left column. Its name and
Rotate/Duplicate/Remove actions remain pinned while scrolling the bin options.
The planner calculates the cell grid and leftover space, lets you draw/move bins,
and exposes settings for the selected bin. Add bin and Fill gaps provide pointer-free
alternatives. Arrow keys move a focused bin; Shift + arrows resize it. Undo layout
and Ctrl/Cmd+Z affect the layout draft while planner controls have focus.

Preview layout creates a typed `drawerLayout` operation. It checks overlaps,
bounds, height and resource limits, then generates editable native bins and matching
baseplates. Baseplates are tiled into parts no larger than 4 by 4 cells. Inspect
the 3D preview before Add. Save the project after adding to persist the layout.
Saved layouts can be loaded and regenerated; native edits, missing/locked parts
and external dependencies block replacement rather than discarding those edits.

### Optional magnet pockets

Single part provides a **Magnet pockets** checkbox for bins, insert blanks and
baseplates. In Drawer layout, open **More bin options** for a selected bin and
**Advanced construction** for baseplate pockets. **Use this magnet fit in all bins**
copies a selected bin's pocket sizes to every current bin.

The typed `gridfinity` input accepts `magnets: true` or
`magnets: { "diameter": 6.5, "depth": 2.4 }`; omit it or use false to keep pockets
off. Dimensions describe the pocket in mm. These defaults provide glue clearance
for nominal 6 by 2 mm magnets; a press fit depends on the actual magnets and printer.
There are four blind pockets per 42 mm cell on 26 mm centers. Bin/insert pockets
open underneath. Magnetic baseplates use a perforated carrier with a 0.8 mm floor
and top-opening pockets. The carrier adds pocket depth +0.8 mm below the socket
grid: default magnetic plate height is 8.2 mm, with bin seating at Z=3.45 mm.
The footprint and shaped socket interface retain their standard dimensions.

`drawerLayout.baseplateMagnets` controls its baseplates, and each bin's `magnets`
controls that part. Drawer height checks include the raised seating position,
and save/reopen and explicit updates retain these choices. Pocket diameter is
bounded to 2–8 mm and depth to 0.5–4 mm to retain the foot walls and base roof.
Magnet polarity, retention and physical printed fit need assembly/calibration checks.

The `drawerLayout` operation accepts `width`, `depth`, `height`, `bins`, optional `layoutId`,
`includeBaseplate`, `baseplateMagnets`, `floor`, `wall`, and explicit `replaceExisting`. Bin positions
`x`/`y` are whole cells from the front-left; +Y goes toward the back. Each bin has
`id`, `label`, `columns`, `rows`, `heightUnits`, `kind` (bin/insert), optional
`dividers` and `lip`. Limits: 20 cells per direction, 16 bins, and 144 generated
grid cells. `get_document` returns saved `drawerLayouts` and whether they remain
editable. Existing tool names, preview revision checks and apply idempotency remain
in effect. Draft rearrangement itself does not mutate the native document.

## Start

For development outside Docker, build the app and then add the MCP server to
your client configuration:

```sh
npm ci
npm run build
```

### Docker shortcut

With Docker Compose and `make` installed, start the app and its MCP bridge in a
local container:

```sh
make up
```

This builds and starts the container, then prints
`http://localhost:3210/?mcp=1`. The port is published on loopback only. Set
`JUMPSTART_DATA_DIR` in the local, gitignored `.env` file (copy `.env.example`
and replace its placeholder). Compose bind-mounts `exports/` and `imports/`
under that host directory, outside the checkout, so those files survive
container replacement and remain easy to open from the host file browser. MCP
exports are written there. Put STL, 3MF, STEP, or STP files you want the agent to
import in its `imports/` subdirectory. Compose mounts imports read-only at
`/app/imports`; MCP imports use digest ids from `jumpstart_list_imports`, never
host paths or file bytes. `jumpstart_save_document` still saves native projects
to browser-local storage; this Docker data mount does not back up browser data.
Each file and
each plan's combined imports are limited to 24 MiB, with at most four files per
plan. The catalog lists up to 128 files and reports when it is truncated. STL
plans require explicit `mm`, `cm`, or `in` units. 3MF and STEP retain units
encoded in the file. Stop the container with `make down`; use `make logs` to
inspect its output.

For Codex, run `make codex-install` with host Node.js 22 or newer and the Codex
CLI on PATH. It installs the MCP proxy and modeling skill as a
[Codex plugin](#codex-plugin). The proxy runs outside the app container, so a
Docker rebuild does not terminate its stdio connection. Older custom registrations,
including `docker exec`, require explicit migration before installing.

For clients that use TOML, run `make mcp-config` to print a host-proxy entry.
Claude Code and Antigravity CLI setup is covered below. The proxy communicates
with the app at `http://127.0.0.1:3210/__mcp/rpc`. Override
`JUMPSTART_MCP_HTTP_URL` when the app uses another local port.

The legacy container command remains supported:

```sh
docker exec -i jumpstart-3d node mcp/server/stdio-proxy.mjs
```

A container restart closes that legacy transport. The host proxy instead
returns JSON-RPC errors with request ids during outages and stays available.
Discovery, reads, and previews may retry once; uncertain apply, undo, save, and
other mutations are never replayed automatically. Inspect the document before
retrying an uncertain edit. `JUMPSTART_MCP_PROXY_TIMEOUT_MS` controls the bounded
request deadline (70 seconds by default, clamped to 100 ms through 120 seconds).

Codex configuration example:

```toml
[mcp_servers.jumpstart]
command = "node"
args = ["/absolute/path/to/jumpstart-3d/mcp/server/server.mjs"]
```

Restart the MCP client, open the local app URL printed to the server's stderr, then call `jumpstart_list_editors`. The `mcp=1` query keeps the viewport drawing buffer available for MCP preview screenshots. The app must stay open while the agent works. Set `JUMPSTART_MCP_PORT` to a free local port if `3210` is already in use.

### Connect Claude Code or Antigravity CLI

Keep `make up` running, then register the same host proxy in the client. These
commands do not ask JumpStart for a model API key. Sign in to the client with
your own account first; model access and subscription limits remain with that
client.

Requirements: host Node.js 22 or newer. Replace the example path with the
absolute path to this checkout.

**Claude Code** — add JumpStart to your user-level MCP config:

```sh
claude mcp add --scope user --transport stdio jumpstart -- node /absolute/path/to/jumpstart-3d/mcp/server/stdio-proxy.mjs
claude mcp get jumpstart
```

**Antigravity CLI** — add this server to
`~/.gemini/config/mcp_config.json`:

```json
{
  "mcpServers": {
    "jumpstart": {
      "command": "node",
      "args": ["/absolute/path/to/jumpstart-3d/mcp/server/stdio-proxy.mjs"]
    }
  }
}
```

Then start `agy` and run `/mcp` to confirm JumpStart is connected. Both clients
run the host proxy locally, which forwards to the loopback-only app in Docker.
Keep the app open at `http://localhost:3210/?mcp=1` while modeling. If using a
different port, set `JUMPSTART_MCP_HTTP_URL` in the client server environment to
the matching `http://127.0.0.1:<port>/__mcp/rpc` endpoint.

## Tool reference

The MCP exposes these tools. Model previews leave the document unchanged;
apply commits a successful preview as one undoable edit.

| Tool | Purpose |
| --- | --- |
| `jumpstart_list_imports` | List operator-managed CAD files by metadata and SHA-256 asset id; returns no file contents. |
| `jumpstart_list_editors` | List connected editor tabs and their connection state. |
| `jumpstart_get_document` | Read the document revision and selected bodies, with optional feature trees, sketches, and geometry selectors. |
| `jumpstart_get_capabilities` | Read compact capabilities or filter schemas by tool name and typed plan operation. |
| `jumpstart_preview_model` | Preview a typed model plan with primitives, sketches, features, operations, and digest-referenced managed imports. |
| `jumpstart_preview_resize_body` | Preview an exact body resize while preserving its base, center, or corner anchor. |
| `jumpstart_preview_new_document` | Preview an empty document as a recoverable edit. |
| `jumpstart_preview_native_model` | Preview a dimensioned rectangle and expression-bound extrusion using native document parameters. |
| `jumpstart_preview_native_parameters` | Preview changes to native document parameters. |
| `jumpstart_preview_parameters` | Preview parameter changes to a saved MCP model template. |
| `jumpstart_preview_frame` | Preview a rectangular spacer frame. |
| `jumpstart_preview_lathe` | Preview a turned part from an axial profile, with optional hollowing and scale. |
| `jumpstart_inspect_geometry` | Measure live/preview dimensions, sections and meshes, or native-solid pair distance and intersection volume. |
| `jumpstart_select_geometry` | Find native edges or faces by geometric properties; reports ambiguity instead of guessing. |
| `jumpstart_apply_model` | Apply a successful preview as one undoable edit; duplicate applies are ignored. |
| `jumpstart_undo` | Undo one edit when the document revision still matches. |
| `jumpstart_save_document` | Save the current document to browser-local project storage; optionally save a version. |
| `jumpstart_reopen_document` | Reopen the current project's saved document as a recoverable edit. |
| `jumpstart_export_model` | Export printable design bodies or an explicit design/hardware assembly as STL, STEP, or 3MF. |
| `jumpstart_start_tutorial` | Start native tutorial checks on the current blank document. |
| `jumpstart_get_tutorial_status` | Read observed tutorial checks; manual steps are not certified. |

`jumpstart_preview_model` also accepts a typed `gear` operation for editable
spur gears, straight bevel gears, and racks. A spur gear uses module, tooth
count, pressure angle, face width, and an optional center bore. A straight
bevel gear adds a pitch cone angle (5–80°, default 45°) and tapers its sampled
involute tooth section from the large end to the small end with a ruled loft;
this is an editable geometric approximation, not a tooth-contact-accurate
gear design. Its bore must fit inside the small-end root diameter. Its
`thickness` is axial face width. A rack
uses module, tooth count, pressure angle, face width, and backing depth
(`baseDepth`, defaulting to twice the module). Each becomes a native primitive
node whose parameters remain editable through the editor timeline. Spiral
bevel teeth and automatic gear-pair placement are not provided.

The typed plan does not yet provide spiral bevel gears, generic patterns of existing
feature modifiers, Split Face, or asset import. Split Face's current editor
implementation cannot be edited and its kernel selector can choose a nearby
face after topology changes. Imported STL/STEP/3MF bodies can be inspected,
resized, and exported through the existing tools, but MCP does not open a file
picker or accept host file paths.

### Phone cradles and orientation

`jumpstart_preview_model` accepts an editable `phoneCradle` operation with an
explicit `topEdgeToward` direction. Its frame is X across the part, +Y toward the
dashboard, and Z up. `topEdgeToward: "+Y"` leans the phone's top edge toward the
dashboard and faces the screen toward the driver (-Y); `"-Y"` reverses both.
The operation builds a thin contact plate, two side ribs, and a lower stop as
native editable primitive and boolean features in one cradle body. Later plan
operations can combine that cradle with a tray or another editable base. Supply the phone contact width,
contact length along the incline, angle, plate/rib thicknesses, stop dimensions,
and lower-edge position in millimetres.

Preview images carry an XYZ axis triad and camera-direction labels. For a
`phoneCradle`, inspect the returned orientation metadata, then call
`jumpstart_inspect_geometry` with mesh validation. It reports whether the plate,
ribs, and stop form one connected mesh. Applying a phone-cradle preview is
rejected until that check passes. This checks generated-model connectivity only;
it does not certify vehicle fit, minimum wall thickness, strength, or printability.

### Body roles and export selection

Bodies accept optional native `role` metadata: `design`, `reference`, or `hardware`.
An absent role means `design`, including existing files and generated fasteners.
Roles do not hide bodies, change their dimensions or freeze their feature nodes.
Assign a role through a typed operation in `jumpstart_preview_model`, inspect the
preview, then apply its id:

```json
{
  "name": "Classify assembly context",
  "operations": [
    { "id": "phone-reference", "type": "setRole", "target": "existing-phone-body-id", "role": "reference" },
    { "id": "purchased-screw", "type": "setRole", "target": "existing-screw-body-id", "role": "hardware" }
  ]
}
```

`target` accepts an existing body id or an earlier plan alias, including a pattern
alias covering multiple bodies. Locked bodies reject classification edits.
Document and preview responses report the effective role; changed-body reports
include before/after roles. Role edits retain saved parameter controls; subsequent
numeric parameter revisions preserve the latest roles. Native saves, reopen and
undo retain the metadata. Geometry edits still invalidate incompatible templates.

`jumpstart_export_model` accepts `scope` and optional `bodyIds`:

| Scope | Included visible solids | Excluded |
| --- | --- | --- |
| `printable` (default) | Design bodies | Reference, hardware, hidden bodies, holes, preview cutters |
| `assembly` | Design and hardware bodies | Reference, hidden bodies, holes, preview cutters |

An explicit `bodyIds` list must contain 1–128 unique, existing, eligible ids.
Invalid selections and empty exports fail instead of falling back to another
body. All three formats use the same selection; results identify exported ids,
roles and scope. Exports leave the document unchanged. The editor's regular
STL/3MF/STEP menu also uses printable bodies, with its existing selection option.
Native JSON projects retain every body, including references and hardware.

Copies, linked mirrors and split outputs inherit their source role when created.
Union/intersection results conservatively inherit `reference` before `hardware`
before `design`; subtractive hole bodies do not promote a result. Cuts keep the
target role. Group children retain their original roles for ungroup; a later role
assignment to the group does not overwrite these stored child roles. Inspect and
explicitly reclassify a result if its manufacturing intent has changed. Roles do
not establish that an assembly is fused, printable, or physically fits.

## Agent workflow

The top-bar AI indicator uses a visible state label such as `AI ready` or
`AI waiting`, plus a status light. Hover or keyboard focus reveals the full
description; Escape dismisses it. Activate the status button to open the
client-setup panel with signed-in client setup and copyable configuration.
JumpStart does not host a model session or store a model API key. The accessible
name announces the current state.
The stdio proxy maintains a client lease every five seconds; the server
expires missing leases after fifteen seconds and removes a clean disconnect
immediately. Browser heartbeats do not count as agent connections. Stateless
HTTP requests establish only recent activity, labeled accordingly. In-flight
activity is shown only in the editor executing the command. Completed edits
remain visible briefly, including through follow-up reads. Editor errors and
bridge loss are explicit; opening the setup panel does not grant editing
permissions.

1. Call `jumpstart_list_editors`; specify `editorId` if more than one editor is open, even if one reports focus. Listings include `lastSeenAt`, `connectionState`, and the number of tabs sharing a document id. After a tab reload or disconnect, relist and verify its document before editing.
2. Call `jumpstart_get_document({ includeGeometry: true })` to read the current revision, world bounds, body-local dimensions, sketches, feature nodes, and capped edge/face selectors.
3. Call `jumpstart_preview_model` with a typed plan. Plans support JumpStart primitives, circle/polygon/rounded-rectangle/line-arc-spline contour profiles, reusable line/arc path sketches, extrude/revolve/loft/sweep/pipe/coil features, native spur, straight bevel, and rack gears, axial knurled knobs, the `phoneCradle` operation, body transforms, linked or joined body mirrors, linear/circular/path body patterns, patterns of editable hole, emboss, and sketch-backed boolean features, plane-based body splits, groups, booleans, metric/inch fasteners, fitted planar hole patterns, and native fillet/chamfer/offset/shell/hole/thread/emboss/scale modifiers. They can add bodies or edit existing bodies by id. For a direct imported-body size change, `jumpstart_preview_resize_body` remains the shortest form.
4. Inspect preview validity, errors, dimensions, and the returned image before applying.
5. Call `jumpstart_apply_model` with the returned `previewId`. Applying the same id twice does not duplicate the edit.
6. Read the new revision before calling `jumpstart_undo`. The revision check prevents undoing a later user edit.
7. Call `jumpstart_export_model` with `format: "stl"`, `"step"` or `"3mf"`. Files are written under `exports/` with a content hash in the name.

All coordinates, radii, distances, and feature parameters are in millimeters. `units` in the document summary is only the app's display preference. A plan adds features to the open document; pass `replaceBodyIds` from a previous apply result to preview and replace those bodies as one undoable edit.

## Plan shape

A plan contains typed primitive bodies, sketches, CAD features, and operations. Profile sketches have a local plane (`XY`, `XZ`, or `YZ`), origin, and one closed circle, polygon, rounded rectangle, or explicit contour. A rounded rectangle uses `width`, `height`, `radius`, and an optional local `center` (default `[0, 0]`); its radius must be positive and no larger than half the shorter side. It compiles to native line and quarter-arc sketch entities. A contour is an ordered `profile.segments` list of lines (`start`, `end`), three-point arcs (`start`, `through`, `end`), and spline fit-point segments (`points`). Segment endpoints must connect and close within 0.001 mm. An open spline segment must begin and end at adjacent segment endpoints; a single spline can instead set `closed: true` and form the whole contour. Contours allow up to 64 segments and 128 input points. They compile to editable native line, arc, and spline entities. Preview delegates exact curve and face construction to the CAD kernel; MCP does not provide an independent analytic self-intersection proof for arbitrary splines. Path sketches use the same plane and origin with an ordered `segments` list of lines and three-point arcs; endpoints must connect within 0.001 mm. Sketch coordinates and all feature parameters use millimeters. Features can extrude, revolve, loft, sweep a profile along a path, or create a pipe along a path. Pipes support circle, square, or triangle sections and optional hollow walls. Sweep and pipe paths are editable native sketches, and these features support `new`, `join`, or `cut` operations. Sweep taper, twist, and edge-picked paths are not part of this input. Boolean joins/cuts can reference earlier bodies. Linear patterns use `count` as instances per side when `symmetric` is true, so count 4 creates 7 total instances. Circular patterns use `count` including the source; a partial total angle includes both endpoints, while 360 degrees spaces instances around the complete circle.

`featurePattern` copies selected modifiers on exactly one body. `features` accepts stable ids from earlier modifier, boolean-feature, or hole-pattern operations, and native modifier ids returned by geometry inspection. Axes and origins are world-space; copied hole points and normals, emboss frames, and boolean tool transforms are mapped into the body's local coordinates. Supported modifiers are holes, planar embosses, and sketch-backed extrude, revolve, or sweep booleans. Unsupported feature types are rejected. Linear/circular count follows body pattern semantics, and each operation is limited to 256 generated modifier copies.

### Path body patterns and body splits

`pathPattern` copies one or more earlier bodies along a typed path sketch. It creates separate bodies with copied native feature trees, so each instance remains editable. `count` is 2 to 12 and includes the unchanged source. For an open path, `mode: "fit"` spreads copies from the anchor station to the endpoint selected by `direction`; `mode: "spacing"` requires `spacing` and rejects copies that exceed that endpoint. For a closed path, fit spaces instances around one full loop without repeating the first station. The optional world-space `anchor` is projected to the nearest point on the path. When omitted, the source body's transformed local origin is used. The original transform is preserved. `orientation: "same"` keeps each copy's rotation; `"follow-path"` rotates copies by the path tangent change from the first station.

```json
{
  "name": "Clips along a cable guide",
  "primitives": [
    { "id": "clip", "kind": "box", "parameters": { "w": 8, "d": 6, "h": 4 }, "position": [0, 0, 0] }
  ],
  "sketches": [
    { "id": "route", "plane": "XY", "origin": [0, 0, 0], "segments": [
      { "type": "line", "start": [0, 0], "end": [20, 0] },
      { "type": "arc", "start": [20, 0], "through": [25, 5], "end": [20, 10] }
    ] }
  ],
  "operations": [
    { "id": "clips", "type": "pathPattern", "source": "clip", "path": "route", "mode": "fit", "count": 4, "orientation": "follow-path" }
  ]
}
```

`splitBody` divides one editable body with a world-space plane and returns two editable bodies. The positive-normal side keeps the target body id; the opposite side gets a new id. It fails if either side has no solid volume or the document body limit would be exceeded.

```json
{
  "name": "Halved enclosure",
  "primitives": [{ "id": "case", "kind": "box", "parameters": { "w": 40, "d": 30, "h": 20 } }],
  "operations": [{ "id": "halves", "type": "splitBody", "target": "case", "plane": { "origin": [20, 0, 0], "normal": [1, 0, 0] } }]
}
```

### Native coil

Use a `coil` feature for an editable helical body. `d` is its diameter parameter, `turns` supports fractional turns, and `mode` chooses whether `h` (overall height) or `pitch` (rise per turn) controls the helix. Choose `section` from `circle`, `square`, `triangle`, or `triangle-in`; `size` is the section size. `pos` controls whether the section sits inside, on, or outside the nominal coil diameter. `angle` sets taper in degrees from -60 to 60, and `left` selects a left-handed helix. `position` and `rotation` place the coil, whose local axis starts along +Z. The input rejects turn overlap and taper that collapses the end radius.

```json
{
  "name": "Replacement spring",
  "features": [{ "id": "spring", "type": "coil", "d": 24, "turns": 7, "mode": "height", "h": 35, "section": "circle", "size": 2 }]
}
```

Mirror an existing or newly created body across a plane using its origin and normal in millimeters. The default `behavior` is `linked`, which creates an editable mirror body that follows its source. Use `behavior: "join"` to merge a reflected snapshot into the source body. Nested linked mirrors are unsupported, and named-parameter models cannot mirror bodies from outside that model.

```json
{
  "name": "Symmetric bracket",
  "primitives": [{ "id": "arm", "kind": "box", "parameters": { "w": 40, "d": 8, "h": 6 }, "position": [20, 0, 0] }],
  "operations": [{ "id": "other-arm", "type": "mirror", "source": "arm", "plane": { "origin": [0, 0, 0], "normal": [1, 0, 0] } }]
}
```

### Native fasteners and hole patterns

The `gear` operation creates native spur, straight bevel, or rack primitives.
Their stored module, tooth count, pressure angle, face width, and subtype
parameters remain available in the editor's primitive editor. Spur and bevel
tooth profiles use sampled involute flanks; bevel teeth taper between two
matching conical sections. Racks use standard addendum and dedendum
proportions. This operation does not create matched gear-pair placement or
spiral bevel teeth, and does not certify bevel gear mating accuracy.

```json
{
  "name": "Straight bevel gear and rack",
  "operations": [
    { "id": "drive", "type": "gear", "gearType": "bevel", "module": 1.5, "teeth": 24, "thickness": 6, "coneAngle": 45, "bore": 5, "position": [0, 0, 0] },
    { "id": "slide", "type": "gear", "gearType": "rack", "module": 1.5, "teeth": 24, "thickness": 6, "baseDepth": 3, "position": [0, 30, 0] }
  ]
}
```

Add fasteners as operations in the same previewable plan. Supported sizes are M2.5 through M12 coarse metric, plus #6-32 through 1/2-20 UNC/UNF. `length` is required for bolts, rods, and cutters, and must provide at least three thread turns; nuts ignore it. Fasteners are native editable bodies: bolts use a hex head and threaded shank, nuts use a bored hex prism and internal thread, rods use an external thread, and cutters are threaded bodies marked as subtractive tools. `clearance` is a thread print offset from -1 to 0 mm. Position is in millimeters and rotation in degrees.

```json
{
  "name": "M8 mounting hardware",
  "operations": [
    { "id": "bolt", "type": "fastener", "fastenerType": "bolt", "size": "M8", "length": 30, "position": [0, 0, 0] },
    { "id": "nut", "type": "fastener", "fastenerType": "nut", "size": "M8", "position": [20, 0, 0] }
  ]
}
```

A `holePattern` operation adds one native Hole feature with all generated positions. `face` is a world direction (`+z`, `-x`, and so on); the pattern selects the farthest matching flat face. Grid pitch can be omitted to spread the requested rows and columns over that face, or supplied as a number or `[columnPitch, rowPitch]`. Staggered grids shorten every other row. Circle centers are body-local coordinates; omit `center` to use the face center. Holes outside the actual tessellated face boundary are dropped and reported in preview results. Overlapping layouts and layouts that leave no fitting holes fail before apply.

```json
{
  "name": "Perforated plate",
  "primitives": [
    { "id": "plate", "kind": "box", "parameters": { "w": 60, "d": 40, "h": 6 } }
  ],
  "operations": [
    {
      "id": "vents", "type": "holePattern", "target": "plate", "face": "+z",
      "layout": { "type": "grid", "cols": 3, "rows": 2, "pitch": 10, "stagger": false },
      "hole": { "kind": "simple", "diameter": 4 }
    }
  ]
}
```

Round hole patterns support `simple`, `cbore`, `csink`, and `tapped` holes. For a tapped pattern, `diameter` is the tap-drill diameter and `pitch` sets the thread pitch. Pattern candidate counts are capped at 200; final feature limits are 200 simple holes, 130 counterbores, 130 countersinks, or 8 tapped holes. Preview first builds the target, computes positions from its planar-face mesh, then builds the native Hole feature.

For non-round cuts, set `shape` to `square`, `hex`, or `slot` and provide `width`. Hex width is measured across flats. Slots also require a `length` greater than `width`; on circular layouts, slots point toward the circle center. Omit `depth` for a through cut or provide it for a blind cut. Omit `hole`; shaped patterns compile to one native sketch and one editable extrusion cut.

```json
{ "id": "mount-slots", "type": "holePattern", "target": "plate", "face": "+z", "layout": { "type": "grid", "cols": 2, "rows": 2, "pitch": 16 }, "shape": "slot", "width": 4, "length": 10 }
```

Fit and spacing checks use the shape's bounding radius, so a pattern that barely fits may be rejected conservatively. Inspect the preview geometry before applying as usual.

### Native knurled knobs

Use a `knurl` plan operation for a straight axial V-groove knob. It creates a
hidden editable sketch and a standard extrusion, keeping the profile and length
in the native feature tree. Diameter defaults to 20 mm and supports 6–150 mm;
length defaults to 15 mm and supports 1–200 mm. Groove count defaults to about
one groove per millimeter of circumference and is limited to 8–120. Depth
defaults to half the groove pitch and is validated to prevent vanished grooves
or a collapsed core. Optional bores are `round`, `hex`, or `d`; `boreSize` is a
diameter, or across-flats for hex. The validator preserves at least 1 mm beneath
the groove roots. These are axial grooves, not crossed diamond texture.
The groove pitch is circumference divided by groove count; pitches below
0.8 mm are allowed but may print without a clear grip pattern on common FDM
printers.

```json
{
  "name": "Knurled control knob",
  "operations": [{ "id": "knob", "type": "knurl", "diameter": 24, "length": 18, "grooves": 32, "bore": "d", "boreSize": 6 }]
}
```

`jumpstart_preview_resize_body` changes the exact local X, Y, and/or Z size of an existing body by adding or updating JumpStart's native scale feature. It works on imported STL/3MF meshes and preserves their mesh source. Omitted dimensions stay unchanged. `base` keeps the bottom center fixed; `center` keeps the center fixed; `corner` keeps the minimum corner fixed. Imported meshes remain meshes: resize, placement, and feature-based cuts are editable, while the original triangle surface is not a parametric sketch or feature tree.

For fillet and chamfer, use current local edge signatures. For offset and shell, use current face signatures from `get_document({ includeGeometry: true })` with center, surface type, and the planar normal where applicable. Offset distance is signed: positive pushes the face out; negative pulls it in. Offset rejects far or ambiguous face matches. Hole positions/normals, thread face centers, and emboss face frames are also body-local. Preview again after editing an earlier feature because edge and face references can change when geometry changes.

The current MCP sketch input uses explicit point coordinates and circle radii, plus ordered line/arc/spline contours. It does not expose arbitrary solver constraints. Path sketches support only ordered line and three-point arc segments; they do not expose edge-picked paths. Contour curve intersections are not independently proven analytically; failed CAD-kernel face construction rejects the preview. Native bound rectangles and 3MF export have separate supported paths. Preview validation reports OpenCascade build errors and mesh measurements; it does not prove a physical fit or replace a slicer/manifold check.

## Inspection and parameter revisions

Start with compact capabilities, then request only the exact tool schemas needed.
Tool inputs are validated at runtime, including unknown keys, numeric ranges,
payload sizes and array limits. Maximum tool arguments are 256 KiB. Inspection
is bounded to 200,000 triangles and an estimated eight million triangle visits;
split expensive inspection requests into smaller read-only calls.

### Focused discovery and document reads

Existing calls without filters retain their full response. To avoid loading the
schema catalog again for every modeling step:

```json
{ "includeSchemas": false }
```

Pass that to `jumpstart_get_capabilities` for a tool-name summary, operation
support, limits, and unsupported geometry. Request selected schemas when needed:

```json
{ "toolNames": ["jumpstart_preview_model"], "operationTypes": ["knurl", "holePattern"] }
```

`operationTypes` filters variants in `plan.operations`; extrude, revolve, loft,
sweep, pipe and coil are in `plan.features`. Unknown tool or operation filters
fail explicitly. Filtering returns schema copies and does not narrow the
broker's actual validation contract or change `tools/list`.

For `jumpstart_get_document`, use `bodyIds` to return selected bodies. With
`includeGeometry: true`, only their referenced sketches are returned, including
sketches used through linked mirrors. `includeSketches: false` omits sketches;
`includeSelectors: false` omits edge/face arrays; `includeFeatureTree: false`
omits native feature nodes. Geometry flags default to the previous behavior.
Unknown or duplicate body ids fail instead of returning an ambiguous empty list.
The response includes selection counts and retains document identity/revision.

### Preview acceptance requirements

Every preview tool accepts a `requirements` object alongside its plan or edit.
Write acceptance values from the user's request before constructing the model.
For example, a new bracket can require a 40 mm width, one connected component,
and preservation of an existing tray:

```json
{
  "requirements": {
    "bodyCount": 2,
    "preserveBodyIds": ["existing-tray-id"],
    "bodies": [{
      "target": "bracket",
      "checks": [
        { "id": "width", "kind": "dimension", "axis": "X", "expected": 40, "tolerance": 0.05 },
        { "id": "connected", "kind": "components", "expected": 1 }
      ]
    }]
  }
}
```

`bodyCount` counts all candidate document bodies, including hidden bodies and
hole tools. A per-body `target` is an existing native body id or a plan reference
that resolves to exactly one body. Up to 16 target bodies and 64 checks are
supported, with at most 8 checks per target and an aggregate eight-million
triangle-visit budget. Duplicate target/check ids fail validation.

Supported per-body checks use generated world-space tessellation:

| Kind | Measurement |
| --- | --- |
| `dimension` | X, Y, or Z extent against `expected`, in mm. |
| `bound` | World-space `min` or `max` coordinate along an axis; includes placement. |
| `components` | Integer connected-component count at the inspector's weld tolerance. |
| `channels` | Existing straight parallel, flat-bottom channel measurements and counts. |

Results return `acceptance.status` as `passed`, `failed`, or `unknown`, with
expected and measured values for numerical checks. Unknown includes an
uninspectable target, an unsupported section, or an exhausted measurement
budget. Failed and unknown contracts block apply. Later optional inspection
checks cannot overwrite the attached acceptance result. Successful geometry
with failed acceptance stays cached for read-only inspection; the saved document
is unchanged. Requirements are scoped to that preview: resubmit them on every
later preview or parameter revision. They are not persisted as model constraints.

`preserveBodyIds` compares native body definitions, referenced sketches, resolved
geometry inputs, asset fingerprints and placements. It does not perform an exact
solid-volume difference. Components do not establish contact strength, absence
of self-intersection, minimum wall thickness everywhere, or physical fit. Native
cylindrical-face counts are not exposed as a general hole-recognition checker.

### Native solid pair measurements

For two native CAD or valid STEP solids, `jumpstart_inspect_geometry` accepts
`againstBodyId`. Pin `expectedRevision`; use `previewId` when both operands come
from a proposed document. Both bodies must belong to that same current document
or preview. For example:

```json
{
  "editorId": "selected-editor-id",
  "expectedRevision": "current-document-revision",
  "bodyId": "base-body-id",
  "againstBodyId": "lid-body-id",
  "pairChecks": { "minimumClearance": 0.3, "maximumOverlapVolume": 0 }
}
```

`pairChecks` is optional for a measurement-only request. When supplied, it needs
`minimumClearance` (mm) and/or `maximumOverlapVolume` (mm3). These example
thresholds are synthetic fixtures, not universal printing tolerances.

The `pair` result separates `distanceMm`, world-space `witnessPoints`, and
`overlapVolumeMm3`. Zero set distance includes touching, overlapping and
contained solids; it is not penetration depth. Witnesses may be non-unique and
need not lie on both boundaries when solid interiors intersect. A positive
intersection volume identifies material overlap. Entire-body minimum distance
also includes intentional contacts, so establish what may touch before using a
minimum-clearance requirement.

A completed native query reports `status: "measured"`. Invalid/non-solid,
disconnected, unsupported or failed geometry reports `unknown` with null
measurements. Intersection failure never becomes a successful zero. Initial
support is one positive-volume, valid native or STEP solid per operand, with
rigid or uniform-scale placement. Nonuniform, sheared and perspective placement
matrices are unknown rather than silently normalized. STL/3MF
and Lathe recipe meshes are explicitly unsupported; no analytic reconstruction
or implicit mesh conversion is performed by this query.

Attach immutable pair acceptance to any preview using plan references or native
body ids:

```json
{
  "requirements": {
    "pairs": [{
      "id": "lid-fit",
      "a": "base",
      "b": "lid",
      "minimumClearance": 0.3,
      "maximumOverlapVolume": 0
    }]
  }
}
```

Pair requirements need `expectedRevision`. Both references must resolve to one
different body. Results appear in `acceptance.pairs`, and threshold results join
the other acceptance checks. Failed or unknown pair requirements block apply;
a later optional inspection cannot loosen that preview's contract. Resubmit
requirements on each later preview or parameter revision.

The comparison tolerances are explicit: `distanceTolerance` defaults to
0.0001 mm and `volumeTolerance` to 0.000001 mm3. They are numerical tolerances,
not manufacturing allowances. Up to eight pairs and 2,000 faces per operand are
supported; their thresholds count toward the shared 64-check preview limit.
Analysis uses a temporary OCCT worker with a 20-second budget including startup.
Timeout terminates only that analysis worker and returns unknown; the editor's
build worker and its caches remain available. The bridge checks the document
revision again after native work completes before returning or caching results.

The adapted measurement semantics come from text-to-cad's MIT geometry helpers;
see `SOURCES.md` and `third_party/text-to-cad/LICENSE`. No Python runtime or
additional dependency is required. CAD measurements remain separate from
physical-fit and manufacturing certification.

### Review changes and recover from failures

All previews return `changes` with added, removed, changed and unchanged body
ids. Changed bodies include before/after world bounds, dimensions, volume and
numeric deltas when available. This distinguishes placement changes from size
changes without centering either model. Equal dimensions or volume alone do
not establish identical geometry. This source comparison is separate from the
existing parameter-template `diff`.

Tool errors preserve the `error` string and add `guidance` containing a recovery
category, cause certainty, and next checks. Categories distinguish timeouts,
resource limits, stale state, unsupported operations, acceptance failures, and
other validation/execution failures. Geometry-build failures identify the CAD
construction stage or timeout. Categories guide recovery and do not diagnose an
unverified geometric cause. Read current state before retrying an uncertain
mutation, and reuse its preview id when appropriate.

### Named parameters

Add `modelId`, `parameters` and optional `constraints` to a model plan. Numeric
fields accept expression objects:

```json
{
  "modelId": "disk",
  "name": "Editable disk",
  "parameters": {
    "diameter": { "value": 100, "unit": "mm", "min": 10, "max": 500 },
    "radius": { "expression": "diameter / 2", "unit": "mm" },
    "height": { "value": 6, "unit": "mm", "min": 1 }
  },
  "primitives": [
    { "id": "disk", "kind": "cylinder", "parameters": {
      "w": { "$expr": "diameter" }, "d": { "$expr": "diameter" },
      "h": { "$expr": "height" }
    } }
  ]
}
```

Expressions support numbers, parameter names, `+`, `-`, `*`, `/`, unary signs
and parentheses. There is no executable code, property access or function
calling. Cycles, unknown names, invalid bounds, noninteger counts and derived
parameter overrides fail before preview. Units are `mm`, `deg`, `count`, or
`scalar`; these are labels, without dimensional algebra. Constraints use
`{ "id": "floor", "left": "height - depth", "operator": "gte", "right": "2" }`.

After applying, `jumpstart_get_document` returns `parametricModels`. Call
`jumpstart_preview_parameters` with `modelId`, `values`, and the current
`expectedRevision`. Preview returns changed parameters and feature ids. Apply
uses the existing transaction and undo path. Templates, values and native
features persist in ordinary project JSON. Unrelated bodies remain intact;
external dependencies and native edits to owned geometry cause a conflict
instead of being overwritten. Final body identities remain stable. Internal
feature nodes are regenerated from the saved template, not arbitrarily patched.
Direct mesh/body resizing invalidates that body's named-parameter record.

### Images, sections and measurements

Preview returns labeled top, side and isometric MCP image blocks. Pass
`section: { "axis": "X", "offset": 0 }` for an additional native section
image. Coordinates are world millimetres. Capture uses fitted orthographic
views and crops to the projected model bounds. Camera, projection, selection
appearance, grid and existing section state are restored, including on failure.
Each failed image has an explicit `imageErrors` entry. `get_document.viewport`
allows comparing camera state before and after preview.

Use `jumpstart_inspect_geometry` with a live `bodyId`, or add `previewId` to
inspect cached preview geometry without applying it. Optional arguments include:

- `section: { "axis": "X", "offset": 0 }`: generated mesh intersection segments.
- `samples: [{ "axis": "Z", "point": [0, 0, 0] }]`: actual line intersections
  and solid intervals, for measuring floors, walls, gaps and clearances along an axis.
- `checks: [{ "id": "width", "kind": "dimension", "axis": "X", "expected": 110,
  "tolerance": 0.05 }]`: expected versus measured tessellation dimensions.
- A `channels` check with `axis: "Y"`, `crossAt: 0`, and
  `expected: { "count": 9, "width": 4, "depth": 3, "floor": 3,
  "spacing": 11.75, "symmetric": true, "openEnds": true }`.

Channel checks infer floors and ridges from section triangles and line
intersections, never submitted primitive dimensions. They support straight,
axis-aligned, parallel channels with a common flat floor, at most 24 channels.
Unsupported or ambiguous geometry fails explicitly. Openness is sampled at
the probe height; this does not establish drainage performance.

Mesh checks report degenerate triangles, boundary and non-manifold edges,
inconsistent winding and connected components. The default weld tolerance is
0.0001 mm and is always reported. Results depend on tessellation and tolerance;
they do not prove absence of self-intersections, overlapping shells, minimum
wall thickness everywhere or physical printability. STL export reports its own
mesh checks; exports over the inspection budget are explicitly not checked.

The validation layers remain separate: schema validity, CAD construction,
requested geometric checks, export mesh checks, and unverified physical fit.
A failed requested check or mesh inspection on a preview blocks its apply.
Correct the model or resolve that inspection before applying. CAD-only previews
remain available when no independent checks are requested.

### Native geometry selection

`get_document(includeGeometry: true)` returns body-local signatures and their
fingerprint. `jumpstart_select_geometry` requires `bodyId`, `expectedRevision`,
`expectedFingerprint`, and a structured query. For example:

```json
{ "kind": "edge", "type": "CIRCLE", "axis": "Z", "extreme": "max" }
```

Queries can filter by coordinate, nearby point, planar normal, cylinder radius,
or `external: false` for an inner cylindrical face. They return candidates and
`selected`, `ambiguous`, `not_found`, or `incomplete`; ambiguous or capped data
never silently selects an element. Reselect after regeneration. These queries
do not provide persistent topological naming or infer design intent.

### Local save and reopen

`jumpstart_save_document({ expectedRevision })` writes the exact document to
the app's browser-local project store and verifies serialization readback.
It does not bump the version or invoke the remote save API.
`jumpstart_reopen_document({ documentId, expectedRevision })` reads only the
current project's saved local JSON and preserves the undo stack. Reopening an
identical snapshot adds no undo entry. A changed saved snapshot is restored as
one recoverable edit. Normal browser reload also preserves parameter templates,
but clears in-memory undo history and preview ids, as ordinary app startup does.

To prepare a fresh document entirely through MCP, call
`jumpstart_preview_new_document({ expectedRevision, name, mode })`, inspect its
new-document metadata and apply its `previewId`. This is one recoverable edit:
undo restores the previous document. Use this before a benchmark, then undo the
document creation after the benchmark has undone its model edits.

After updating the container, save and reload existing editor tabs to load the
new browser bridge. A running old tab cannot execute newly added tools.

## Agent design and revision benchmark

The deterministic tutorial benchmark below tests tool execution. The separate
agent task catalog contains requests and invariants, without prepared plans.
It covers the coaster revision, an unequal-compartment parts tray, and an
impossible-depth request followed by a valid correction.

```sh
npm run benchmark:agent -- tasks
node mcp/benchmarks/agent-runner.mjs begin exports/session.json coaster-revision EDITOR_ID
node mcp/benchmarks/agent-runner.mjs call exports/session.json TOOL_NAME exports/args.json
node mcp/benchmarks/agent-runner.mjs checkpoint exports/session.json candidate
node mcp/benchmarks/agent-runner.mjs checkpoint exports/session.json reopened
node mcp/benchmarks/agent-runner.mjs checkpoint exports/session.json undone
node mcp/benchmarks/agent-runner.mjs finish exports/session.json
```

Give the task to an actual agent. It must generate every tool argument and use
the `call` command for actions, inspections, save/reopen, retries and undo.
The recorder saves tool requests/results and preview images beside the session
file. `candidate` captures native feature readback and independently reads an
actual STL export. Record the `reopened` checkpoint after save and reopen, and
the `undone` checkpoint after undo restores the baseline. `finish` writes
`session.json.report.json` and exits nonzero for missing or failed evidence.

For the coaster, inspect baseline channel floor thickness before revising it.
Inspect the candidate's dimensions, channels, symmetry, openings and mesh.
Exercise duplicate apply and a separate stale preview. The harness checks the
trace against generated geometry, rather than accepting plan dimensions or
agent claims. It never chooses or clears an editor automatically.

The harness is repeatable evaluation infrastructure, not a bundled LLM runner.
Run-to-run model settings, prompts, errors and corrections should be retained
with each session. Development-agent results are integration evidence, not a
statistical general-design success rate. No fake CAD engine is used for
geometry acceptance.

## Implementation files

- `mcp/browser/editor-bridge.js`: editor commands, multi-view capture, preview inspection gates,
  transactions, exports and revision checks.
- `mcp/browser/models.js` and `mcp/shared/parameters.js`: owned native models, persistent
  templates, bounded arithmetic and guarded regeneration.
- `mcp/shared/geometry.js` and `mcp/browser/inspection.js`: independent tessellation
  measurements, semantic selection and bounded mesh checks.
- `mcp/shared/schema.js`, `mcp/server/tool-contracts.mjs` and
  `mcp/server/server.mjs`: runtime input validation, tool discovery,
  local dispatch and export checks.
- `src/projects.js`: native browser-local save and reopen operations.
- `mcp/benchmarks/agent-tasks.mjs` and `mcp/benchmarks/agent-runner.mjs`:
  prompt-only tasks and a trace recorder. Detailed session evidence stays in
  the ignored local `exports/` directory.
- `mcp/tests/mcp-parameters.test.mjs`, `mcp/tests/mcp-models.test.mjs`,
  `mcp/tests/mcp-geometry.test.mjs`, `mcp/tests/mcp-inspection.test.mjs`,
  `mcp/tests/mcp-server.test.mjs` and `mcp/tests/agent-benchmark.test.mjs`: contracts,
  negative cases and regression coverage.
- `package.json` and `README.md`: build commands and local workflow
  documentation. Generated browser files stay under ignored `build/`.

## Tutorial benchmark

The benchmark pairs natural-language prompts with fixed structured plans. It
checks preview isolation, stale-preview rejection, duplicate-apply protection,
browser-kernel geometry, feature history, STL output, and undo. It exercises the
MCP/model-plan path; it does not measure how well a particular model translates
new requests into CAD plans. Run it separately with `npm run benchmark:agent` or
`npm run benchmark:tutorials`; it is not part of `npm test`.

Start a clean JumpStart tab at `http://localhost:3210/?mcp=1`, confirm its document is empty, then run:

```sh
make benchmark
```

If multiple editor tabs are connected, call `jumpstart_list_editors` and set `JUMPSTART_MCP_EDITOR_ID` to the clean tab's id. The runner refuses to start against a document containing bodies or sketches. Each successful case exports an STL to `exports/`, then undoes its edit before starting the next case.

## Lid prototype plan

This plan exercises the round cross-section, revolve, patterned cuts, preview, apply, and export path. The 1.7 mm center thickness is an inferred first pass, chosen to bring the model volume close to the supplied mesh; the underside profile and two cutouts are still approximations. This is not a verified fit for the cup.

```json
{
  "name": "Yogurt lid reference prototype (fit unverified)",
  "sketches": [
    {
      "id": "lid-section",
      "name": "Lid cross-section",
      "plane": "XZ",
      "origin": [0, 0, 0],
      "profile": {
        "type": "polygon",
        "points": [[0, 0], [49.5, 0], [49.5, 5.5], [45.5, 5.5], [45.5, 1.7], [0, 1.7]]
      }
    },
    {
      "id": "lock-relief",
      "name": "Opposed lock reliefs",
      "plane": "XY",
      "origin": [0, 0, 0],
      "profile": { "type": "polygon", "points": [[44, -3], [52, -3], [52, 3], [44, 3]] }
    }
  ],
  "features": [
    { "id": "lid", "name": "Lid body", "type": "revolve", "sketch": "lid-section", "axis": "Z", "angle": 360 },
    {
      "id": "reliefs",
      "name": "Opposed lock reliefs",
      "type": "extrude",
      "sketch": "lock-relief",
      "distance": 5.5,
      "operation": "cut",
      "target": "lid",
      "pattern": { "axis": "Z", "count": 2 }
    }
  ]
}
```

## Native CAD compatibility

MCP plans create normal JumpStart document nodes for sketches, features,
modifiers, and bodies. The editor's geometry kernel evaluates those nodes; apply
and undo use the editor's document store.

`jumpstart_preview_native_model` creates a rectangle with driving width/height
dimensions and an expression-bound extrusion. Creation requires no existing
bodies or sketches. `jumpstart_preview_native_parameters` revises those values
through the native sketch solver. The expression evaluator and metadata are
part of this MCP integration; the editor does not provide a separate Parameters
panel for them. Native parameter models and MCP `mcpModels` remain separate;
parameter revision rejects documents with MCP template metadata.

`jumpstart_preview_lathe` reuses the native Lathe finishing and hollowing code.
Supply a square/round blank, a cut-only axial radius profile, optional hollowing,
and optional uniform scale. The output is a native turned mesh; `latheRecipe` in
body inspection exposes its persisted recipe for revision with `bodyId`.
Native edits outside that recipe must be reconciled before regeneration.
The recipe is editable, but it is not a sketch-based CAD feature tree.
Native hollow bottoms are quantized to axial slices: `latheSampling.axialStepMm`
reports the resolution before scaling. Inspect actual thickness rather than
assuming the requested bottom dimension is exact.

Managed imports are listed with `jumpstart_list_imports`; use the returned
`assetId` in a typed `import` operation. STL operations require explicit
`units: "mm"`, `"cm"`, or `"in"`. Omit `units` for 3MF and STEP so their file
semantics remain authoritative. STL and 3MF become editable mesh bodies; STEP
and STP become native STEP bodies. Imports use the same preview, geometry
inspection, apply, revision, idempotency, and undo workflow as generated
geometry. Only the operator-managed `imports/` directory is read, and Docker
mounts it read-only.

```json
{"id":"housing","type":"import","assetId":"<sha256-from-list-imports>","units":"mm"}
```

The `gear` operation builds a native spur, straight bevel, or rack from
persisted parameters. Spur and bevel outside diameter is `module × (teeth + 2)`;
rack length is `module × teeth × π`. Tooth counts are limited to 6–120, module
to 0.2–50 mm, pressure angle to 14–30 degrees, and face width to 0.1–10,000 mm.
Bevel gears add a 5–80 degree pitch cone angle, defaulting to 45 degrees; their
face width is axial, and a valid plan must leave a positive small-end root
radius. Spur bores must fit below the dedendum root diameter; bevel bores must
fit inside the smaller small-end root diameter. Rack `baseDepth` must be
positive; the total rack height is `baseDepth + 2.25 × module`. The bevel
profile is a conical loft approximation. Spiral bevel teeth, automatic gear-pair
placement, and tooth-mating accuracy checks are not provided.

All new previews use the existing apply/undo, revision and retry guards. No
arbitrary document nodes, JavaScript, or UI clicks are accepted. Interactive
pedal/chisel control and general solver constraints remain unsupported.

`jumpstart_start_tutorial` binds native checks to a blank current document.
`jumpstart_get_tutorial_status` retains automatic predicates observed at each
stage, so bracket values 60 then 80 can both be verified. Manual steps are not
certified. Lathe native checks use the editor's committed turned-body fallback;
independent shape measurements are required to validate the actual top and cup.
The original 16 prepared cases still use independent benchmark predicates, not
full native tutorial progress. Fresh agent reasoning is a separate evaluation.

`jumpstart_save_document` defaults to browser-local exact save. Set `versioned:
true` to save a new native version locally and satisfy tutorial save checks;
this changes the document revision. Read the revision again before more edits.
Successful STL/STEP/3MF files trigger the native export event only after the
server has written and validated the local artifact. Optional parameter CSV
export remains outside the MCP interface.

The MCP parameter list is optional in the document; reads report an empty list
when it is absent without adding metadata to the saved document. The bridge
activates on loopback HTTP pages served by the local MCP server, or with
explicit `?mcp=1`. App files served without the MCP bridge do not poll a broker.

After `npm ci`, install browser prerequisites with `npx playwright install chromium`.
`npm test` builds once, runs MCP contract checks, then runs MCP browser checks
against the Docker app bundle.

## Rectangular frame preset

`jumpstart_preview_frame` creates an open frame using existing primitives and a
boolean cut. Apply and undo use the usual preview id and revision guards.

```json
{
  "editorId": "selected-editor-id",
  "expectedRevision": "current-document-revision",
  "plan": {
    "name": "Wall switch spacer",
    "outerWidth": 86,
    "outerDepth": 86,
    "height": 10
  }
}
```

Omitting `wall` defaults it to 5 mm and labels it assumed. `designContext`
records supplied values, assumptions, and unverified fit. `frameInspection`
measures the generated outer dimensions, opening, four wall samples, and open
centre. Parameter revisions preserve this context and mark explicitly revised
values as supplied. The checks sample an axis-aligned frame; they do not certify
physical installation clearance or minimum thickness everywhere.

For later inspection, pass `frame: {outerWidth, outerDepth, height, wall}` to
`jumpstart_inspect_geometry`. A failed requested frame check blocks applying
that preview. Preview images include `framing` bounds and `fullyVisible` for
checking the complete model fits inside each view; camera and section state are
restored after capture.

Run `npm run benchmark:spacer` against a separate blank editor. Set
`JUMPSTART_MCP_EDITOR_ID` when multiple tabs are connected. It checks the
86 by 86 by 10 mm spacer, revises wall to 4 mm and height to 12 mm, verifies the
78 mm opening, saves/reopens, exports STL, and restores the blank design.

## Codex plugin

`make codex-install` installs the `jumpstart-3d` plugin from a generated local
marketplace. It bundles the host MCP proxy and the
[3d-model skill](plugin/skills/3d-model/SKILL.md). Modeling decisions and worked
examples belong in the skill, rather than the root README.

Requirements: host Node.js 22 or newer and a Codex CLI supporting `codex plugin`.
Start the app separately with `make up` and keep the editor tab open. Restart
Codex or open a new chat after installation; invoke `$3d-model` explicitly.

Run `make codex-install` again after pulling updates. The generated bundle pins
the current host Node executable and receives a content-derived version. The
installer verifies the installed version before removing a matching standalone
`jumpstart` entry. It refuses to replace custom MCP settings or a marketplace
with the same name pointing to a different directory.

`make plugin` writes a portable archive under `dist/`. Extract it into a stable
directory, then run:

```sh
codex plugin marketplace add /path/to/extracted-directory
codex plugin add jumpstart-3d@jumpstart-3d
```

The portable bundle uses `node` on PATH and paths relative to its installed plugin directory. It
contains real files, including the proxy; it does not depend on this checkout.
The app server is still required. The default connection is local port 3210.
Do not configure an additional standalone connection to the same editor.

Source layout:

- `.agents/plugins/marketplace.json`: repository marketplace registration.
- `mcp/plugin/`: distributable manifest, MCP config, runtime, and skill.
- `mcp/packaging/`: local installer and archive builder.
- `mcp/server/stdio-proxy.mjs`: canonical proxy source. Packaging copies it into
  the bundle; contract tests reject a stale copy.

Skill trigger and behavior fixtures are specifications. Structural packaging
checks do not establish natural-language modeling reliability.
