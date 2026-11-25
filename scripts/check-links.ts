/**
 * Do the documents point at things that exist?
 *
 *   pnpm check:links
 *
 * Reads every Markdown file that is tracked (the documents, the README, the changelog, the
 * evidence notes) and checks two kinds of reference:
 *
 *   - Markdown links to a file in this repository (`[text](docs/COST.md)`, `./x.md#part`)
 *   - paths written in backticks that start at the repository's root (`evidence/phase-16/pooler.txt`,
 *     `src/server/db.ts`), including the shorthand the documents use for several files at once:
 *     braces (`load.{txt,json}`) and stars (`evidence/phase-16/review-*.md`)
 *
 * A reference to something that is not there fails the check, and with it `pnpm check`: a
 * document that cites a file as its evidence should not be able to outlive the file. Links to
 * other sites are not followed. Not checked: the prompts, which are the owner's, and the two
 * reviewers' reports under evidence/, which are kept exactly as they were returned (one of them
 * cites files precisely because they were missing).
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, normalize } from "node:path";

const ROOTS = ["docs", "evidence", "src", "scripts", "tests", "public", "db", "prompts", ".github"];

function expandBraces(path: string): string[] {
  const m = /\{([^{}]*)\}/.exec(path);
  if (!m) return [path];
  return (m[1] as string).split(",").flatMap((part) => expandBraces(path.slice(0, m.index) + part + path.slice(m.index + m[0].length)));
}

function matchesGlob(path: string): boolean {
  if (!path.includes("*")) return existsSync(path);
  const dir = dirname(path);
  if (dir.includes("*")) {
    // a star in a directory name: try each directory it could be
    const parent = dirname(dir);
    if (parent.includes("*") || !existsSync(parent)) return false;
    const pattern = new RegExp(`^${dir.slice(parent.length + 1).replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);
    return readdirSync(parent).some((name) => pattern.test(name) && statSync(join(parent, name)).isDirectory() && matchesGlob(join(parent, name, path.slice(dir.length + 1))));
  }
  if (!existsSync(dir)) return false;
  const pattern = new RegExp(`^${path.slice(dir.length + 1).replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);
  return readdirSync(dir).some((name) => pattern.test(name));
}

/** The references in one document that point at nothing. */
export function deadReferences(file: string, text: string): string[] {
  const dead: string[] = [];
  const lines = text.split("\n");
  let fenced = false;
  lines.forEach((line, index) => {
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
      return;
    }
    if (fenced) return;
    const where = `${file}:${index + 1}`;
    // Markdown links
    for (const m of line.matchAll(/\]\(([^)\s]+)\)/g)) {
      const target = (m[1] as string).split("#")[0] as string;
      if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
      const path = normalize(join(dirname(file), target));
      if (!existsSync(path)) dead.push(`${where}: link to ${target}`);
    }
    // paths in backticks that start at the repository's root
    for (const m of line.matchAll(/`([^`\s]+)`/g)) {
      let token = m[1] as string;
      if (!ROOTS.some((root) => token.startsWith(`${root}/`))) continue;
      if (/[<>…$]|\.\.\./.test(token)) continue; // a pattern for the reader to fill in, not a path
      token = token.replace(/[.,;:]+$/, "").replace(/:\d+([-–]\d+)?$/, "");
      for (const path of expandBraces(token)) if (!matchesGlob(path.replace(/\/\*\*$/, "").replace(/\/$/, ""))) dead.push(`${where}: \`${path}\``);
    }
  });
  return dead;
}

function main(): void {
  const tracked = execFileSync("git", ["ls-files", "-co", "--exclude-standard", "*.md"], { encoding: "utf8" }).split("\n").filter(Boolean);
  const files = tracked.filter((f) => !f.startsWith("prompts/") && !f.startsWith("node_modules/") && !/^evidence\/.*\/review-[^/]*\.md$/.test(f) && existsSync(f));
  const dead = files.flatMap((f) => deadReferences(f, readFileSync(f, "utf8")));
  if (dead.length) {
    console.error(`check:links FAILED — ${dead.length} reference(s) to something that is not there:`);
    for (const d of dead) console.error(`  ${d}`);
    process.exit(1);
  }
  console.log(`check:links passed: ${files.length} documents; every link to a file in the repository and every root-relative path in backticks exists.`);
}

if ((process.argv[1] ?? "").endsWith("check-links.ts")) main();
