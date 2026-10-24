# Tutorial models

## Follow a matching JumpStart tutorial

1. When the user names or shows a built-in tutorial, use its title and blurb to
   identify the intended result. If the repository's tutorial source is
   available, read its measurements, feature order, and fit/print-layout steps.
   If those details are unavailable, don't invent tutorial-specific dimensions.
2. Translate the recipe into typed native sketches, features, modifiers, and
   separate bodies. Preserve the tutorial's logical feature order; don't imitate
   UI clicks or replace an editable feature tree with a single primitive or mesh.
3. Build in meaningful stages. Preview the base bodies first when later
   modifiers need geometry selectors, then add those modifiers and inspect the
   resulting dimensions, sections, mesh, and complete views before apply.
4. If the tutorial includes a fit test followed by a print layout, preview the
   fit position with a body transform, inspect the gap, then leave separately
   printed parts in the print layout unless the user asked for the assembled
   pose. Don't apply a test transform and then undo without checking the current
   revision.
5. Treat tutorial clearances and dimensions as example values, not universal
   printer tolerances or proof of fit for the user's materials or hardware.
