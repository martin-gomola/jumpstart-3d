// Modal lifecycle shared by the standalone manual workspaces.
const sessions = new WeakMap();
export function openToolWindow(root, close) {
  const previousFocus = document.activeElement;
  const siblings = [...document.body.children].filter(e => e !== root).map(e => [e, e.inert]);
  for (const [element] of siblings) element.inert = true;
  root.setAttribute("aria-modal", "true");
  root.tabIndex = -1;
  const controls = () => [...root.querySelectorAll('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), a[href], tool-choice:not([disabled]), [tabindex="0"]')].filter(e => e.getClientRects().length && !e.closest('[hidden], [inert]'));
  const trap = e => {
    if (e.key !== "Tab" || e.defaultPrevented || !root.contains(document.activeElement)) return;
    const list = controls();
    const first = list[0] || root, last = list.at(-1) || root;
    if (e.shiftKey && (document.activeElement === first || document.activeElement === root)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (document.activeElement === last || document.activeElement === root)) { e.preventDefault(); first.focus(); }
  };
  const key = e => {
    e.stopPropagation();
    if (e.key === "Escape") { e.preventDefault(); close(); return; }
    trap(e);
  };
  // Tool handlers use window capture, so the Tab trap must run there too.
  window.addEventListener("keydown", trap, true);
  root.addEventListener("keydown", key);
  sessions.set(root, () => {
    root.removeEventListener("keydown", key);
    window.removeEventListener("keydown", trap, true);
    for (const [element, inert] of siblings) element.inert = inert;
    if (previousFocus?.isConnected) previousFocus.focus();
  });
  queueMicrotask(() => { if (root.isConnected) (controls()[0] || root).focus(); });
}
export function closeToolWindow(root) { sessions.get(root)?.(); sessions.delete(root); }
