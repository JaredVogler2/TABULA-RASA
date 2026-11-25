/**
 * Scan what the browser is sent for anything that belongs only on the server.
 *
 *   pnpm build && pnpm scan:bundle
 *
 * Looks at every file under .next/static (the client JavaScript, CSS and media) and at the
 * prerendered HTML and RSC payloads of every page. Fails (exit 1) if any of them contains:
 *
 *   - the name of a secret environment variable, or the value of one that is set right now
 *   - a marker string that exists only in server modules (the ledger's SQL, the provider
 *     adapter, the session code) — evidence that server code was bundled for the client
 *   - the provider's API host, or a credential-shaped string
 *
 * Prints the file and which rule matched, never the surrounding text.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = ".next";

/** Strings that appear in server-only source and nowhere a browser needs them. */
const SERVER_MARKERS = [
  "ANTHROPIC_API_KEY",
  "OWNER_PASSWORD_HASH",
  "AUTH_SECRET",
  "DATABASE_URL",
  "budget_never_exceeded",
  "reserved_microusd",
  "INSERT INTO reservations",
  "UPDATE budget SET",
  "api.anthropic.com",
  "anthropic-version",
  "timingSafeEqual",
  "__Host-tr_owner",
  "lease_until",
];

const CREDENTIAL_SHAPES: [string, RegExp][] = [
  ["Anthropic API key", /sk-ant-(?:api|admin)\d{2}-[A-Za-z0-9_-]{40,}/],
  ["database URL", /postgres(?:ql)?:\/\/[^\s"'`:@/]+:[^\s"'`@/]+@/],
  ["private key block", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["owner password hash", /scrypt:\d{5,7}:\d{1,2}:\d:[A-Za-z0-9_-]{20,}:[A-Za-z0-9_-]{40,}/],
];

const SECRET_ENV = ["ANTHROPIC_API_KEY", "AUTH_SECRET", "OWNER_PASSWORD_HASH", "DATABASE_URL", "TEST_DATABASE_URL"];

function walk(dir: string, out: string[]): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

/** Findings for one client-facing file's text. Exported so that the scanner itself can be tested. */
export function bundleFindings(file: string, text: string, liveValues: readonly (readonly [string, string])[] = []): string[] {
  const findings: string[] = [];
  for (const marker of SERVER_MARKERS) if (text.includes(marker)) findings.push(`${file}: contains the server-only marker "${marker}"`);
  for (const [name, pattern] of CREDENTIAL_SHAPES) if (pattern.test(text)) findings.push(`${file}: contains something shaped like a ${name}`);
  for (const [name, value] of liveValues) if (text.includes(value)) findings.push(`${file}: contains the current value of ${name}`);
  return findings;
}

function main(): void {
  if (!existsSync(join(ROOT, "static"))) {
    console.error("scan:bundle: .next/static does not exist. Run `pnpm build` first.");
    process.exit(1);
  }
  const files = walk(join(ROOT, "static"), []);
  // what is prerendered for the browser: HTML and RSC payloads of app routes
  for (const f of walk(join(ROOT, "server", "app"), [])) if (/\.(html|rsc|txt|json)$/.test(f) && !f.endsWith(".nft.json")) files.push(f);
  const liveValues = SECRET_ENV.map((name) => [name, (process.env[name] ?? "").trim()] as const).filter(([, v]) => v.length >= 8);
  const findings: string[] = [];
  let bytes = 0;
  for (const file of files) {
    if (/\.(png|jpe?g|webp|gif|ico|woff2?|ttf|otf|mp3|ogg|wav|map)$/i.test(file)) continue;
    const text = readFileSync(file, "utf8");
    bytes += text.length;
    findings.push(...bundleFindings(file, text, liveValues));
  }
  if (findings.length) {
    console.error(`scan:bundle FAILED — ${findings.length} finding(s):`);
    for (const f of findings) console.error(`  ${f}`);
    process.exit(1);
  }
  console.log(`scan:bundle passed: ${files.length} client-facing files (${(bytes / 1024).toFixed(0)} KB of text), ${SERVER_MARKERS.length} server-only markers, ${CREDENTIAL_SHAPES.length} credential shapes, ${liveValues.length} live secret value(s) checked.`);
}

if ((process.argv[1] ?? "").endsWith("scan-bundle.ts")) main();
