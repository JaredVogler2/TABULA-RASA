/**
 * Scan what this repository holds, and what it has ever held, for things that must never be
 * committed.
 *
 *   pnpm scan:secrets        every file git tracks, and every file it would track if added
 *                            (untracked and not ignored): what the next commit could contain
 *   pnpm scan:history        every line any commit on any branch has ever added
 *
 * Fails (exit 1) if it finds: a credential-shaped string; a private key; an env file other
 * than the template; a secret-named variable with a value in the template; a NEXT_PUBLIC_
 * variable whose name suggests a secret; or a file it cannot read into (an archive, or a
 * file too large to be source). Prints file and line, never the match.
 *
 * There is no marker that excuses a line. Test fixtures use deliberately fake, short
 * credentials, and the patterns below match the real shapes (length included); the scanner's
 * own tests assemble their examples at run time, so no file here contains one.
 */
import { execFileSync, spawn } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { createInterface } from "node:readline";
import { gunzipSync } from "node:zlib";

interface Rule {
  name: string;
  pattern: RegExp;
}

/**
 * Database hosts that are nobody's database: this machine, and the made-up names the tests
 * use. The name has to be the whole host: "localhost.example.org" and "db.internal.corp" are
 * real places.
 */
const NOBODY = new Set(["localhost", "127.0.0.1", "[::1]", "db.example", "db.internal", "x"]);
const DB_URL = /\b(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|rediss?|amqps?):\/\/([^\s"'`<>]+)/g;

/** The host a piece of a URL's authority starts with: up to the port, the path, the query or the end. */
function leadingHost(part: string): string {
  if (part.startsWith("[")) return part.slice(0, part.indexOf("]") + 1 || part.length).toLowerCase();
  return (part.split(/[:/?#]/)[0] as string).toLowerCase();
}

/**
 * Does the line hold a database URL with a password, for a host that could be somebody's?
 * Programs disagree about which "@" ends the credentials ("user:pw@localhost:5432@db.real.org"
 * is db.real.org to most of them), so every host the URL could mean has to be nobody's. A
 * password of any length counts: a short one opens the same door.
 */
export function hasDatabasePassword(line: string): boolean {
  for (const m of line.matchAll(DB_URL)) {
    const rest = m[1] as string;
    const lastAt = rest.lastIndexOf("@");
    if (lastAt < 0) continue;
    const colon = rest.indexOf(":");
    if (colon < 0 || colon > lastAt) continue;
    if (lastAt - colon - 1 < 1) continue; // "user@host", or "user:@host": no password
    const hosts = rest.split("@").slice(1).map(leadingHost);
    if (hosts.every((h) => NOBODY.has(h))) continue;
    return true;
  }
  return false;
}

const RULES: Rule[] = [
  // every kind the provider issues has this shape: API keys (api03), admin keys (admin01), OAuth access and refresh tokens (oat01, ort01), …
  { name: "Anthropic key or token", pattern: /sk-ant-[a-z]{2,8}\d{2}-[A-Za-z0-9_-]{40,}/ },
  { name: "private key block", pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/ },
  { name: "AWS access key", pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { name: "GitHub token", pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})\b/ },
  { name: "Slack token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}/ },
  { name: "Vercel token", pattern: /\bvercel_[A-Za-z0-9]{24,}\b/ },
  { name: "owner password hash", pattern: /scrypt:\d{5,7}:\d{1,2}:\d:[A-Za-z0-9_-]{20,}:[A-Za-z0-9_-]{40,}/ },
  { name: "bearer token", pattern: /\bBearer\s+[A-Za-z0-9._-]{40,}/ },
];

const SECRET_NAMES = /^(ANTHROPIC_API_KEY|AUTH_SECRET|OWNER_PASSWORD_HASH|DATABASE_URL|TEST_DATABASE_URL)\s*=\s*(\S+)/;
const PUBLIC_SECRET = /NEXT_PUBLIC_[A-Z0-9_]*(KEY|SECRET|TOKEN|PASSWORD|PASSPHRASE|DATABASE|ANTHROPIC|AUTH)/;

/** Files that are not text and cannot hold a readable credential: pictures, fonts, sound. */
const NOT_TEXT = /\.(png|jpe?g|webp|gif|ico|avif|woff2?|ttf|otf|mp3|ogg|wav|pdf)$/i;
/** Containers the scan cannot read into. None belongs in this repository; one that appears is a finding, not a skip. */
const OPAQUE = /\.(zip|tgz|tar|bz2|xz|7z|rar|br|zst|jar|sqlite|db)$/i;
/** Nothing here is anywhere near this size; a file that is cannot be reviewed by reading it either. */
export const MAX_SCANNED_BYTES = 64 * 1024 * 1024;

/** What git tracks, plus what it would track if added: the most the next commit could contain. */
function candidates(): string[] {
  return execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    .split("\0")
    .filter(Boolean);
}

/** What is wrong with one line of one file: descriptions only, never the text. Exported for the tests. */
export function lineFindings(file: string, line: string): string[] {
  const out: string[] = [];
  for (const rule of RULES) if (rule.pattern.test(line)) out.push(`looks like a ${rule.name}`);
  if (hasDatabasePassword(line)) out.push("looks like a database URL with a password");
  if (PUBLIC_SECRET.test(line) && !file.startsWith("scripts/scan-") && !file.startsWith("docs/") && !file.startsWith("prompts/") && !file.startsWith("tests/unit/scans")) out.push("a NEXT_PUBLIC_ variable is named like a secret");
  if ((file.split("/").pop() as string) === ".env.example") {
    const m = SECRET_NAMES.exec(line);
    if (m) out.push(`${m[1]} has a value in the template`);
  }
  return out;
}

/** Findings for one file's text. Exported so that the scanner itself can be tested. */
export function findingsIn(file: string, text: string): string[] {
  const findings: string[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) for (const what of lineFindings(file, lines[i] as string)) findings.push(`${file}:${i + 1}: ${what}`);
  return findings;
}

export const isForbiddenEnvFile = (file: string): boolean => {
  const base = file.split("/").pop() as string;
  return /^\.env(\..+)?$/.test(base) && base !== ".env.example";
};

/** Why a file cannot be scanned at all, or null. Exported for the tests. */
export function unreadable(file: string, bytes: number): string | null {
  if (OPAQUE.test(file)) return "an archive or database file: the scan cannot read inside it, and nothing here should be one";
  if (bytes > MAX_SCANNED_BYTES) return `too large to scan (${(bytes / 1024 / 1024).toFixed(0)} MB): nothing here should be`;
  return null;
}

function scanTree(): { findings: string[]; scanned: number } {
  const findings: string[] = [];
  let scanned = 0;
  for (const file of candidates()) {
    if (isForbiddenEnvFile(file)) {
      findings.push(`${file}: an env file is tracked, or would be if added (only .env.example may be)`);
      continue;
    }
    if (NOT_TEXT.test(file)) continue;
    let text: string;
    try {
      const st = statSync(file);
      if (!st.isFile()) continue;
      const why = unreadable(file, st.size);
      if (why) {
        findings.push(`${file}: ${why}`);
        continue;
      }
      const raw = readFileSync(file);
      text = /\.gz$/i.test(file) ? gunzipSync(raw, { maxOutputLength: MAX_SCANNED_BYTES }).toString("utf8") : raw.toString("utf8");
    } catch (err) {
      // deleted in the working tree but still in the index is nothing to read; anything else that will not open is said
      if (err && typeof err === "object" && "code" in err && (err as { code: unknown }).code === "ENOENT") continue;
      findings.push(`${file}: could not be read for scanning`);
      continue;
    }
    scanned++;
    findings.push(...findingsIn(file, text));
  }
  return { findings, scanned };
}

/**
 * Every line any commit reachable from any ref has added. A secret that was committed and
 * later removed is still in every clone; this is the only scan that would see it.
 */
async function scanHistory(): Promise<{ findings: string[]; commits: number; lines: number }> {
  const shallow = execFileSync("git", ["rev-parse", "--is-shallow-repository"], { encoding: "utf8" }).trim() === "true";
  if (shallow) return { findings: ["this clone is shallow: its history is not here to scan (fetch it all first)"], commits: 0, lines: 0 };
  const child = spawn("git", ["log", "--all", "-p", "-U0", "--no-color", "--no-ext-diff", "--no-textconv", "--full-history", "-m", "--format=commit %H"], { stdio: ["ignore", "pipe", "inherit"] });
  const seen = new Set<string>();
  const findings: string[] = [];
  const once = (key: string, finding: string): void => {
    if (seen.has(key)) return;
    seen.add(key);
    findings.push(finding);
  };
  let commit = "";
  let file = "";
  // A diff is headers, then hunks. Inside a hunk every line of content carries a prefix, so a
  // line that starts with "commit", "diff" or "@@" there is git's, never the file's — and an
  // added line that itself begins "++ b/…" is content, not a header.
  let inHunk = false;
  let commits = 0;
  let lines = 0;
  for await (const line of createInterface({ input: child.stdout, crlfDelay: Infinity })) {
    if (/^commit [0-9a-f]{40}/.test(line)) {
      commit = line.slice(7, 19);
      commits++;
      file = "";
      inHunk = false;
      continue;
    }
    if (line.startsWith("diff --git ")) {
      // the name is read from the "+++" line; until then, lines still count against a name that excuses nothing
      file = "(a file whose name could not be read)";
      inHunk = false;
      continue;
    }
    if (line.startsWith("@@")) {
      inHunk = true;
      continue;
    }
    if (!inHunk) {
      if (line.startsWith("+++ ")) {
        const named = line.slice(4).replace(/^"(.*)"$/, "$1").replace(/\t$/, "");
        if (named.startsWith("b/")) file = named.slice(2);
        if (isForbiddenEnvFile(file)) once(`${file}|env`, `${commit} ${file}: an env file was committed (only .env.example may be)`);
        if (OPAQUE.test(file)) once(`${file}|opaque`, `${commit} ${file}: an archive or database file was committed: the scan cannot read inside it`);
      }
      continue;
    }
    if (!line.startsWith("+")) continue;
    lines++;
    for (const what of lineFindings(file, line.slice(1))) once(`${file}|${what}`, `${commit} ${file}: ${what}`);
  }
  const code: number = await new Promise((resolve) => child.on("close", (c) => resolve(c ?? 1)));
  if (code !== 0) findings.push("git could not list the history: nothing can be said about it");
  return { findings, commits, lines };
}

async function main(): Promise<void> {
  if (process.argv.includes("--history")) {
    const { findings, commits, lines } = await scanHistory();
    if (findings.length) {
      console.error(`scan:history FAILED — ${findings.length} finding(s) in ${commits} commit(s). A secret that was ever committed must be revoked, whatever is done about the history:`);
      for (const f of findings) console.error(`  ${f}`);
      process.exit(1);
    }
    // merges are diffed against each parent (-m), so a commit can be counted more than once
    console.log(`scan:history passed: ${lines} added lines across the diffs of every commit on every ref (${commits} diffs), ${RULES.length + 1} credential patterns, no env file, archive or secret-named public variable ever committed.`);
    return;
  }
  const { findings, scanned } = scanTree();
  if (findings.length) {
    console.error(`scan:secrets FAILED — ${findings.length} finding(s) in ${scanned} files:`);
    for (const f of findings) console.error(`  ${f}`);
    process.exit(1);
  }
  console.log(`scan:secrets passed: ${scanned} text files (tracked, and untracked but not ignored), ${RULES.length + 1} credential patterns, no env files, no archives, template values empty, no secret-named public variables.`);
}

if ((process.argv[1] ?? "").endsWith("scan-secrets.ts")) void main();
