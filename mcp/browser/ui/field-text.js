// Mirrors HTML number-input validity so the view can enable actions without reading the DOM.
export function numberValid(text, { min = -Infinity, max = Infinity, step = "any" } = {}) {
  if (String(text).trim() === "") return false;
  const value = Number(text);
  if (!Number.isFinite(value) || value < min || value > max) return false;
  if (step === "any") return true;
  const steps = (value - (Number.isFinite(min) ? min : 0)) / step;
  return Math.abs(steps - Math.round(steps)) < 1e-7;
}
