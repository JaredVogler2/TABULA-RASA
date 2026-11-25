import "server-only";

/**
 * Owner authentication.
 *
 * There is exactly one privileged person, and no accounts. The owner proves who they are with
 * a passphrase checked against a scrypt hash kept in the server's environment; the server then
 * issues a signed session in an HttpOnly, SameSite=Strict cookie. Every request that changes
 * anything must also come from this site (Origin and Fetch-Metadata checks) and carry a token
 * derived from the session that scripts on other sites cannot read.
 *
 * Nothing here stores state: a session is valid if its signature is, until it expires.
 * Changing AUTH_SECRET signs everyone out, which is the rotation procedure.
 */
import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual, type ScryptOptions } from "node:crypto";

const scrypt = (password: string, salt: Buffer, keylen: number, options: ScryptOptions): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    scryptCallback(password, salt, keylen, options, (err, key) => (err ? reject(err) : resolve(key)));
  });

/** scrypt cost. N = 2^15, r = 8, p = 1 needs about 32 MiB and a tenth of a second. */
const COST = { N: 32_768, r: 8, p: 1, keylen: 32, saltBytes: 16 } as const;
const maxmemFor = (N: number, r: number): number => 256 * N * r;

export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
export const MIN_PASSPHRASE_LENGTH = 12;

const b64 = (buf: Buffer): string => buf.toString("base64url");
const unb64 = (s: string): Buffer => Buffer.from(s, "base64url");

/** `scrypt:N:r:p:salt:hash`, base64url. No character that an .env file would treat specially. */
export async function hashPassphrase(passphrase: string): Promise<string> {
  if (typeof passphrase !== "string" || passphrase.length < MIN_PASSPHRASE_LENGTH) throw new Error(`a passphrase needs at least ${MIN_PASSPHRASE_LENGTH} characters`);
  const salt = randomBytes(COST.saltBytes);
  const key = await scrypt(passphrase.normalize("NFKC"), salt, COST.keylen, { N: COST.N, r: COST.r, p: COST.p, maxmem: maxmemFor(COST.N, COST.r) });
  return `scrypt:${COST.N}:${COST.r}:${COST.p}:${b64(salt)}:${b64(key)}`;
}

/** Constant-time check of a passphrase against a stored hash. Never throws; a malformed hash matches nothing. */
export async function verifyPassphrase(passphrase: unknown, stored: string | null): Promise<boolean> {
  if (typeof passphrase !== "string" || passphrase.length === 0 || passphrase.length > 1024 || !stored) return false;
  const parts = stored.split(":");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  // bounds keep a mistyped hash from turning sign-in into a way to exhaust memory
  if (!Number.isInteger(N) || N < 16_384 || N > 1_048_576 || (N & (N - 1)) !== 0 || !Number.isInteger(r) || r < 8 || r > 16 || !Number.isInteger(p) || p < 1 || p > 4) return false;
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = unb64(parts[4] as string);
    expected = unb64(parts[5] as string);
  } catch {
    return false;
  }
  if (salt.length < 8 || expected.length < 16 || expected.length > 64) return false;
  try {
    const key = await scrypt(passphrase.normalize("NFKC"), salt, expected.length, { N, r, p, maxmem: maxmemFor(N, r) });
    return key.length === expected.length && timingSafeEqual(key, expected);
  } catch {
    return false;
  }
}

export interface Session {
  /** Random per sign-in. */
  sid: string;
  issuedAt: number;
  expiresAt: number;
}

const mac = (secret: string, purpose: string, data: string): Buffer => createHmac("sha256", secret).update(`${purpose}\n${data}`).digest();

function safeEqual(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

/** A new session and the cookie value that carries it. */
export function issueSession(secret: string, nowMs: number, ttlMs: number = SESSION_TTL_MS): { session: Session; cookie: string } {
  const session: Session = { sid: b64(randomBytes(18)), issuedAt: nowMs, expiresAt: nowMs + ttlMs };
  const payload = b64(Buffer.from(JSON.stringify({ v: 1, sid: session.sid, iat: session.issuedAt, exp: session.expiresAt }), "utf8"));
  return { session, cookie: `v1.${payload}.${b64(mac(secret, "session", payload))}` };
}

/** The session a cookie value carries, if its signature is ours and it has not expired. */
export function readSession(secret: string, cookie: string | undefined | null, nowMs: number): Session | null {
  if (typeof cookie !== "string" || cookie.length > 600) return null;
  const parts = cookie.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return null;
  const payload = parts[1] as string;
  let given: Buffer;
  try {
    given = unb64(parts[2] as string);
  } catch {
    return null;
  }
  if (!safeEqual(given, mac(secret, "session", payload))) return null;
  try {
    const p = JSON.parse(unb64(payload).toString("utf8")) as { v?: unknown; sid?: unknown; iat?: unknown; exp?: unknown };
    if (p.v !== 1 || typeof p.sid !== "string" || typeof p.iat !== "number" || typeof p.exp !== "number") return null;
    if (!(p.iat <= nowMs + 60_000) || !(nowMs < p.exp) || p.exp - p.iat > 7 * 24 * 60 * 60 * 1000) return null;
    return { sid: p.sid, issuedAt: p.iat, expiresAt: p.exp };
  } catch {
    return null;
  }
}

/** The anti-forgery token for a session. It is given to this site's own pages and must come back in a header. */
export function csrfToken(secret: string, session: Session): string {
  return b64(mac(secret, "csrf", session.sid));
}

export function csrfMatches(secret: string, session: Session, given: string | null | undefined): boolean {
  if (typeof given !== "string" || given.length === 0 || given.length > 200) return false;
  let buf: Buffer;
  try {
    buf = unb64(given);
  } catch {
    return false;
  }
  return safeEqual(buf, mac(secret, "csrf", session.sid));
}

/** `__Host-` binds the cookie to this exact host over HTTPS; plain HTTP (local development) cannot use it. */
export function cookieName(secure: boolean): string {
  return secure ? "__Host-tr_owner" : "tr_owner";
}

export function sessionCookie(value: string, secure: boolean, maxAgeSec: number): string {
  return [`${cookieName(secure)}=${value}`, "Path=/", "HttpOnly", "SameSite=Strict", ...(secure ? ["Secure"] : []), `Max-Age=${Math.max(0, Math.floor(maxAgeSec))}`].join("; ");
}

export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}
