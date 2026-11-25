import "server-only";

/**
 * What every owner endpoint does before it does anything else.
 *
 * Order matters and is the same everywhere: same-origin → session → anti-forgery token →
 * session epoch → rate limit → body size and shape. A request that fails any step is answered
 * with a plain refusal and reaches nothing behind it — no ledger, no provider. (Sign-in, which
 * has no session yet, is counted before the passphrase is looked at.)
 *
 * Responses never echo configuration, secrets or internal error text. Errors are logged by
 * code only.
 */
import { cookieName, csrfMatches, readCookie, readSession, type Session } from "./auth";
import { authSecret } from "./env";
import type { Db } from "./db";

export const json = (data: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });

export const refuse = (status: number, code: string, message?: string, headers: Record<string, string> = {}): Response => json({ ok: false, error: code, ...(message ? { message } : {}) }, status, headers);

/** True if the request is served over HTTPS as far as the client is concerned. */
export function isSecure(request: Request): boolean {
  const proto = request.headers.get("x-forwarded-proto");
  if (proto) return proto.split(",")[0]!.trim() === "https";
  return new URL(request.url).protocol === "https:";
}

/** The host the client addressed. */
function requestHost(request: Request): string {
  return (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? new URL(request.url).host).split(",")[0]!.trim().toLowerCase();
}

/**
 * A state-changing request must come from this site: the browser-set Origin header has to
 * name our own host, and if the browser says where the request was initiated
 * (Sec-Fetch-Site) it has to be same-origin. A request with no Origin at all is refused —
 * browsers always send one on cross-origin and on same-origin POSTs.
 */
export function sameOrigin(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin") return false;
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host.toLowerCase() === requestHost(request);
  } catch {
    return false;
  }
}

/**
 * An address as a rate-limit key: an IPv4 address whole, an IPv6 address as its /64 network
 * (one subscriber is handed a whole /64, so counting its 2^64 addresses one by one would
 * count nothing), an IPv4 address written as IPv6 as the IPv4 address. Anything that is not
 * an address is "".
 */
export function networkOf(raw: string): string {
  const ip = raw.trim().toLowerCase().replace(/^\[|\]$/g, "");
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const asV4 = (text: string): string => {
    const m = v4.exec(text);
    return m && m.slice(1).every((part) => Number(part) <= 255) ? m.slice(1).map(Number).join(".") : "";
  };
  if (!ip.includes(":")) return asV4(ip);
  if (ip.length > 45 || !/^[0-9a-f:.]+$/.test(ip) || (ip.match(/::/g) ?? []).length > 1) return "";
  const mapped = /^(?:0{0,4}:){0,5}:?(?:ffff:)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(ip);
  if (mapped) return asV4(mapped[1] as string);
  const [head = "", tail = ""] = ip.includes("::") ? ip.split("::") : [ip, ""];
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  if ([...left, ...right].some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return "";
  if (ip.includes("::") ? left.length + right.length > 7 : left.length !== 8) return "";
  const groups = [...left, ...new Array<string>(8 - left.length - right.length).fill("0"), ...right];
  return `${groups
    .slice(0, 4)
    .map((group) => group.replace(/^0+(?=.)/, ""))
    .join(":")}::/64`;
}

/**
 * A key for rate limiting by client.
 *
 * A request does not say where it came from; a header does, and a header is whatever the
 * sender wrote unless something in front of the application overwrites it. Vercel overwrites
 * `x-forwarded-for` and does not forward external addresses (vercel.com/docs/headers/request-headers),
 * and `x-vercel-forwarded-for` carries the same value even behind a proxy of one's own — so on
 * Vercel those are believed. Anywhere else the header is believed only if the deployment says
 * a proxy that overwrites it stands in front (`TRUST_FORWARDED_FOR=true`). Otherwise every
 * client shares one bucket: the limits then hold for everyone together, which is strict and
 * cannot be talked round.
 */
export function clientKey(request: Request, env: Record<string, string | undefined> = process.env): string {
  const onVercel = (env.VERCEL ?? "").trim() === "1";
  if (!onVercel && (env.TRUST_FORWARDED_FOR ?? "").trim() !== "true") return "unknown";
  const raw = (onVercel ? request.headers.get("x-vercel-forwarded-for") : null) ?? request.headers.get("x-forwarded-for") ?? "";
  return networkOf(raw.split(",")[0] ?? "") || "unknown";
}

const buckets = new Map<string, { window: number; count: number }>();
const BUCKET_LIMIT = 5000;

/**
 * A counter kept in this instance's memory, for what does not deserve a database write: a
 * stranger's read of something public, and the first brake on a flood. It is not shared
 * between instances and forgets when one is recycled, so it bounds what one instance will
 * serve one network, not what the deployment will — the platform's firewall is the limit on
 * volume. It holds a bounded number of keys and evicts the oldest.
 */
export function memoryLimit(key: string, limit: number, windowSec: number, nowMs: number = Date.now()): { ok: boolean; retryAfterSec: number } {
  const window = Math.floor(nowMs / 1000 / windowSec);
  const retryAfterSec = Math.max(1, (window + 1) * windowSec - Math.floor(nowMs / 1000));
  let bucket = buckets.get(key);
  if (!bucket || bucket.window !== window) {
    buckets.delete(key);
    if (buckets.size >= BUCKET_LIMIT) {
      let drop = BUCKET_LIMIT / 10;
      for (const old of buckets.keys()) {
        if (drop-- <= 0) break;
        buckets.delete(old);
      }
    }
    bucket = { window, count: 0 };
    buckets.set(key, bucket);
  }
  bucket.count++;
  return { ok: bucket.count <= limit, retryAfterSec };
}

/** For tests: forget every in-memory counter. */
export function forgetMemoryLimits(): void {
  buckets.clear();
  lastSweepMs = 0;
}

let lastSweepMs = 0;
const SWEEP_EVERY_MS = 10 * 60_000;

/**
 * Fixed-window counter shared by every instance, for sign-in and for the owner's own actions.
 * Returns whether this request is within the limit. If the database cannot be reached the
 * answer is no: an endpoint that cannot count its callers does not serve them. Old windows
 * are deleted at most once every ten minutes by each instance (by an index on the window),
 * never once per request.
 */
export async function rateLimit(db: Db, key: string, limit: number, windowSec: number, nowMs: number = Date.now()): Promise<{ ok: boolean; retryAfterSec: number }> {
  const windowStart = Math.floor(nowMs / 1000 / windowSec) * windowSec;
  const retryAfterSec = Math.max(1, windowStart + windowSec - Math.floor(nowMs / 1000));
  try {
    const rows = await db.query("INSERT INTO rate_limits (key, window_start, count) VALUES ($1, $2::bigint, 1) ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limits.count + 1 RETURNING count", [key.slice(0, 120), windowStart]);
    const count = Number(rows[0]?.count ?? limit + 1);
    if (nowMs - lastSweepMs >= SWEEP_EVERY_MS) {
      lastSweepMs = nowMs;
      await db.query("DELETE FROM rate_limits WHERE window_start < $1::bigint", [Math.floor(nowMs / 1000) - 24 * 3600]).catch(() => undefined);
    }
    return { ok: count <= limit, retryAfterSec };
  } catch {
    return { ok: false, retryAfterSec };
  }
}

export class BodyError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
  ) {
    super(code);
  }
}

/** Read a JSON body of at most `maxBytes`. Throws BodyError (413, 415, 400). */
export async function readJson(request: Request, maxBytes = 16_384): Promise<unknown> {
  const type = (request.headers.get("content-type") ?? "").toLowerCase();
  if (!type.startsWith("application/json")) throw new BodyError(415, "json_required");
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) throw new BodyError(413, "too_large");
  const reader = request.body?.getReader();
  if (!reader) throw new BodyError(400, "empty_body");
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new BodyError(413, "too_large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new BodyError(400, "bad_json");
  }
}

export type Guarded = { ok: true; session: Session; secret: string } | { ok: false; response: Response };

/**
 * The owner's session, if this request carries one that this site signed and that has not
 * expired. Reads nothing but headers — so it cannot know whether the session has since been
 * signed out: the gate in api.ts checks its epoch against the database before anything is done.
 */
export function ownerSession(request: Request, nowMs: number = Date.now(), env: Record<string, string | undefined> = process.env): { session: Session; secret: string } | null {
  const secret = authSecret(env);
  if (!secret) return null;
  const cookie = readCookie(request.headers.get("cookie"), cookieName(isSecure(request)));
  const session = readSession(secret, cookie, nowMs);
  return session ? { session, secret } : null;
}

/**
 * Gate for owner endpoints. `write` adds the same-origin and anti-forgery checks that every
 * state-changing request must pass.
 */
export function requireOwner(request: Request, write: boolean, nowMs: number = Date.now(), env: Record<string, string | undefined> = process.env): Guarded {
  if (write && !sameOrigin(request)) return { ok: false, response: refuse(403, "cross_origin") };
  const owner = ownerSession(request, nowMs, env);
  if (!owner) return { ok: false, response: refuse(401, "not_signed_in") };
  if (write && !csrfMatches(owner.secret, owner.session, request.headers.get("x-csrf-token"))) return { ok: false, response: refuse(403, "bad_csrf_token") };
  return { ok: true, session: owner.session, secret: owner.secret };
}

/** Log an internal failure by code, without its message (which could contain anything). */
export function logFailure(where: string, err: unknown): void {
  const name = err instanceof Error ? err.name : typeof err;
  const code = err && typeof err === "object" && "code" in err && typeof (err as { code: unknown }).code === "string" ? (err as { code: string }).code : "";
  console.error(`[tabula-rasa] ${where} failed: ${name}${code ? ` (${code})` : ""}`);
}
