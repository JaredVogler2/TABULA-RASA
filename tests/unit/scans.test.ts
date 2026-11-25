import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bundleFindings } from "../../scripts/scan-bundle";
import { MAX_SCANNED_BYTES, findingsIn, hasDatabasePassword, isForbiddenEnvFile, unreadable } from "../../scripts/scan-secrets";
import { MIGRATIONS } from "../../src/server/migrations.generated";

/**
 * The scans are only worth their green tick if they would go red. Each credential below is
 * assembled at run time from pieces, so that this file does not itself contain one.
 */
const fakeKey = ["sk", "ant", "api03"].join("-") + "-" + "A1b2C3d4".repeat(12);
const fakeOauth = ["sk", "ant", "oat01"].join("-") + "-" + "Zz9_yY8-".repeat(8);
const fakeAdmin = ["sk", "ant", "admin01"].join("-") + "-" + "q7W_e5R-".repeat(8);
const db = (rest: string): string => "postgres" + "://" + rest;
const fakeHash = ["scrypt", "32768", "8", "1", "c2FsdHNhbHRzYWx0c2FsdHNhbHQ", "aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaA"].join(":");
const fakeUrl = "postgres" + "://admin:" + "hunter2hunter2" + "@prod-db.acme.io:5432/app";

describe("the secret scan would catch a real leak", () => {
  it("flags credential-shaped strings wherever they are, and says where without repeating them", () => {
    const cases: [string, string][] = [
      [`const key = "${fakeKey}";`, "Anthropic key or token"],
      [`token: ${fakeOauth}`, "Anthropic key or token"],
      [`ANTHROPIC_ADMIN_KEY=${fakeAdmin}`, "Anthropic key or token"],
      ["-----BEGIN ENCRYPTED " + "PRIVATE KEY-----", "private key block"],
      ["pat = github" + "_pat_" + "B".repeat(60), "GitHub token"],
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
    expect(findingsIn("docs/x.md", "DATABASE_URL=" + db("user:password@localhost/app"))).toEqual([]);
    expect(findingsIn("docs/x.md", `url = "${db("user:password@db.example:5432/app?sslmode=require")}"`)).toEqual([]);
    expect(findingsIn("docs/x.md", db("tabula@db.acme.io/app") + " has no password in it")).toEqual([]);
  });

  it("no marker excuses a line", () => {
    // the scanner once skipped any line carrying the words below; a real key with a comment after it went through
    for (const marker of ["scan:allow documented fixture", "nosec", "gitleaks:allow", "pragma: allowlist secret"]) {
      expect(findingsIn("src/x.ts", `const key = "${fakeKey}"; // ${marker}`), marker).toHaveLength(1);
    }
  });

  it("a database host is nobody's only if the name is the whole host, whichever host the address means", () => {
    const real = [
      "admin:hunter2hunter2@db.internal.corp/app",
      "admin:hunter2hunter2@localhost.evil.org:5432/app",
      "admin:hunter2hunter2@x.io/app",
      "admin:hunter2hunter2@LOCALHOST.example/app",
      // most programs take the last "@" before the path as the end of the credentials
      "admin:hunter2hunter2@localhost:5432@prod-db.acme.io/app",
      "admin:hunter2hunter2@prod-db.acme.io@localhost/app",
      "admin:hunter2@localhost,@prod-db.acme.io/app",
      "admin:hunter2hunter2@prod-db.acme.io",
      "admin:hunt/er2hunter2@prod-db.acme.io/app",
      "user:pw@prod-db.acme.io/app",
    ];
    for (const rest of real) {
      expect(hasDatabasePassword(`url: "${db(rest)}"`), rest).toBe(true);
      expect(findingsIn("src/x.ts", `url: "${db(rest)}"`), rest).toEqual(["src/x.ts:1: looks like a database URL with a password"]);
    }
    for (const scheme of ["postgresql", "mysql", "mongodb+srv", "redis", "rediss", "amqps"]) {
      expect(hasDatabasePassword(`${scheme}://admin:hunter2hunter2@prod.acme.io/0`), scheme).toBe(true);
    }
    const nobody = ["tabula:tabula@localhost:5432/tabula_test", "user:SENTINEL-PW@db.internal/prod", "tabula:tabula@127.0.0.1/t", "tabula:tabula@[::1]:5432/t", "tabula:tabula@LOCALHOST/t", "user:@prod-db.acme.io/app", "user@prod-db.acme.io/app", "prod-db.acme.io/app"];
    for (const rest of nobody) expect(hasDatabasePassword(db(rest)), rest).toBe(false);
  });

  it("what cannot be read into is a finding, not a skip", () => {
    expect(unreadable("evidence/runs.zip", 10)).toMatch(/archive/);
    expect(unreadable("data/ledger.sqlite", 10)).toMatch(/archive or database/);
    expect(unreadable("public/recordings/big.json", MAX_SCANNED_BYTES + 1)).toMatch(/too large/);
    expect(unreadable("public/recordings/big.json", MAX_SCANNED_BYTES)).toBeNull();
    expect(unreadable("src/x.ts", 10)).toBeNull();
  });
});

describe("the bundle scan would catch server code or secrets sent to the browser", () => {
  it("flags server-only markers, credential shapes and live secret values", () => {
    expect(bundleFindings("chunk.js", "function a(){return 1}")).toEqual([]);
    expect(bundleFindings("chunk.js", 'q("UPDATE budget SET reserved_microusd = 1")').length).toBeGreaterThanOrEqual(2);
    expect(bundleFindings("chunk.js", 'fetch("https://api.anthropic.com/v1/messages")')).toHaveLength(1);
    expect(bundleFindings("chunk.js", "process.env." + "ANTHROPIC_API_KEY")).toHaveLength(1);
    expect(bundleFindings("chunk.js", `k="${fakeKey}"`)).toHaveLength(1);
    expect(bundleFindings("chunk.js.map", `{"sourcesContent":["t='${fakeOauth}'"]}`)).toHaveLength(1);
    expect(bundleFindings("page.html", `<p>${fakeUrl}</p>`)).toHaveLength(1);
    expect(bundleFindings("chunk.js", 'var s="correct-horse-battery"', [["AUTH_SECRET", "correct-horse-battery"]])).toEqual(["chunk.js: contains the current value of AUTH_SECRET"]);
  });
});

describe("the embedded migrations are the files in db/migrations", () => {
  it("match byte for byte, in order", () => {
    // the directory is the authority: a migration added there and not embedded (or the reverse) fails here
    const files = readdirSync("db/migrations").filter((f) => f.endsWith(".sql")).sort();
    expect(files.length).toBeGreaterThanOrEqual(2);
    expect(files[0]).toBe("0001_ledger.sql");
    expect(MIGRATIONS.map((m) => m.version)).toEqual(files);
    for (const m of MIGRATIONS) expect(m.sql).toBe(readFileSync(`db/migrations/${m.version}`, "utf8"));
  });
});
