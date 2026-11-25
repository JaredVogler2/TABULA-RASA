/**
 * How long the server's own routes take, on this machine: the ones a visitor's browser calls,
 * and a whole mock run driven through the owner API (no provider is involved; nothing is
 * spent).
 *
 *   pnpm build
 *   TEST_DATABASE_URL=postgres://… pnpm requests [-- --port 3213 --json evidence/phase-15/requests.json]
 *
 * It starts the production server itself, with a throwaway owner (a random passphrase whose
 * hash is computed here at the cost `pnpm owner:hash` uses), live mode off, and a ledger in a
 * schema of its own, which it drops at the end. Times are measured in this process, over the
 * loopback interface: they are the server's work on this machine, not a visitor's experience
 * of a deployment.
 */
import { spawn } from "node:child_process";
import { randomBytes, scryptSync } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import pg from "pg";
import { DEFAULT_SPEC } from "../src/providers/run";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] !== undefined ? (process.argv[i + 1] as string) : fallback;
}

const url = process.env.TEST_DATABASE_URL ?? "";
if (!url) {
  console.error("TEST_DATABASE_URL is not set: the owner routes keep their ledger in PostgreSQL.");
  process.exit(1);
}
if (!existsSync(".next/BUILD_ID")) {
  console.error("There is no production build. Run `pnpm build` first.");
  process.exit(1);
}

const port = Number(arg("port", "3213"));
const base = `http://127.0.0.1:${port}`;
const schema = `perf_${process.pid}`;
const passphrase = randomBytes(18).toString("base64url");
const N = 131_072;
const salt = randomBytes(16);
const hash = `scrypt:${N}:8:1:${salt.toString("base64url")}:${scryptSync(passphrase.normalize("NFKC"), salt, 32, { N, r: 8, p: 1, maxmem: 256 * N * 8 }).toString("base64url")}`;

const quantile = (sorted: number[], q: number): number => (sorted.length ? (sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] as number) : 0);
const round = (ms: number): number => Math.round(ms * 100) / 100;

interface Row {
  what: string;
  n: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  bytes: number;
  status: string;
}

async function timed(path: string, init?: RequestInit): Promise<{ ms: number; status: number; bytes: number; response: Response; text: string }> {
  const started = performance.now();
  const response = await fetch(base + path, init);
  const text = await response.text();
  return { ms: performance.now() - started, status: response.status, bytes: Buffer.byteLength(text), response, text };
}

async function series(what: string, n: number, path: string, init?: RequestInit): Promise<Row> {
  const times: number[] = [];
  const statuses = new Map<number, number>();
  let bytes = 0;
  for (let i = 0; i < n; i++) {
    const r = await timed(path, init);
    times.push(r.ms);
    bytes = r.bytes;
    statuses.set(r.status, (statuses.get(r.status) ?? 0) + 1);
  }
  times.sort((a, b) => a - b);
  return { what, n, p50: round(quantile(times, 0.5)), p95: round(quantile(times, 0.95)), p99: round(quantile(times, 0.99)), max: round(times[times.length - 1] as number), bytes, status: [...statuses].map(([s, c]) => `${s}×${c}`).join(" ") };
}

async function main(): Promise<number> {
  const server = spawn("pnpm", ["exec", "next", "start", "-p", String(port)], {
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1", LIVE_ENABLED: "false", OWNER_PASSWORD_HASH: hash, AUTH_SECRET: randomBytes(48).toString("base64url"), DATABASE_URL: url, DATABASE_SCHEMA: schema, ANTHROPIC_API_KEY: "", ANTHROPIC_MODEL: "", BUDGET_CEILING_USD: "0" },
    stdio: ["ignore", "ignore", "inherit"],
    detached: true,
  });
  const stop = (): void => {
    try {
      if (server.pid) process.kill(-server.pid, "SIGTERM");
    } catch {
      // already gone
    }
  };
  const rows: Row[] = [];
  const once: Record<string, number> = {};
  try {
    // wait for the server, and time the first answer it ever gives
    const boot = performance.now();
    let first = -1;
    for (let i = 0; i < 300 && first < 0; i++) {
      try {
        const r = await timed("/api/health");
        if (r.status === 200) first = r.ms;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    if (first < 0) throw new Error("the server did not start");
    once["server ready after start (ms)"] = round(performance.now() - boot);
    once["first request answered in (ms)"] = round(first);

    rows.push(await series("GET /api/health", 200, "/api/health"));
    rows.push(await series("GET / (the game's page)", 100, "/"));
    rows.push(await series("GET /lab (the laboratory's page)", 50, "/lab"));
    rows.push(await series("GET /api/owner/status, signed out (no database)", 200, "/api/owner/status"));
    const firstDb = await timed("/api/recordings");
    once["first request that needs the database: schema made and migrated (ms)"] = round(firstDb.ms);
    rows.push(await series("GET /api/recordings (reads the database)", 150, "/api/recordings"));

    // the owner: sign in (the passphrase is hashed at full cost), then a mock run from start to finish
    const origin = base;
    const signIn = await timed("/api/owner/login", { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify({ passphrase }) });
    if (signIn.status !== 200) throw new Error(`sign-in was refused (${signIn.status})`);
    once["POST /api/owner/login (scrypt N = 2^17) (ms)"] = round(signIn.ms);
    const cookie = signIn.response.headers
      .getSetCookie()
      .map((c) => c.split(";")[0] as string)
      .join("; ");
    const csrf = (JSON.parse(signIn.text) as { csrf: string }).csrf;
    const owner = (body?: unknown): RequestInit => ({ method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json", origin, cookie, "x-csrf-token": csrf }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    rows.push(await series("GET /api/owner/status, signed in (budget, runs, audit)", 60, "/api/owner/status", owner()));

    const world = { scenario: "first_light", seed: 77, overrides: { population: 50, externalShare: 1000, institutions: "open" } };
    const spec = { ...DEFAULT_SPEC, provider: "mock", epochs: 4, scheduler: { ...DEFAULT_SPEC.scheduler, kind: "round_robin", callsPerEpoch: 8, maxPerAgentPerDay: 8 } };
    const preview = await timed("/api/runs/preview", owner({ world, spec }));
    if (preview.status !== 200) throw new Error(`the preview was refused (${preview.status}): ${preview.text.slice(0, 200)}`);
    once["POST /api/runs/preview (50 people) (ms)"] = round(preview.ms);
    const made = await timed("/api/runs", owner({ title: "Request timing (mock)", world, spec }));
    if (made.status !== 200) throw new Error(`the run was refused (${made.status}): ${made.text.slice(0, 200)}`);
    once["POST /api/runs (world made, stored) (ms)"] = round(made.ms);
    const id = (JSON.parse(made.text) as { run: { id: string } }).run.id;
    const steps: number[] = [];
    for (let i = 0; i < 12; i++) {
      const s = await timed(`/api/runs/${id}/step`, owner({}));
      if (s.status !== 200) throw new Error(`a step was refused (${s.status}): ${s.text.slice(0, 200)}`);
      steps.push(s.ms);
      if ((JSON.parse(s.text) as { state: string }).state === "done") break;
    }
    steps.sort((a, b) => a - b);
    rows.push({ what: "POST /api/runs/:id/step (one six-hour epoch, 50 people, 8 mock decisions)", n: steps.length, p50: round(quantile(steps, 0.5)), p95: round(quantile(steps, 0.95)), p99: round(quantile(steps, 0.99)), max: round(steps[steps.length - 1] as number), bytes: 0, status: `200×${steps.length}` });
    const published = await timed(`/api/runs/${id}/control`, owner({ action: "publish" }));
    if (published.status !== 200) throw new Error(`publishing was refused (${published.status})`);
    rows.push(await series("GET /api/runs/:id, a visitor reading the published run (tape and digests)", 60, `/api/runs/${id}`));

    // twenty visitors at once
    const burst: number[] = [];
    const wallStart = performance.now();
    await Promise.all(
      Array.from({ length: 20 }, async () => {
        for (let i = 0; i < 5; i++) burst.push((await timed("/api/health")).ms);
      }),
    );
    once["100 requests for /api/health, 20 at a time: wall time (ms)"] = round(performance.now() - wallStart);
    burst.sort((a, b) => a - b);
    rows.push({ what: "GET /api/health, 20 at a time", n: burst.length, p50: round(quantile(burst, 0.5)), p95: round(quantile(burst, 0.95)), p99: round(quantile(burst, 0.99)), max: round(burst[burst.length - 1] as number), bytes: 0, status: "200×100" });
  } finally {
    stop();
    const admin = new pg.Client({ connectionString: url });
    await admin.connect();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  }

  const machine = `${cpus()[0]?.model ?? "unknown CPU"} × ${cpus().length}, Node ${process.version}, loopback, production build`;
  console.log(`request timing — ${machine}`);
  console.log("milliseconds, measured by the caller; one request at a time unless it says otherwise\n");
  console.log(`${"what".padEnd(84)} ${"n".padStart(4)} ${"p50".padStart(8)} ${"p95".padStart(8)} ${"p99".padStart(8)} ${"max".padStart(8)} ${"bytes".padStart(8)}  status`);
  for (const r of rows) console.log(`${r.what.padEnd(84)} ${String(r.n).padStart(4)} ${r.p50.toFixed(2).padStart(8)} ${r.p95.toFixed(2).padStart(8)} ${r.p99.toFixed(2).padStart(8)} ${r.max.toFixed(2).padStart(8)} ${String(r.bytes || "").padStart(8)}  ${r.status}`);
  console.log("");
  for (const [k, v] of Object.entries(once)) console.log(`${k.padEnd(84)} ${v.toFixed(2).padStart(10)}`);
  const json = arg("json", "");
  if (json) writeFileSync(json, JSON.stringify({ machine, measuredAt: new Date().toISOString(), rows, once }, null, 2) + "\n");
  return rows.every((r) => /^200×\d+$/.test(r.status)) ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    console.error(`request timing failed: ${err instanceof Error ? err.message : "error"}`);
    process.exit(1);
  });
