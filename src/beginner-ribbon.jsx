import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal, flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { ICON } from "./icons.js";
import { BEGINNER_SECTIONS, foldedSections } from "./beginner-ribbon-layout.js";

const TOOLS = {
  copy: { id: "bb-copy", icon: "copy", label: "Copy", title: "Copy (Ctrl+C)", enabled: (s) => s.n > 0 },
  paste: { id: "bb-paste", icon: "paste", label: "Paste", title: "Paste (Ctrl+V)", enabled: (s) => s.canPaste },
  dup: { id: "bb-dup", icon: "duplicate", label: "Duplicate", title: "Duplicate (Ctrl+D)", enabled: (s) => s.n > 0 },
  del: { id: "bb-del", icon: "del", label: "Delete", title: "Delete (Del)", enabled: (s) => s.n > 0 },
  sketch: { id: "bb-sketch", icon: "sketch", label: "Sketch", title: "Draw a 2D sketch on the workplane or a flat face" },
  sketch3d: { id: "bb-sketch3d", icon: "spline", label: "3D Sketch", title: "Draw lines in 3D on a shape, a virtual sphere or cube, or in the air" },
  extrude: { id: "bb-extrude", icon: "extrude", label: "Extrude", title: "Extrude a sketch into a shape (E)" },
  import: { id: "bb-import", icon: "import", label: "Import", title: "Import a 3D model (STL, 3MF or STEP), an SVG or DXF drawing (to extrude), or a picture to trace" },
  fastener: { id: "bb-fastener", icon: "thread", label: "Fastener", title: "Bolts, nuts, threaded rods and tap cutters, metric and inch" },
  gear: { id: "bb-gear", icon: "gear", label: "Gear", title: "Spur gears, bevel gears and racks by module and tooth count" },
  nameplate: { id: "bb-nameplate", icon: "tag", label: "Name plate", title: "A tag or name plate sized to its text, with raised or cut-in letters" },
  knurl: { id: "bb-knurl", icon: "knurl", label: "Knurled knob", title: "A knob or grip with straight V grooves all round and an optional round, hex or D bore" },
  spring: { id: "bb-spring", icon: "spring", label: "Coil spring", title: "A compression spring of round wire, with open ends or ends cut flat" },
  group: { id: "bb-group", icon: "group", label: "Group", title: "Group (Ctrl+G): merges solids, cuts holes" },
  ungroup: { id: "bb-ungroup", icon: "ungroup", label: "Ungroup", title: "Ungroup (Ctrl+Shift+G)", enabled: (s) => s.canUngroup },
  hole: { id: "bb-hole", icon: "holeToggle", label: "Hole", title: "Make hole (H)", enabled: (s) => s.n > 0 },
  solid: { id: "bb-solid", icon: "box", label: "Solid", title: "Make solid (S)", enabled: (s) => s.n > 0 },
  align: { id: "bb-align", icon: "align", label: "Align", title: "Align (A)", enabled: (s) => s.n > 0 },
  mirror: { id: "bb-mirror", icon: "mirror", label: "Mirror", title: "Mirror (M)" },
  pattern: { id: "bb-pattern", icon: "pattern", label: "Pattern", title: "Make rows or circles of copies", enabled: (s) => s.n > 0 },
  drop: { id: "bb-drop", icon: "drop", label: "Drop", title: "Drop to workplane (D)", enabled: (s) => s.n > 0 },
  lock: { id: "bb-lock", icon: "lock", label: "Lock", title: "Lock or unlock (Ctrl+L)", enabled: (s) => s.n > 0 },
  fillet: { id: "bb-fillet", icon: "fillet", label: "Fillet", title: "Round the edges of a shape: click edges or a face, or round all of its edges" },
  shell: { id: "bb-shell", icon: "shell", label: "Shell", title: "Make a shape hollow inside with a wall you choose, or open it up like a cup or box" },
  texture: { id: "bb-texture", icon: "texture", label: "Texture", title: "Add a surface texture (T)" },
  facepat: { id: "bb-facepat", icon: "facePattern", label: "Face pattern", title: "Raise or cut a hexagon, diamond plate or screen mesh pattern on a flat face" },
  measure: { id: "bb-measure", icon: "measure", label: "Measure", title: "Measure sizes, distances and angles (I)" },
  printsim: { id: "bb-printsim", icon: "printsim", label: "3D Print Sim", title: "Simulate printing it: supports, layers, strength, print time" },
  cosforge: { id: "bb-cosforge", icon: "cosforge", label: "CosForge", title: "Design a cosplay costume on a body built from your measurements, then cut it into printable pieces (opens in its own window)" },
  lathe: { id: "bb-lathe", icon: "lathe", label: "Lathe", title: "Turn a shape or a wood blank on a virtual lathe, with chisels, then hollow it out" },
};
const CARET = '<svg viewBox="0 0 10 10" width="9" height="9"><path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function tool(name, state) {
  const t = TOOLS[name];
  const locked = name === "lock" && state.allLocked;
  return { ...t, icon: locked ? "unlock" : t.icon, label: locked ? "Unlock" : t.label, enabled: t.enabled ? t.enabled(state) : true };
}

function Icon({ name }) {
  return <i className="ri" aria-hidden="true" dangerouslySetInnerHTML={{ __html: ICON[name] }} />;
}

function ToolButton({ name, state, actions }) {
  const t = tool(name, state);
  return (
    <button type="button" className={"rbtn" + (name === "group" && state.n < 2 ? " dim" : "")} id={t.id} title={t.title} disabled={!t.enabled} onClick={(e) => actions[name](e.currentTarget)}>
      <Icon name={t.icon} />
      <span>{t.label}</span>
    </button>
  );
}

function SectionMenu({ section, anchor, state, actions, onClose }) {
  const ref = useRef(null);
  const r = anchor.getBoundingClientRect();
  useEffect(() => {
    ref.current.querySelector("button:not(:disabled)")?.focus();
    const outside = (e) => { if (!ref.current.contains(e.target) && !anchor.contains(e.target)) onClose(); };
    const esc = (e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); anchor.focus(); } };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", esc, true);
    return () => { document.removeEventListener("pointerdown", outside, true); document.removeEventListener("keydown", esc, true); };
  }, [anchor, onClose]);
  return createPortal(
    <div ref={ref} className="rmenu" role="menu" aria-label={section.title} style={{ left: r.left, top: r.bottom + 4 }}>
      {section.tools.map((name) => {
        const t = tool(name, state);
        return (
          <button type="button" role="menuitem" key={name} id={t.id} title={t.title} disabled={!t.enabled} onClick={() => { onClose(); actions[name](anchor); }}>
            <Icon name={t.icon} />
            <span>{t.label}</span>
          </button>
        );
      })}
    </div>,
    document.body,
  );
}

function Section({ section, folded, open, setMenu, state, actions, groupRef }) {
  return (
    <div className="rgroup" ref={groupRef} data-section={section.id}>
      <div className="rrow">
        {folded ? (
          <button type="button" className="rbtn rdrop" id={"bb-sec-" + section.id} title={section.title + " tools"} aria-label={section.title + " tools"} data-holds={section.tools.map((n) => TOOLS[n].id).join(" ")}
            aria-haspopup="menu" aria-expanded={String(open)} onClick={(e) => setMenu(open ? null : { id: section.id, anchor: e.currentTarget })}>
            <Icon name={TOOLS[section.tools[0]].icon} />
            <span><i className="dcaret" dangerouslySetInnerHTML={{ __html: CARET }} /></span>
          </button>
        ) : section.tools.map((name) => <ToolButton key={name} name={name} state={state} actions={actions} />)}
      </div>
      <div className="rtitle">{section.title}</div>
    </div>
  );
}

function sameSet(a, b) {
  return a.size === b.size && [...a].every((x) => b.has(x));
}

function BeginnerRibbon({ store, actions }) {
  const state = useSyncExternalStore(store.subscribe, store.get);
  const hostRef = useRef(null), trailRef = useRef(null), groups = useRef({}), widths = useRef({}), foldedWidths = useRef({});
  const [available, setAvailable] = useState(Infinity);
  const [folded, setFolded] = useState(() => new Set());
  const [menu, setMenu] = useState(null);
  const closeMenu = useCallback(() => setMenu(null), []);

  useLayoutEffect(() => {
    const host = hostRef.current;
    const measure = () => setAvailable(host.clientWidth - trailRef.current.offsetWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);
  // Folded sections keep the open width measured before they folded.
  useLayoutEffect(() => {
    for (const s of BEGINNER_SECTIONS) {
      const g = groups.current[s.id];
      if (g) (folded.has(s.id) ? foldedWidths : widths).current[s.id] = g.offsetWidth;
    }
    const next = foldedSections(BEGINNER_SECTIONS, widths.current, foldedWidths.current, available);
    if (!sameSet(next, folded)) setFolded(next);
  });

  const menuSection = menu && folded.has(menu.id) && BEGINNER_SECTIONS.find((s) => s.id === menu.id);
  return (
    <div className="bribbon-row" ref={hostRef}>
      {BEGINNER_SECTIONS.map((s) => (
        <Section key={s.id} section={s} folded={folded.has(s.id)} open={menuSection?.id === s.id} setMenu={setMenu} state={state} actions={actions}
          groupRef={(node) => { groups.current[s.id] = node; }} />
      ))}
      <div className="rtrail" ref={trailRef}>
        <button type="button" className="rbtn" id="bb-multi" title="Tap shapes to add them to the selection (same as Shift+click)" aria-pressed={String(state.multi)} onClick={() => actions.multi()}>
          <Icon name="select" />
          <span>Multi-select</span>
        </button>
        <button type="button" className="ibtn panel-toggle" onClick={() => actions.objects()}><span className="lbl">Objects</span></button>
      </div>
      {menuSection && <SectionMenu section={menuSection} anchor={menu.anchor} state={state} actions={actions} onClose={closeMenu} />}
    </div>
  );
}

// Mounts the beginner ribbon; `update` re-renders synchronously so chained clicks see current buttons.
export function mountBeginnerRibbon(host, actions, initial) {
  let state = initial;
  const listeners = new Set();
  const store = { get: () => state, subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); } };
  const root = createRoot(host);
  flushSync(() => root.render(<BeginnerRibbon store={store} actions={actions} />));
  return {
    update(next) { state = next; flushSync(() => listeners.forEach((fn) => fn())); },
    unmount: () => root.unmount(),
  };
}
