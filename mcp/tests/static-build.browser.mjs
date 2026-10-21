import { test, expect } from "@playwright/test";
import { boot, watchErrors } from "../../test/helpers.mjs";

test("static app files stay quiet without a local MCP broker", async ({ page }, info) => {
  const requests = [], errors = watchErrors(page);
  page.on("request", (request) => { if (request.url().includes("/__mcp/")) requests.push(request.url()); });
  await boot(page, info);
  await expect(page.locator("#ai-status")).toBeHidden();
  expect(requests).toEqual([]);
  expect(errors).toEqual([]);
});
