// Shared choice control for the imperative editor tools. Option nodes are data only;
// the visible control and popup use combobox/listbox semantics and the app theme.
let nextChoice = 0;
export class ToolChoice extends (globalThis.HTMLElement || class {}) {
  static observedAttributes = ["disabled", "aria-label", "aria-labelledby", "aria-busy"];
  constructor() {
    super();
    this._value = undefined;
    this._active = 0;
    this._buffer = "";
    this._typedAt = 0;
    this._label = document.createElement("span");
    this._label.className = "tool-choice-label";
    this._arrow = document.createElement("span");
    this._arrow.className = "tool-choice-arrow";
    this._arrow.setAttribute("aria-hidden", "true");
    this._arrow.textContent = "⌄";
    this._list = document.createElement("div");
    this._list.className = "tool-choice-list";
    this._list.id = `tool-choice-list-${++nextChoice}`;
    this._list.setAttribute("role", "listbox");
    this._list.setAttribute("popover", "auto");
    this._list.addEventListener("toggle", () => {
      const open = this._list.matches(":popover-open");
      this.setAttribute("aria-expanded", String(open));
      if (!open) this.removeAttribute("aria-activedescendant");
    });
    this.addEventListener("click", e => {
      if (this.disabled || this._list.contains(e.target)) return;
      e.preventDefault(); this.open ? this.close() : this.show();
    });
    this.addEventListener("keydown", e => this.key(e));
    this._observer = new MutationObserver(() => this.sync());
  }
  connectedCallback() {
    this.setAttribute("role", "combobox");
    this.setAttribute("aria-haspopup", "listbox");
    this.setAttribute("aria-controls", this._list.id);
    this.setAttribute("aria-expanded", "false");
    // Construction happens before connection, so option children are available here.
    this.append(this._label, this._arrow, this._list);
    if (!this.hasAttribute("aria-label") && !this.hasAttribute("aria-labelledby")) {
      const label = (this.id && document.querySelector(`label[for="${CSS.escape(this.id)}"]`));
      const enclosing = this.closest("label");
      const fieldName = enclosing && [...enclosing.children].filter(e => e !== this).map(e => e.textContent.trim()).join(" ");
      this.setAttribute("aria-label", label?.textContent.trim() || fieldName || this.getAttribute("title") || this.id.replace(/^(ar|cf|cam)-/, "").replaceAll("-", " ") || "Choose an option");
    }
    this._observer.observe(this, { childList: true });
    this.sync();
  }
  disconnectedCallback() { this._observer.disconnect(); this.close(); }
  attributeChangedCallback() { this.tabIndex = this.disabled ? -1 : 0; this.setAttribute("aria-disabled", String(this.disabled)); if (this.disabled) this.close(); this.sync(); }
  get options() { return [...this.querySelectorAll(":scope > option, :scope > optgroup > option")]; }
  get value() { const options = this.options; return this._value ?? (options.find(o => o.selected) || options[0])?.value ?? ""; }
  set value(value) { this._value = String(value); for (const o of this.options) o.selected = o.value === this._value; this.sync(); }
  get disabled() { return this.hasAttribute("disabled") || this.getAttribute("aria-busy") === "true"; }
  set disabled(value) { this.toggleAttribute("disabled", Boolean(value)); }
  get open() { return this._list.matches(":popover-open"); }
  sync() {
    const options = this.options, current = this.value;
    this._label.textContent = this.getAttribute("aria-busy") === "true" ? "Loading options…" : options.find(o => o.value === current)?.textContent || "Choose an option";
    this.tabIndex = this.disabled ? -1 : 0;
    this.setAttribute("aria-disabled", String(this.disabled));
  }
  show() {
    if (this.disabled || !this.options.length || !this.isConnected) return;
    this._active = Math.max(0, this.options.findIndex(o => o.value === this.value));
    this.renderOptions();
    const r = this.getBoundingClientRect();
    this._list.style.setProperty("--choice-left", `${r.left}px`);
    this._list.style.setProperty("--choice-top", `${r.bottom}px`);
    this._list.style.setProperty("--choice-width", `${r.width}px`);
    this._list.showPopover();
    this.setAttribute("aria-expanded", "true");
    this.highlight();
  }
  close() { if (this.open) this._list.hidePopover(); this.setAttribute("aria-expanded", "false"); this.removeAttribute("aria-activedescendant"); }
  renderOptions() {
    this._list.replaceChildren();
    let group;
    this.options.forEach((o, i) => {
      const heading = o.parentElement.tagName === "OPTGROUP" ? o.parentElement.label : null;
      if (heading && group !== heading) { const h = document.createElement("div"); h.className = "tool-choice-group"; h.textContent = heading; this._list.append(h); }
      group = heading;
      const item = document.createElement("div");
      item.id = `${this._list.id}-${i}`; item.setAttribute("role", "option");
      item.setAttribute("aria-selected", String(o.value === this.value));
      item.setAttribute("aria-disabled", String(o.disabled)); item.textContent = o.textContent;
      item.addEventListener("pointerdown", e => e.preventDefault());
      item.addEventListener("click", e => { e.stopPropagation(); if (!o.disabled) this.pick(i); });
      this._list.append(item);
    });
  }
  highlight() {
    const item = this._list.querySelectorAll('[role="option"]')[this._active];
    this._list.querySelectorAll('[role="option"]').forEach((e, i) => e.toggleAttribute("data-active", i === this._active));
    if (item) { this.setAttribute("aria-activedescendant", item.id); item.scrollIntoView({ block: "nearest" }); }
  }
  pick(index) {
    const option = this.options[index]; if (!option || option.disabled) return;
    const changed = this.value !== option.value;
    this.value = option.value; this.close(); this.focus();
    if (changed) { this.dispatchEvent(new Event("input", { bubbles: true })); this.dispatchEvent(new Event("change", { bubbles: true }));
      if (!this.isConnected && this.id) document.getElementById(this.id)?.focus();
    }
  }
  key(e) {
    e.stopPropagation();
    const options = this.options;
    if (this.disabled || !options.length) return;
    if (e.key === "Tab") { this.close(); return; }
    if (e.key === "Escape") { if (this.open) { e.preventDefault(); this.close(); } return; }
    if (["Enter", " "].includes(e.key)) { e.preventDefault(); this.open ? this.pick(this._active) : this.show(); return; }
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
      e.preventDefault(); if (!this.open) this.show();
      const step = e.key === "ArrowUp" ? -1 : 1;
      let index = e.key === "Home" ? 0 : e.key === "End" ? options.length - 1 : Math.max(0, Math.min(options.length - 1, this._active + step));
      while (options[index]?.disabled && index >= 0 && index < options.length) index += step;
      if (options[index]) this._active = index;
      this.highlight(); return;
    }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault(); if (!this.open) this.show();
      const now = performance.now(); this._buffer = now - this._typedAt > Number.parseFloat(getComputedStyle(this).getPropertyValue("--ai-status-toolTypeahead")) ? e.key : this._buffer + e.key; this._typedAt = now;
      const found = options.findIndex(o => !o.disabled && o.textContent.trim().toLocaleLowerCase().startsWith(this._buffer.toLocaleLowerCase()));
      if (found >= 0) { this._active = found; this.highlight(); }
    }
  }
}
globalThis.customElements?.define("tool-choice", ToolChoice);
