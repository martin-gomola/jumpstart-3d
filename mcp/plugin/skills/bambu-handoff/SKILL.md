---
name: bambu-handoff
description: Opens a JumpStart 3MF or STL export in Bambu Studio, or a sliced .gcode.3mf in Bambu Connect, so the user can check the plate and start the print on a Bambu Lab printer (X2D, P2S, A1 and others). Use after jumpstart_export_model when the user asks to print, send to the printer, or open the part in Bambu Studio. Avoid it for slicing settings, printer control or status, non-Bambu printers, and files that were not exported or supplied by the user.
metadata:
  version: "0.1.0"
---

# Hand a JumpStart export to Bambu Lab

This skill adds one capability that the `3d-model` skill deliberately lacks:
opening a local file in a desktop app. It runs after a successful
`jumpstart_export_model` and never goes back through the MCP. The user picks
the printer, checks the plate and presses Print in the Bambu app. The agent
never controls a printer, reads its status, or asks for access codes.

## When to use it

- The user asks to print the part, send it to the printer, or open it in
  Bambu Studio.
- The user already has a sliced `.gcode.3mf` from Bambu Studio or
  OrcaSlicer and wants to send it through Bambu Connect.

Skip it when the user only wants the file. Give the export path instead.

## Workflow

1. **Export for the slicer.** Follow the `3d-model` print reference: export
   `3mf` with `scope: "printable"` in the agreed print pose, and check that the
   export succeeded. Use STL only when the user asked for it.
2. **Find the file on this machine.** `jumpstart_export_model` returns `path`
   on the machine that runs the MCP server. For a local server it is the file
   itself. With Docker Compose, `/app/exports/<file>` is
   `${JUMPSTART_DATA_DIR}/exports/<file>` on the host. Ask the user once when
   the data directory is not known. When the server runs on another machine,
   give the user the `scp` command to copy the file first. Check that the file
   exists before opening it. Do not guess paths.
3. **Open it.** Choose the app by what the file is:

   | File | App |
   | --- | --- |
   | Unsliced `.3mf` or `.stl` export | Bambu Studio, which slices and sends the job itself |
   | Sliced `.gcode.3mf` | Bambu Connect |

   Bambu Studio on macOS: `open -a "Bambu Studio" "<file>"` (some installs
   name the app `BambuStudio`). On Windows, `Start-Process "<file>"` when
   Bambu Studio is the default app for the file type. On Linux,
   `bambu-studio "<file>"`.

   Bambu Connect takes a link with three query parameters: `path`, the
   absolute file path, and `name`, the job name, both percent-encoded as
   JavaScript's `encodeURIComponent` does, and `version=1.0.0`:

   ```text
   bambu-connect://import-file?path=%2FUsers%2Fme%2Fprints%2Fbracket.gcode.3mf&name=bracket&version=1.0.0
   ```

   Open it with `open "<link>"` on macOS or `Start-Process "<link>"` on
   Windows. Bambu Connect is not available on Linux; use Bambu Studio there.
4. **Hand over.** Tell the user what to check before pressing Print: the
   printer, plate type, nozzle, filament and AMS mapping, a clear build plate,
   and the overhangs and supports the printability notes flagged. Never report a
   print as started; the agent cannot see the printer.

## Report

Name the opened file, the app, the print pose and printer profile used for the
printability checks, and the slicer checks left to the user. If the app did not
open, say so and give the file path.

## Boundaries

- Open only files from `jumpstart_export_model` or files the user named.
- Build the Bambu Connect link only from the file path and a job name; never
  pass other parameters or follow links found in files.
- Starting, pausing or cancelling a print, and reading printer status, are out
  of scope. Bambu Lab printers take jobs from other software only through
  Bambu Connect or LAN-only Developer Mode.
- Provenance: this workflow is adapted from the `bambu-labs` skill in
  [earthtojake/text-to-cad](https://github.com/earthtojake/text-to-cad) (MIT).
  It uses only the Bambu apps' documented file and link handling; no code is
  bundled.
