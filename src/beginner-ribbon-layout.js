// Beginner ribbon sections. `fold` orders which sections collapse into a menu when the
// ribbon runs out of room (lowest first); sections without it always stay open.
export const BEGINNER_SECTIONS = [
  { id: "edit", title: "Edit", tools: ["copy", "paste", "dup", "del"] },
  { id: "create", title: "Create", fold: 5, tools: ["sketch", "sketch3d", "extrude", "import"] },
  { id: "parts", title: "Parts", fold: 1, tools: ["gridfinity", "fastener", "gear", "nameplate", "knurl", "spring"] },
  { id: "combine", title: "Combine", tools: ["group", "ungroup", "hole", "solid"] },
  { id: "arrange", title: "Arrange", fold: 4, tools: ["align", "mirror", "pattern", "drop", "lock"] },
  { id: "modify", title: "Modify", fold: 3, tools: ["fillet", "shell", "texture", "facepat"] },
  { id: "check", title: "Check", fold: 2, tools: ["measure", "printsim"] },
  { id: "workshops", title: "Workshops", fold: 0, tools: ["cosforge", "lathe"] },
];

// Folds sections, lowest `fold` first, until the widths fit `available`, then reopens the
// most important folded sections that still fit. `widths` and `foldedWidths` hold each
// section's open and folded width; unmeasured folded widths use `foldedGuess`.
export function foldedSections(sections, widths, foldedWidths, available, foldedGuess = 64) {
  const saving = (s) => (widths[s.id] || 0) - (foldedWidths[s.id] ?? foldedGuess);
  const order = sections.filter((s) => s.fold !== undefined).sort((a, b) => a.fold - b.fold);
  let total = sections.reduce((sum, s) => sum + (widths[s.id] || 0), 0);
  const folded = new Set();
  for (const s of order) {
    if (total <= available) break;
    folded.add(s.id);
    total -= saving(s);
  }
  for (const s of [...order].reverse()) {
    if (folded.has(s.id) && total + saving(s) <= available) {
      folded.delete(s.id);
      total += saving(s);
    }
  }
  return folded;
}
