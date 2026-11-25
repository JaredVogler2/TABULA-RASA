import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bundleFindings } from "../../scripts/scan-bundle";
import { findingsIn, isForbiddenEnvFile } from "../../scripts/scan-secrets";
import { MIGRATIONS } from "../../src/server/migrations.generated";

/**
 * The scans are only worth their green tick if they would go red. Each credential below is
 * assembled at run time from pieces, so that this file does not itself contain one.
 */
const fakeKey = ["sk", "ant", "api03"].join("-") + "-" + "A1b2C3d4".repeat(12);
const fakeHash = ["scrypt", "32768", "8", "1", "c2FsdHNhbHRzYWx0c2FsdHNhbHQ", "aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaA"].join(":");
const fakeUrl = "postgres" + "://admin:" + "hunter2hunter2" + "@prod-db.acme.io:5432/app";

describe("the secret scan would catch a real leak", () => {
  it("flags credential-shaped strings wherever they are, and says where without repeating them", () => {
    const cases: [string, string][] = [
      [`const key = "${fakeKey}";`, "Anthropic API key"],
      [`OWNER_PASSWORD_HASH=${fakeHash}`, "owner password hash"],
      [`url: "${fakeUrl}"`, "database URL with a password"],
      ["-----BEGIN " + "PRIVATE KEY-----", "private key block"],
      ["aws = AKIA" + "IOSFODNN7EXAMPLE", "AWS access key"],
      ["token = gh" + "p_" + "a".repeat(40), "GitHub token"],
      ["Authorization: Bearer " + "x".repeat(48), "bearer token"],
    ];
    for (const [line, name] of cases) {
      const found = findingsIn("src/some/file.ts", `ok line\n${line}\n`);
      expect(found, name).toHaveLength(1);
      expect(found[0]).toBe(`src/some/file.ts:2: looks like a ${name}`);
      expect(found[0]).not.toContain(line);
    }
  });

  it("flags env files, values in the template, and public variables named like secrets", () => {
    expect(isForbiddenEnvFile(".env")).toBe(true);
    expect(isForbiddenEnvFile(".env.local")).toBe(true);
    expect(isForbiddenEnvFile("apps/web/.env.production")).toBe(true);
    expect(isForbiddenEnvFile(".env.example")).toBe(false);
    expect(isForbiddenEnvFile("src/server/env.ts")).toBe(false);
    expect(findingsIn(".env.example", "LIVE_ENABLED=false\nANTHROPIC_API_KEY=\nAUTH_SECRET=abc123\n")).toEqual([".env.example:3: AUTH_SECRET has a value in the template"]);
    expect(findingsIn("src/ui/x.tsx", "const k = process.env." + "NEXT_PUBLIC_" + "ANTHROPIC_KEY;")).toHaveLength(1);
    expect(findingsIn("src/ui/x.tsx", "const k = process.env.NEXT_PUBLIC_SITE_NAME;")).toEqual([]);
  });

  it("lets through what is not a secret: fixtures, local test databases, the real template", () => {
    expect(findingsIn("tests/x.test.ts", 'const KEY = "sk-ant-api03-TEST-ONLY-not-a-real-key";')).toEqual([]);
    expect(findingsIn(".github/workflows/ci.yml", "TEST_DATABASE_URL: postgres://tabula:tabula@localhost:5432/tabula_test")).toEqual([]);
    expect(findingsIn(".env.example", readFileSync(".env.example", "utf8"))).toEqual([]);
    expect(findingsIn("src/x.ts", `const key = "${fakeKey}"; // scan:allow documented fixture`)).toEqual([]);
  });
});

describe("the bundle scan would catch server code or secrets sent to the browser", () => {
  it("flags server-only markers, credential shapes and live secret values", () => {
    expect(bundleFindings("chunk.js", "function a(){return 1}")).toEqual([]);
    expect(bundleFindings("chunk.js", 'q("UPDATE budget SET reserved_microusd = 1")').length).toBeGreaterThanOrEqual(2);
    expect(bundleFindings("chunk.js", 'fetch("https://api.anthropic.com/v1/messages")')).toHaveLength(1);
    expect(bundleFindings("chunk.js", "process.env." + "ANTHROPIC_API_KEY")).toHaveLength(1);
    expect(bundleFindings("chunk.js", `k="${fakeKey}"`)).toHaveLength(1);
    expect(bundleFindings("page.html", `<p>${fakeUrl}</p>`)).toHaveLength(1);
    expect(bundleFindings("chunk.js", 'var s="correct-horse-battery"', [["AUTH_SECRET", "correct-horse-battery"]])).toEqual(["chunk.js: contains the current value of AUTH_SECRET"]);
  });
});

describe("the embedded migrations are the files in db/migrations", () => {
  it("match byte for byte, in order", () => {
    expect(MIGRATIONS.map((m) => m.version)).toEqual(["0001_ledger.sql"]);
    for (const m of MIGRATIONS) expect(m.sql).toBe(readFileSync(`db/migrations/${m.version}`, "utf8"));
  });
});
