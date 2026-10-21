import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";
import editorBrowserConfig from "../playwright.config.mjs";

// Keep MCP browser coverage under mcp/ while sharing the app's WebGL settings
// and test server.
export default defineConfig({
  ...editorBrowserConfig,
  testDir: fileURLToPath(new URL("./tests", import.meta.url)),
  testMatch: /.*\.browser\.mjs/,
  outputDir: fileURLToPath(new URL("../test-results/mcp", import.meta.url)),
  reporter: [["list"], ["html", { outputFolder: fileURLToPath(new URL("../playwright-report/mcp", import.meta.url)), open: "never" }]],
  webServer: { ...editorBrowserConfig.webServer, cwd: fileURLToPath(new URL("..", import.meta.url)) },
});
