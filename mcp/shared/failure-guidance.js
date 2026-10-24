// Categories guide recovery; they do not establish the CAD operation's underlying cause.
export function failureGuidance(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/timed? out|timeout/i.test(message)) return { category: "timeout", cause: "unverified", nextChecks: ["Read the document revision and current geometry before retrying an uncertain operation.", "Reuse the same preview id for an apply retry; do not create a duplicate edit."] };
  if (/budget|exceeds? .*limit|too many|resource/i.test(message)) return { category: "resource_limit", cause: "unverified", nextChecks: ["Reduce the requested inspection, image, or geometry scope within the advertised limits.", "Inspect intermediate geometry before simplifying the design."] };
  if (/stale|changed after preview|document changed|expired/i.test(message)) return { category: "stale_state", cause: "state_changed_or_expired", nextChecks: ["Reread the target editor and document revision, then create and inspect a new preview."] };
  if (/unsupported|not supported/i.test(message)) return { category: "unsupported", cause: "unverified", nextChecks: ["Read the focused capability schema and choose a supported operation or report the missing capability."] };
  if (/requirements|geometry checks/i.test(message)) return { category: "acceptance", cause: "requirements_not_satisfied", nextChecks: ["Inspect the attached requirement results; correct the design and preview again.", "Do not weaken a user requirement to make the preview pass."] };
  return { category: "validation_or_execution", cause: "unverified", nextChecks: ["Inspect the reported input or geometry failure and its relevant source feature before changing the model."] };
}
