import "./build-tool-ui-harness.mjs";
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
const browser = await chromium.launch({ channel: "chrome" });
const linear = v => (v /= 255) <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
const luminance = rgb => rgb.map(linear).reduce((n, v, i) => n + v * [.2126, .7152, .0722][i], 0);
const ratio = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
try {
  const page = await browser.newPage();
  await page.goto(pathToFileURL(resolve("exports/editor-v274/harness/choices.html")).href);
  await page.waitForFunction(() => document.body.dataset.uiReady === "true");
  const c = page.getByRole("combobox", { name: "Material", exact: true });
  for (const theme of ["light", "dark", "contrast"]) {
    await page.evaluate(theme => document.documentElement.dataset.ui = theme, theme);
    for (const state of ["default", "hover", "focus", "active", "selected", "error", "loading", "disabled"]) {
      await c.evaluate(e => { e.removeAttribute("disabled"); e.removeAttribute("aria-busy"); e.removeAttribute("aria-invalid"); e.close(); e.blur(); });
      await page.mouse.move(0, 0);
      if (state === "hover") await c.hover();
      if (state === "focus") await c.focus();
      if (state === "active") { await c.hover(); await page.mouse.down(); }
      if (state === "selected") { await c.focus(); await page.keyboard.press("Enter"); await page.keyboard.press("End"); await page.keyboard.press("Enter"); }
      if (state === "error") await c.evaluate(e => e.setAttribute("aria-invalid", "true"));
      if (state === "loading") await c.evaluate(e => e.setAttribute("aria-busy", "true"));
      if (state === "disabled") await c.evaluate(e => e.disabled = true);
      const s = await c.evaluate(e => {
        const c = getComputedStyle(e), rgb = x => x.match(/[\d.]+/g).slice(0, 3).map(Number);
        return { foreground: rgb(c.color), background: rgb(c.backgroundColor), outline: parseFloat(c.outlineWidth), tabIndex: e.tabIndex, disabled: e.disabled, label: e.querySelector('.tool-choice-label').textContent };
      });
      if (["loading", "disabled"].includes(state)) { assert(s.disabled && s.tabIndex === -1); if (state === "loading") assert.equal(s.label, "Loading options…"); }
      else { const measured = ratio(s.foreground, s.background); assert(measured >= 4.5, `${theme}/${state}: text contrast ${measured}`); console.log(`${theme}/${state}: text contrast ${measured.toFixed(2)}:1`); }
      if (state === "focus") assert(s.outline > 0, "Missing focus outline");
      if (state === "active") await page.mouse.up();
    }
  }
  console.log("Tool choices: three themes, eight states each verified with a browser; active popup/commit behavior is covered by editor-v274.browser.mjs.");
} finally { await browser.close(); }
