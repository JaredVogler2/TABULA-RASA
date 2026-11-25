/**
 * Make the two values owner sign-in needs.
 *
 *   pnpm owner:hash            asks for a passphrase (typed twice, not echoed) and prints
 *                              OWNER_PASSWORD_HASH=…   put this in the server's environment
 *                              AUTH_SECRET=…           a fresh random signing secret
 *
 * The passphrase is read from the terminal, or from standard input when piped. It is never
 * taken from the command line (which shells record) and never printed. Nothing is written
 * to disk: copy the two lines into .env.local or your deployment's secret settings yourself.
 */
import { randomBytes } from "node:crypto";
import { MIN_PASSPHRASE_LENGTH, hashPassphrase, verifyPassphrase } from "../src/server/auth";

function readHidden(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    process.stderr.write(prompt);
    let value = "";
    const raw = stdin.isTTY;
    if (raw) stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const done = (): void => {
      if (raw) stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("data", onData);
      process.stderr.write("\n");
      resolve(value);
    };
    const onData = (chunk: string): void => {
      for (const ch of chunk) {
        if (ch === "\n" || ch === "\r" || ch === "\u0004") return done();
        if (ch === "\u0003") {
          if (raw) stdin.setRawMode(false);
          reject(new Error("cancelled"));
          return;
        }
        if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on("data", onData);
  });
}

async function readPiped(): Promise<string> {
  let text = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) text += chunk;
  return text.replace(/\r?\n$/, "");
}

async function main(): Promise<void> {
  let passphrase: string;
  if (process.stdin.isTTY) {
    passphrase = await readHidden(`Owner passphrase (at least ${MIN_PASSPHRASE_LENGTH} characters): `);
    const again = await readHidden("Again: ");
    if (passphrase !== again) {
      console.error("The two entries differ. Nothing was produced.");
      process.exit(1);
    }
  } else {
    passphrase = await readPiped();
  }
  if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
    console.error(`A passphrase needs at least ${MIN_PASSPHRASE_LENGTH} characters. Nothing was produced.`);
    process.exit(1);
  }
  const hash = await hashPassphrase(passphrase);
  if (!(await verifyPassphrase(passphrase, hash))) throw new Error("self-check failed");
  console.log(`OWNER_PASSWORD_HASH=${hash}`);
  console.log(`AUTH_SECRET=${randomBytes(48).toString("base64url")}`);
  console.error("\nPut both lines in the server's environment (.env.local, or your deployment's secrets). They are not secrets you need to remember, but they must stay on the server.");
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : "failed");
  process.exit(1);
});
