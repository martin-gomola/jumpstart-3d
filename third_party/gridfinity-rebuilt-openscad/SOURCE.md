# Gridfinity geometry reference

- Repository: https://github.com/kennetek/gridfinity-rebuilt-openscad
- Reviewed revision: `910e22d8607fd7f5f51ad5e5cbc5287a76810bfd`.
- Reviewed files: `src/core/standard.scad`, `src/core/base.scad`,
  `src/core/gridfinity-baseplate.scad`.
- License: MIT. Root notices name Kenneth Hodson (2023), Zachary Freedman
  and Voidstar Lab LLC (2023). The baseplate source also names Arthur Moore
  (2025, MIT); that notice is retained below and in the implementation.
- Adaptation: the dimensional foot, socket and stacking-lip profiles are
  expressed as editable native JumpStart sketches, lofts, extrusions and
  boolean groups. No OpenSCAD runtime or source implementation is included.
- Width/depth use a 42 mm grid. Bin/insert outside dimensions subtract
  0.5 mm once from the full width/depth. Height units measure 7 mm from
  the foot bottom to the wall top, excluding the optional 4.4 mm lip.
- The supported baseplate is an open, 5 mm tall socket grid. An aligned
  bin/insert foot bottom is 0.25 mm above the baseplate bottom.
- Physical printed compatibility remains unverified until a fit coupon is tested.

Additional source notice: Copyright Arthur Moore 2025, MIT License.
The complete permission grant and warranty terms are in LICENSE.
