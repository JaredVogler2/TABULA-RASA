import { defineConfig, devices } from "@playwright/test";
import { randomBytes, scryptSync } from "node:crypto";
import { E2E_PASSPHRASE } from "./tests/e2e/constants";

const PORT = Number(process.env.E2E_PORT ?? 3210);
const baseURL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`;

/**
 * The owner console is tested against a server that has an owner. The passphrase is a fixed,
 * public test value; its hash is computed here at start-up (same format as `pnpm owner:hash`),
 * so no hash is committed. The ledger lives in a schema of its own on the test database, and
 * live mode stays off: these tests can never reach a provider.
 */
const salt = randomBytes(16);
const ownerHash = `scrypt:32768:8:1:${salt.toString("base64url")}:${scryptSync(E2E_PASSPHRASE.normalize("NFKC"), salt, 32, { N: 32768, r: 8, p: 1, maxmem: 256 * 32768 * 8 }).toString("base64url")}`;
const serverEnv: Record<string, string> = {
  LIVE_ENABLED: "false",
  OWNER_PASSWORD_HASH: ownerHash,
  AUTH_SECRET: randomBytes(48).toString("base64url"),
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? "",
  DATABASE_SCHEMA: "e2e",
  ANTHROPIC_API_KEY: "",
  ANTHROPIC_MODEL: "",
  // the most this test deployment could ever be authorized for: the console test authorizes two
  // dollars under it and is refused six. (Nothing can be spent: live mode is off and there is no key.)
  BUDGET_CEILING_USD: "5",
};

/**
 * E2E runs against the production build (`next build && next start`) unless
 * E2E_BASE_URL points at an already running deployment.
 *
 * Headless Chromium here renders WebGL2 through SwiftShader (software). Frame
 * rates measured in this environment are NOT device measurements; see docs/EVIDENCE.md.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.spec.ts",
  globalSetup: "./tests/e2e/global-setup.ts",
  outputDir: "./test-results",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 30_000 },
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "off",
    video: "off",
    screenshot: "off",
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 768 } },
    },
    {
      name: "mobile",
      use: {
        // iPhone-class portrait viewport emulated in Chromium (not real iOS Safari).
        browserName: "chromium",
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
      },
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `pnpm exec next start -p ${PORT}`,
        url: `${baseURL}/api/health`,
        env: serverEnv,
        reuseExistingServer: false,
        timeout: 120_000,
        stdout: "pipe",
        stderr: "pipe",
      },
});
