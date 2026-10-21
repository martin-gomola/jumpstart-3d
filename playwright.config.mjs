// Browser project for the generated app bundle served from build/site/.
import { defineConfig } from "@playwright/test";

const base = +(process.env.JS3D_PORT || 8765); // set JS3D_PORT when two checkouts run the tests at once
const chromiumArgs = ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"]; // WebGL without a GPU, as the author's scripts ran

export default defineConfig({
  testDir: "mcp/tests",
  testMatch: /.*\.spec\.mjs/,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  workers: 1, // every page loads and compiles the 7 MB kernel; one at a time is faster overall
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: { viewport: { width: 1400, height: 880 }, launchOptions: { args: chromiumArgs }, trace: "retain-on-failure" },
  projects: [{ name: "site", use: { baseURL: `http://127.0.0.1:${base}/` } }],
  webServer: { command: `node test/serve.mjs build/site ${base}`, url: `http://127.0.0.1:${base}/`, reuseExistingServer: true },
});
