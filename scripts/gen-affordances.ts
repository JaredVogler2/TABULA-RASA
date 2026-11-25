/**
 * Regenerates docs/AFFORDANCES.md from the in-engine registry.
 * Usage: pnpm gen:affordances [--check]
 * With --check the script exits non-zero if the committed file is stale (used in CI).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { affordancesMarkdown } from "../src/engine/affordances";

const target = fileURLToPath(new URL("../docs/AFFORDANCES.md", import.meta.url));
const next = affordancesMarkdown();
const check = process.argv.includes("--check");

let current = "";
try {
  current = readFileSync(target, "utf8");
} catch {
  current = "";
}

if (check) {
  if (current !== next) {
    console.error("docs/AFFORDANCES.md is stale. Run `pnpm gen:affordances` and commit the result.");
    process.exit(1);
  }
  console.log("docs/AFFORDANCES.md is up to date.");
} else {
  writeFileSync(target, next);
  console.log(`Wrote ${target} (${next.length} bytes).`);
}
