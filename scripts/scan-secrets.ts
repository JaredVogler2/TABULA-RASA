/**
 * Scan everything git tracks for things that must never be committed.
 *
 *   pnpm scan:secrets
 *
 * Fails (exit 1) if it finds: a credential-shaped string; a private key; an env file other
 * than the template; a secret-named variable with a value in the template; or a
 * NEXT_PUBLIC_ variable whose name suggests a secret. Prints file and line, never the match.
 *
 * Test fixtures use deliberately fake, short credentials; the patterns below match the real
 * shapes (length included), and the few fixture lines that would still match carry the
 * marker `scan:allow` with the reason.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";

interface Rule {
  name: string;
  pattern: RegExp;
}

const RULES: Rule[] = [
  { name: "Anthropic API key", pattern: /sk-ant-(?:api|admin)\d{2}-[A-Za-z0-9_-]{80,}/ },
  { name: "private key block", pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/ },
  { name: "database URL with a password", pattern: /postgres(?:ql)?:\/\/[^\s:@/]+:[^\s@/]{6,}@(?!localhost|127\.0\.0\.1|db\.example|db\.internal|x\b)[^\s/]+/ },
  { name: "AWS access key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "GitHub token", pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { name: "Slack token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}/ },
  { name: "Vercel token", pattern: /\bvercel_[A-Za-z0-9]{24,}\b/ },
  { name: "owner password hash", pattern: /scrypt:\d{5,7}:\d{1,2}:\d:[A-Za-z0-9_-]{20,}:[A-Za-z0-9_-]{40,}/ },
  { name: "bearer token", pattern: /\bBearer\s+[A-Za-z0-9._-]{40,}/ },
];

const SECRET_NAMES = /^(ANTHROPIC_API_KEY|AUTH_SECRET|OWNER_PASSWORD_HASH|DATABASE_URL|TEST_DATABASE_URL)\s*=\s*(\S+)/;
const PUBLIC_SECRET = /NEXT_PUBLIC_[A-Z0-9_]*(KEY|SECRET|TOKEN|PASSWORD|PASSPHRASE|DATABASE|ANTHROPIC|AUTH)/;

function tracked(): string[] {
  return execFileSync("git", ["ls-files", "-z"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).split("\0").filter(Boolean);
}

/** Findings for one tracked file's text. Exported so that the scanner itself can be tested. */
export function findingsIn(file: string, text: string): string[] {
  const findings: string[] = [];
  const base = file.split("/").pop() as string;
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    if (line.includes("scan:allow")) continue;
    for (const rule of RULES) if (rule.pattern.test(line)) findings.push(`${file}:${i + 1}: looks like a ${rule.name}`);
    if (PUBLIC_SECRET.test(line) && !file.startsWith("scripts/scan-") && !file.startsWith("docs/") && !file.startsWith("prompts/") && !file.startsWith("tests/unit/scans")) findings.push(`${file}:${i + 1}: a NEXT_PUBLIC_ variable is named like a secret`);
    if (base === ".env.example") {
      const m = SECRET_NAMES.exec(line);
      if (m) findings.push(`${file}:${i + 1}: ${m[1]} has a value in the template`);
    }
  }
  return findings;
}

export const isForbiddenEnvFile = (file: string): boolean => {
  const base = file.split("/").pop() as string;
  return /^\.env(\..+)?$/.test(base) && base !== ".env.example";
};

function main(): void {
  const findings: string[] = [];
  let scanned = 0;
  for (const file of tracked()) {
    if (isForbiddenEnvFile(file)) {
      findings.push(`${file}: an env file is tracked (only .env.example may be)`);
      continue;
    }
    if (/\.(png|jpe?g|webp|gif|ico|woff2?|ttf|otf|mp3|ogg|wav|gz|zip|pdf)$/i.test(file)) continue;
    let text: string;
    try {
      if (statSync(file).size > 4 * 1024 * 1024) continue;
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    scanned++;
    findings.push(...findingsIn(file, text));
  }
  if (findings.length) {
    console.error(`scan:secrets FAILED — ${findings.length} finding(s) in ${scanned} tracked files:`);
    for (const f of findings) console.error(`  ${f}`);
    process.exit(1);
  }
  console.log(`scan:secrets passed: ${scanned} tracked text files, ${RULES.length} credential patterns, no env files tracked, template values empty, no secret-named public variables.`);
}

if ((process.argv[1] ?? "").endsWith("scan-secrets.ts")) main();
