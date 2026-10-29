# AI workspace

The desktop AI workspace separates client connection setup from feature generators.
Gridfinity serves makers arranging useful storage in a measured drawer or creating
individual bins, baseplates and inserts. Its drawer flow is inside measurements,
spatial arrangement, selected-bin settings, inspected 3D preview, and explicit
Add to document.

Use the existing editor theme variables and `mcp/tokens/ai-status.json`. Keep the
CAD palette, typefaces, control states, and keyboard focus conventions. The
desktop workspace has independently scrollable settings and model-review columns.
The AI workspace fills the viewport below the main app header, with a 28 rem
settings column and an expanding layout/preview area on desktop. Cap the column
against the available workspace at intermediate widths and enlarged text sizes;
let field groups respond to their container width instead of the window alone.
Create and AI connection share this full width. Create opens by default; no AI
connection is required to use the generators. Keep the title, workspace
tabs and Close action on one compact desktop header row; switching tabs must not
resize or shift the panel. Stack header navigation only at narrower widths.
Keep the main mode switch available. Covered CAD regions are inert until the
workspace closes; preserve their prior inert state, scene and document. Back to
editor, Escape and choosing a CAD mode restore access. Workspace keys must not
trigger hidden CAD edits; the explicit project Save shortcut remains available.

Disclosure rows use full-row pointer targets, a trailing chevron, and distinct
open/hover/focus states. Inputs use the stronger neutral boundary on a recessed
surface. Hover feedback requires a hover-capable pointer and preserves selected
states. Press feedback uses scale 0.96 over 150 ms ease-out only without reduced
motion; grid dragging and rapid steppers stay static. Contain overlay scrolling.

AI shares the mode control with Beginner, Advanced, Chisel and Architect. Its label stays AI; connection/activity details remain in its accessible
name, tooltip and Connection tab. Opening the workspace highlights AI without
changing the document's CAD mode. Closing it restores that mode's highlight;
choosing a CAD mode closes the AI workspace.

## Drawer-first interaction

- Keep AI connection separate from Create. Show only the selected AI client’s
  setup instructions. Gridfinity is a named generator section,
  with Drawer layout as its workflow. Printer & settings is a
  secondary action. Future unrelated generators
  belong beside Gridfinity, not inside its drawer or part controls.
- Make single Gridfinity parts with the editor's Gridfinity part dialog, beside the other
  part tools, not in the AI workspace. It previews in the viewport, checks the saved
  printer area and keeps one entry point for manual single parts.
- Allow an empty bin arrangement to preview/apply matching baseplates and optional
  spacers. Label it Baseplates only, explain that bins are optional, and reject
  output with neither bins nor baseplates.
- Gridfinity Settings exposes maximum drawer-bin width/depth in cells and shows
  their millimetre footprint. Defaults remain 4 by 4; validated native generation
  supports up to 6 by 6. Persist limits with the drawer, remember browser defaults
  for new drafts, and reject reductions that exceed existing bins without resizing them.
  Keep geometry/time/memory budgets separate from user preferences.
- Printer settings expose editable XY/Z nozzle envelopes and an explicit reserve
  per bed edge. Tile baseplates to the usable area within native limits, trying
  90-degree rotation to reduce tile count. Show required bed rotation without
  moving the drawer assembly. Check measured preview bounds and refresh fit
  after native edits. Keep per-part fit distinct from print-bed packing or physical
  printability. Preserve legacy tiling when no printer is configured.
- Keep New drawer beside the drawer heading, including for unsaved drafts. It clears
  draft bins, measurements and preview in one undoable action, focuses width, and
  leaves already applied CAD bodies unchanged.
- Offer optional corner spacers beside measured spare space. Generate separate,
  flat-bottom native parts outside the centered grid, with adjustable clearance,
  height and contact legs. Show their count and test-fit guidance. Do not silently
  produce thin walls or certify drawer-corner shape, friction or printed fit.
- Ask for inside width, depth, and usable height in millimetres. Derive the 42 mm grid
  and show spare space per side. Example measurements must be explicitly chosen and labelled.
- Draw and move bins directly on the grid, with keyboard and stepper alternatives.
  Reject overlap and out-of-bounds placement; keep the previous valid arrangement.
- Reveal the selected bin's name, footprint, height and Stackable rim option initially. Keep
  compartment choices in their disclosure, opening it for configured dividers. Put
  construction settings under Advanced. Show physical millimetres alongside cells.
- Selecting a bin collapses drawer measurements and reveals the inspector near the
  top of the left column. Keep its bin name and Rotate/Duplicate/Remove actions
  sticky while scrolling. Do not move the layout or steal board keyboard focus,
  and do not reset inspector scrolling during field edits.
- Collapse measured drawer dimensions into an editable summary after bins are
  added, so selected-bin controls stay near the grid instead of below setup fields.
- Keep draft undo separate from native document undo. Planner navigation must not
  trigger editing shortcuts on CAD objects behind the panel.
- Keep layout and 3D review in the same workspace. Geometry is generated by typed
  native plans, inspected, then explicitly applied as one recoverable edit.
- Let users orbit and zoom the drawer's cached 3D proposal without changing its
  geometry or the editor camera. Provide keyboard controls, Top view and Reset view.
  Retain the stale-preview/apply guards and dispose replaced or cancelled viewers.
- Preserve other document bodies. Regenerating a saved layout must reject native
  edits, missing parts, locks or external dependencies that regeneration would discard.
- Applied layouts belong to the native project and survive save/reopen. Do not
  imply an unapplied draft is already saved in the project.
- Keep magnet pockets optional and off by default. Show pocket dimensions, not
  ambiguous magnet diameters, and account for the magnetic carrier's added height
  in drawer-fit checks. Place these controls under More bin options/Advanced.

## Pictograms and control width

Use the wider shared control-column token for the drawer, part and printer views.
Keep the working canvas flexible and retain the stacked narrow layout. Supplement
main navigation, drawer measurements and common spatial actions with the editor's
SVG pictograms. Keep their text labels and accessible names; hide decorative
icons from assistive technology and inherit each control's theme/state color.
Use a consistent icon box and label alignment. Numeric entry and height choices
remain text controls, rather than accumulating decorative icons.

## Beginner controls and review

- Use a task heading and a Measure / Arrange / Review indicator for drawer work.
  Keep Add bin and Fill gaps beside the canvas. Show an inside-measurement sketch
  and an explicitly chosen sample drawer before dimensions are entered.
- Keep the control column's action footer outside its scrolling content. Selecting
  a bin reveals its settings without moving the canvas; keyboard focus must remain
  visible as the inspector scrolls.
- The Gridfinity part dialog starts with Bin. Use a compact illustrated type selector, footprint
  steppers, physical-height presets and an exact height disclosure. Put wall/floor
  thickness and magnets under Construction & magnets, and compartment/stacking
  options in their own disclosure. Inserts retain measured cutouts, with Position
  & fit and reference evidence disclosed separately.
- A proportional SVG sizing sketch updates while editing. It is a guide, not an
  inspected model. Both part and drawer native previews support orbit, zoom,
  Top view and Reset view. Keep explicit preview, geometry inspection and apply.
- Check single-part measured preview bounds against the saved printer area before
  allowing apply. A printer envelope check does not certify physical printed fit.
- Printer setup pairs editable controls with a proportional build-area diagram.
  Preserve browser preferences, per-drawer limits and print-fit metadata.

## Open-sided bins for long items

- Offer left, right, front and back openings on bins. Keep the entire floor and
  protected Gridfinity base, and cut the matching stacking rim at the opening.
  Inserts and baseplates do not accept wall openings.
- Keep the option in the selected bin inspector and the single-part bin options.
  Keep it collapsed until needed, and reveal configured openings on selection.
  Use labeled pressed buttons with explicit Open/Closed state and a small side
  diagram. Dashed bin edges and a shared legend show openings on the plan;
  the selected-bin disclosure, tooltip and accessible name identify the sides.
- Front is the lower edge of the plan (-Y); back is +Y. Rotate openings with the
  footprint. Duplicate preserves them; draft undo and document save/reopen retain
  them. Switching to an insert clears incompatible openings.
- Adjacent bins remain independent printable parts. Match the two facing openings
  and align them on a baseplate; a seam remains and no mechanical join is added.
  Keep printer checks per part, including newly generated preview bounds.
- Validate removed walls and rims with real native geometry, retained lower-base
  overlap, connected meshes, and a long-item envelope crossing the seam. Physical
  fit and the actual item's width/clearance remain user measurements.

## Reference adaptation

The interaction reference is `andymai/gridfinity-layout-tool`, snapshot
`6753e8b28706d008c86755dacb3fe8643b2ac358`. Observed mechanisms: draw-to-create
footprints, a selected-bin inspector, and drawer-fit margins. We independently
implemented those ideas for our native document and MCP architecture; no AGPL
implementation, branding, palette or typography was copied. See `SOURCES.md`.

The reference also includes layers, categories, sharing, print estimates and
many advanced controls. Our drawer flow keeps those outside its first-use path.

## Verification

Exercise measurements, drawing, pointer cancel, moving, keyboard resize,
collision recovery, gap filling, height fit, undo, preview staleness, apply,
save/reopen and safe regeneration. Inspect real screenshots in supported themes
and at representative desktop sizes. Treat physical printed fit as unverified.

The AI mode entry was checked open/closed at 1280, 1440 and 1920 px in light,
dark and high contrast: aligned button bounds and zero live top-bar axe violations.
Keyboard opening, Escape/focus return and returning to Advanced have browser coverage.
The kit's mobile-first gate still flags the existing whole-editor base toolbar.
The panel gate harness bundles the production UI modules and original theme CSS.
It derives the kit’s semantic contrast pairs from those actual theme definitions;
no separate palette is maintained. Run `node mcp/tests/run-ai-panel-gates.mjs` for
the panel gates, and `npm test` for native geometry and transaction coverage.

## Imported manual tools

The 2.7.4 source adaptation adds Architect alongside the existing manual modes;
AI remains a separate workspace entry. Shared `tool-choice` controls expose
combobox/listbox semantics, explicit selected and disabled states, typeahead,
arrows, Home/End, Escape and commit with Enter/Space. Native option nodes are
hidden metadata, not visible platform selects. Theme and sizing primitives come
from `mcp/tokens/ai-status.json`; `src/tool-ui.css` shares the host CSS variables.

On phones, the model view precedes the settings and parts list. Desktop tools
expand the canvas between readable, scrollable control regions. Keep material,
terrain and mesh colour choices as object data; interface accents follow the
host theme. Manual tool lifecycles own their drafts. Leave Architect or close
CAM, Voxel and CosForge before applying MCP mutations.

Keep the original document, workers and native CAD controllers while the maker workspace is ported.


## Drawer orientation

The measurement fields include a neutral **Swap width & depth** action. It rotates
an entire drawer draft 90 degrees clockwise, keeping usable height unchanged.
Bin positions, dimensions, dividers, open sides and directional size limits rotate
together. IDs and other construction options stay intact. The action works before
height is entered for an empty drawer, preserves existing bins, creates one local
undo step and invalidates the previous preview. Applying the rotated model still
requires a new inspected preview and explicit Add to document.

Undo/Redo preserve focus across measurement and inspector reordering. If the
previous control disappears, focus moves to an available layout history action.


## Drawer stacking rims

Selected storage bins expose **Stackable rim** directly below height. Use the
existing native lip geometry and height validation, with local undo and preview
invalidation. The note reports the extra 4.4 mm and actual bin height; the complete
stack must still be checked against the drawer. Opening all sides removes every
rim, which the note states explicitly. Insert blanks do not expose this option.

The desktop settings scroller reserves the measured sticky bin-header height so
keyboard-focused controls remain visible even when the header wraps.


## Flush joins for open-sided bins

Open sides includes **Close gaps on open sides** in both drawer and single-part
creation. Preserve the standard rounded geometry by default for existing models.
The opt-in mode squares only corners touching an opening and extends each open
edge by 0.25 mm to the cell boundary, straight down to the foot tops at Z=4.75
mm. Remove the rounded ledge previously retained between that plane and Z=7.
Enable on both neighbours. Keep the feet below Z=4.75 unchanged; preserve rounded
closed corners, magnet placement, dividers, stacking and layout ownership. Report actual
enlarged dimensions and enforce their printer envelope. Clearing the last open
side clears and disables the option. Preview changes remain explicit and undoable.

## Preview dimension summary

Group each measured axis label with its value in a compact definition-list pair.
Use Width (X), Depth (Y) and Height (Z), with stronger tabular numbers. Keep the
summary at its intrinsic width and let pairs wrap on narrow screens or enlarged
text. Preserve the numeric value and its millimetre unit together.

## Drawer workspace hierarchy

The user-approved 1586 × 992 drawer-workspace reference is the visual contract for this screen. Use system UI type, the shared 32 rem `workspaceSettingsWidth` column, aligned full-height outer panels, and a bordered measurement card containing the initial Preview action. Width/depth share a row; usable height and drawer name have full rows. Swap remains a secondary action. The completed-layout Preview action stays in the existing fixed action footer.

Create/AI connection use text tabs with an active underline; retain labels, keyboard navigation and ids. Drawer/printer settings use one quiet segmented group. The three progress labels sit below numbered circles, connected between steps. Place the large open-drawer illustration, guidance and labelled example at a stable offset beneath the steps; never vertically center the whole guide in an arbitrarily tall pane.

Use the generated open-drawer asset as an illustration, not validated model geometry. Preserve the actual Studio branding and working CAD app bar, the native plan/preview/apply/undo contracts, saved layouts, field ids, and selected-bin inspection. Input boundaries retain the existing accessible contrast even where the visual reference is fainter. Other generator dimension diagrams are unchanged.

Stack the workspace based on its container width in rem units. Narrow screens and enlarged text use content scrolling; short windows must allow each field and Preview to be scrolled into view without overlap. Both preview buttons share one renderer and only the action appropriate to the current measurement state is visible.

The narrow header owns both rows of navigation; keep tab/close labels on one line and allow whole groups to wrap at enlarged text sizes. Progress and layout controls stay outside the scrolling board area, so they cannot be clipped or cover one another. Reset the guide scroll only when measurement readiness becomes false; do not move the board when selecting bins. At shorter desktop heights, use compact field spacing and a bottom scroller inset to keep Preview reachable.

The CAD toolbar height consumes the same `panelTop` token as the workspace overlay, so enlarged text cannot leave the ribbon visible between them. Normal-size toolbar geometry remains 46 px.
