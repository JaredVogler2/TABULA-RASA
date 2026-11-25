import { expect, test } from "@playwright/test";
import { selfTestDigest } from "../../src/engine/core/selftest";

/**
 * Cross-runtime determinism: the same seeded workload must produce the same digest in
 * Node (reference), on the browser main thread and inside a Web Worker.
 */
test("browser and worker reproduce the Node reference digest", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  const reference = selfTestDigest(20261125, 20000);

  await page.goto("/diagnostics");
  const worker = page.getByTestId("digest-worker");
  await expect(worker).toHaveAttribute("data-status", "ok");
  await expect(worker).toContainText(reference.digest);
  await expect(worker).toContainText(reference.sha.slice(0, 16));
  await expect(page.getByTestId("digest-main")).toContainText(reference.digest);
  await expect(page.getByTestId("webgl")).toHaveAttribute("data-status", "ok");
  await expect(page.getByTestId("storage")).toHaveAttribute("data-status", "ok");
  expect(consoleErrors).toEqual([]);
});

test("health endpoint reveals no configuration", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(Object.keys(body).sort()).toEqual(["affordances", "engine", "ok", "schema", "service"]);
  const headers = res.headers();
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["content-security-policy"]).toContain("default-src 'self'");
  expect(headers["x-powered-by"]).toBeUndefined();
});
