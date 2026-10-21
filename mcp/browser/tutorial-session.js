export function tutorialSession(app, getDocument) {
  let session = null;
  function status() {
    if (!session) return { tutorialId: null, complete: false, steps: [] };
    const doc = getDocument();
    if (doc.id !== session.documentId) throw new Error("The tutorial document changed; start a new tutorial session");
    const steps = session.tutorial.steps.map((step, index) => {
      const automatic = typeof step.check === "function";
      let passedNow = false, error;
      if (automatic) {
        try { passedNow = !!step.check(app.tutorials.T); }
        catch (failure) { error = String(failure.message || failure).slice(0, 256); }
      }
      if (passedNow) session.observed.add(index);
      return { index, title: step.title, automatic, passed: automatic ? session.observed.has(index) : null, passedNow, ...(error ? { error } : {}) };
    });
    const required = steps.filter(step => step.automatic);
    return { tutorialId: session.tutorial.id, documentId: session.documentId, steps,
      requiredChecksPassed: required.filter(step => step.passed).length, requiredChecksTotal: required.length,
      complete: required.every(step => step.passed),
      latheEvidence: /Lathe/.test(session.tutorial.title) ? "Native final turned-body fallback; pedal and chisel interactions are not demonstrated. Independent geometry validation is required." : null };
  }
  return {
    start(tutorialId) {
      const doc = getDocument();
      if (doc.bodies.length || doc.sketches.length) throw new Error("Start tutorial checks only on a blank document");
      const tutorial = app.tutorials.list.find(tutorial => tutorial.id === tutorialId);
      if (!tutorial) throw new Error("Unknown built-in tutorial id");
      // Native resume binds its save/export checks without creating a new document.
      app.tutorials.start(tutorialId, true);
      session = { tutorial, documentId: doc.id, observed: new Set() };
      return status();
    }, status,
  };
}
