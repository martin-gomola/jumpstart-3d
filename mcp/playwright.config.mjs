import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";
import editorBrowserConfig from "../playwright.config.mjs";

// Keep MCP browser coverage under mcp/ while sharing the site/single-file
// projects, WebGL settings, and static test server.
export default defineConfig({
  ...editorBrowserConfig,
  testDir: fileURLToPath(new URL("./tests", import.meta.url)),
  testMatch: /.*\.browser\.mjs/,
  projects: editorBrowserConfig.projects.map((project) => project.name === "single" ? { ...project, testIgnore: /native-inspection\.browser\.mjs/ } : project),
  outputDir: fileURLToPath(new URL("../test-results/mcp", import.meta.url)),
  reporter: [["list"], ["html", { outputFolder: fileURLToPath(new URL("../playwright-report/mcp", import.meta.url)), open: "never" }]],
  webServer: { ...editorBrowserConfig.webServer, cwd: fileURLToPath(new URL("..", import.meta.url)) },
});
