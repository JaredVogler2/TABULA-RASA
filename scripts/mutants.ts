/**
 * A seeded mutation run: are the tests able to tell when an invariant is broken?
 *
 *   pnpm mutants [-- --only <id>[,<id>…]] [--dir <a directory to work in>] [--json <file>]
 *
 * Each entry below breaks one invariant on purpose — the kill switch no longer stops a hold, a
 * settlement can be applied twice, a speaker may tell of what they have never seen — in a copy
 * of the source tree, and names the test files that must then fail. A mutant that survives is
 * a hole in the tests, and the run exits 1.
 *
 * What this is not: a mutation-testing tool. Nothing is generated; the mutants were chosen,
 * one for each invariant the project's claims rest on, and "killed" means only that some test
 * in the named files fails. It says nothing about invariants that are not listed.
 *
 * The working tree is never touched: the copy lives in a temporary directory (or `--dir`),
 * with `node_modules` linked, and is removed at the end. No database server is needed: the
 * tests named here use the in-memory one.
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

interface Mutant {
  id: string;
  /** The invariant, said as what must be true. */
  invariant: string;
  file: string;
  /** Exact text to find (each exactly once in the file) and what to put in its place. */
  edits: [find: string, replace: string][];
  /** Test files of which at least one test must fail. */
  tests: string[];
}

const MUTANTS: Mutant[] = [
  {
    id: "ledger-kill-switch",
    invariant: "with the kill switch on, nothing new is held",
    file: "src/server/ledger.ts",
    edits: [["WHERE id = 1 AND kill_switch = false AND reserved_microusd + settled_microusd + overage_microusd + $1::bigint", "WHERE id = 1 AND reserved_microusd + settled_microusd + overage_microusd + $1::bigint"]],
    tests: ["src/server/ledger.test.ts"],
  },
  {
    id: "ledger-total",
    invariant: "what is held, settled and overcharged never exceeds what was authorized",
    file: "src/server/ledger.ts",
    edits: [["<= LEAST(authorized_microusd, $2::bigint) RETURNING id\",", "<= LEAST(authorized_microusd, $2::bigint) * 2 RETURNING id\","]],
    tests: ["src/server/ledger.test.ts"],
  },
  {
    id: "ledger-ceiling",
    invariant: "nothing above the deployment's ceiling can be authorized",
    file: "src/server/ledger.ts",
    edits: [
      ["if (authorizedMicroUsd > this.ceiling) {", "if (authorizedMicroUsd > this.ceiling * 1000) {"],
      ["AND $1::bigint <= $3::bigint RETURNING id\"", "AND $3::bigint >= 0 RETURNING id\""],
    ],
    tests: ["src/server/ledger.test.ts", "src/server/api.test.ts"],
  },
  {
    id: "ledger-settle-once",
    invariant: "a settlement is applied once, however many times it arrives",
    file: "src/server/ledger.ts",
    edits: [["WHERE id = $1 AND state IN ('reserved', 'unknown')\n       RETURNING run_id", "WHERE id = $1 AND state IN ('reserved', 'unknown', 'settled')\n       RETURNING run_id"]],
    tests: ["src/server/ledger.test.ts"],
  },
  {
    id: "gate-csrf",
    invariant: "a write without the session's own token changes nothing",
    file: "src/server/http.ts",
    edits: [['if (write && !csrfMatches(owner.secret, owner.session, request.headers.get("x-csrf-token"))) return { ok: false, response: refuse(403, "bad_csrf_token") };', ""]],
    tests: ["src/server/auth.test.ts", "src/server/api.test.ts"],
  },
  {
    id: "gate-origin",
    invariant: "a write from another site is refused",
    file: "src/server/http.ts",
    edits: [["return new URL(origin).host.toLowerCase() === requestHost(request);", "return new URL(origin).host.length > 0;"]],
    tests: ["src/server/auth.test.ts", "src/server/api.test.ts"],
  },
  {
    id: "session-epoch",
    invariant: "signing out ends every session",
    file: "src/server/api.ts",
    edits: [['if (guard.session.epoch !== epoch) return refuse(401, "not_signed_in");', ""]],
    tests: ["src/server/api.test.ts"],
  },
  {
    id: "sign-in-limit",
    invariant: "guessing the passphrase is slowed",
    file: "src/server/http.ts",
    edits: [["return { ok: count <= limit, retryAfterSec };", "return { ok: true, retryAfterSec };"]],
    tests: ["src/server/auth.test.ts", "src/server/api.test.ts"],
  },
  {
    id: "provider-error-proves-nothing",
    invariant: "a failure that is not in the provider's own format is never taken as unbilled",
    file: "src/server/anthropic.ts",
    edits: [['if (!fromProvider) return make("unknown", "unrecognized_response", false);', ""]],
    tests: ["src/server/anthropic.test.ts"],
  },
  {
    id: "run-lease",
    invariant: "one stepper at a time holds a run",
    file: "src/server/runs.ts",
    edits: [["AND (lease_until IS NULL OR lease_until < now() OR lease_owner = $2", "AND (true OR lease_owner = $2"]],
    tests: ["src/server/runs.test.ts"],
  },
  {
    id: "goods-conserved",
    invariant: "nothing is made from nothing: what is gathered leaves the place it was gathered from, unit for unit",
    file: "src/engine/sim/actions.ts",
    edits: [["a.inv[spec.yields] = (a.inv[spec.yields] as number) + y;", "a.inv[spec.yields] = (a.inv[spec.yields] as number) + y + 1;"]],
    tests: ["src/engine/sim/sim.test.ts", "src/engine/world/world.test.ts"],
  },
  {
    id: "speech-untold",
    invariant: "a speaker can tell only of what they know",
    file: "src/engine/sim/actions.ts",
    edits: [["const gap = untold(world, a, intent.act);", "const gap = null as string | null;"]],
    tests: ["src/engine/institutions/institutions.test.ts", "src/engine/mind/cognition.test.ts"],
  },
  {
    id: "hearing-belief",
    invariant: "a hearer learns of an agreement only from someone who knows of it",
    file: "src/engine/mind/decide.ts",
    edits: [["if (speaker && knowsCharter(world, speaker, id) && world.inst.proposals.some((p) => p.id === id)) learnCharter(a, id);", "if (speaker && world.inst.proposals.some((p) => p.id === id)) learnCharter(a, id);"]],
    tests: ["src/engine/institutions/institutions.test.ts", "src/engine/mind/cognition.test.ts"],
  },
  {
    id: "role-label",
    invariant: "the name of a role cannot be a sentence",
    file: "src/engine/core/text.ts",
    edits: [["const kept = (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 45 || c === 95;", "const kept = (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 45 || c === 95 || c === 32 || c === 46 || c === 40 || c === 41;"]],
    tests: ["src/engine/core/text.test.ts", "src/engine/institutions/institutions.test.ts"],
  },
  {
    id: "authority-members",
    invariant: "only a member can put a motion to an agreement",
    file: "src/engine/institutions/engine.ts",
    edits: [['if (!memberOf(inst, agent.id)) return "not_a_member";', ""]],
    tests: ["src/engine/institutions/institutions.test.ts"],
  },
  {
    id: "payload-depth",
    invariant: "what a mind attaches to an intent is bounded in depth",
    file: "src/engine/core/bounded.ts",
    edits: [["if (depth >= bounds.depth) throw new OutOfBounds();", ""]],
    tests: ["src/engine/core/bounded.test.ts"],
  },
  {
    id: "file-ranges",
    invariant: "an opened world whose numbers are out of range is refused",
    file: "src/engine/save/validate.ts",
    edits: [["if (typeof v !== \"number\" || !Number.isInteger(v) || v < lo || v > hi) bad(path,", "if (typeof v !== \"number\" || !Number.isInteger(v)) bad(path,"]],
    tests: ["src/engine/save/validate.test.ts"],
  },
  {
    id: "replay-digest",
    invariant: "a recording that this engine does not reproduce is not accepted as reproduced",
    file: "src/providers/run.ts",
    edits: [["if (worldDigest(world) !== target.digest) return e;", ""]],
    tests: ["tests/unit/recording.test.ts", "src/providers/run.test.ts"],
  },
  {
    id: "route-memo",
    invariant: "a failed route search is remembered only while what the agent has seen is unchanged",
    file: "src/engine/sim/pathfind.ts",
    edits: [["return then !== undefined && sameBytes(then, agent.mind.seen);", "return then !== undefined;"]],
    tests: ["src/engine/sim/pathfind.test.ts"],
  },
  {
    id: "determinism",
    invariant: "the same seed and the same decisions make the same world (the golden recording)",
    file: "src/engine/core/rng.ts",
    edits: [["let h = round(0x2f6b1a3d, seed);", "let h = round(0x2f6b1a3e, seed);"]],
    tests: ["tests/unit/recording.test.ts"],
  },
];

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] !== undefined ? (process.argv[i + 1] as string) : fallback;
}

function vitest(cwd: string, files: string[]): { failed: boolean; failedTests: number; seconds: number; tail: string } {
  const started = Date.now();
  const r = spawnSync("pnpm", ["exec", "vitest", "run", ...files], { cwd, encoding: "utf8", env: { ...process.env, TEST_DATABASE_URL: "", CI: "1" }, maxBuffer: 256 * 1024 * 1024 });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}${r.error ? `\n${String(r.error)}` : ""}`;
  const m = /Tests\s+(\d+) failed/.exec(out);
  return { failed: r.status !== 0, failedTests: m ? Number(m[1]) : 0, seconds: Math.round((Date.now() - started) / 100) / 10, tail: out.split("\n").slice(-40).join("\n") };
}

function main(): number {
  const only = arg("only", "").split(",").filter(Boolean);
  const chosen = MUTANTS.filter((m) => only.length === 0 || only.includes(m.id));
  const root = process.cwd();
  const given = arg("dir", "");
  if (given) mkdirSync(given, { recursive: true });
  const work = mkdtempSync(join(given ? resolve(given) : tmpdir(), "tr-mutants-"));
  try {
    for (const dir of ["src", "tests", "db", "public/recordings"]) cpSync(join(root, dir), join(work, dir), { recursive: true });
    for (const file of ["package.json", "tsconfig.json", "vitest.config.ts", ".env.example", "next-env.d.ts"]) if (existsSync(join(root, file))) cpSync(join(root, file), join(work, file));
    mkdirSync(join(work, "scripts"), { recursive: true });
    for (const file of ["scan-secrets.ts", "scan-bundle.ts"]) cpSync(join(root, "scripts", file), join(work, "scripts", file));
    symlinkSync(join(root, "node_modules"), join(work, "node_modules"), "dir");

    // the copy must be sound before anything in it is broken
    const allTests = [...new Set(chosen.flatMap((m) => m.tests))];
    const base = vitest(work, allTests);
    if (base.failed) {
      console.error(`The unmutated copy does not pass its tests (${allTests.join(", ")}): nothing can be concluded.\n${base.tail}`);
      return 2;
    }
    console.log(`unmutated: ${allTests.length} test files pass in the copy (${base.seconds} s)\n`);

    const rows: { id: string; invariant: string; killed: boolean; failedTests: number; seconds: number }[] = [];
    for (const m of chosen) {
      const path = join(work, m.file);
      const original = readFileSync(path, "utf8");
      let mutated = original;
      for (const [find, replace] of m.edits) {
        const count = mutated.split(find).length - 1;
        if (count !== 1) {
          console.error(`${m.id}: the text to change occurs ${count} times in ${m.file}, not once. The mutant is out of date: ${JSON.stringify(find.slice(0, 80))}`);
          return 2;
        }
        mutated = mutated.replace(find, () => replace);
      }
      writeFileSync(path, mutated);
      const r = vitest(work, m.tests);
      writeFileSync(path, original);
      rows.push({ id: m.id, invariant: m.invariant, killed: r.failed, failedTests: r.failedTests, seconds: r.seconds });
      console.log(`${r.failed ? "killed  " : "SURVIVED"}  ${m.id.padEnd(30)} ${m.invariant}${r.failed ? `  (${r.failedTests || "some"} test${r.failedTests === 1 ? "" : "s"} failed, ${r.seconds} s)` : ""}`);
    }
    const survived = rows.filter((r) => !r.killed);
    console.log(`\n${rows.length - survived.length} of ${rows.length} seeded mutants killed${survived.length ? `; SURVIVED: ${survived.map((r) => r.id).join(", ")}` : ""}.`);
    const json = arg("json", "");
    if (json) writeFileSync(json, JSON.stringify({ date: new Date().toISOString(), node: process.version, mutants: rows }, null, 1) + "\n");
    return survived.length ? 1 : 0;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

process.exit(main());
