import "server-only";

/**
 * What every owner endpoint does before it does anything else.
 *
 * Order matters and is the same everywhere: rate limit → same-origin → session → anti-forgery
 * token → body size and shape. A request that fails any step is answered with a plain refusal
 * and reaches nothing behind it — no database write, no ledger, no provider.
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

/** A key for rate limiting by client. Trusts the platform's forwarding header; falls back to one shared bucket. */
export function clientKey(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  const ip = (fwd ? fwd.split(",")[0] : request.headers.get("x-real-ip")) ?? "";
  const clean = ip.trim().slice(0, 64).replace(/[^0-9a-fA-F:.]/g, "");
  return clean || "unknown";
}

/**
 * Fixed-window counter shared by every instance. Returns whether this request is within the
 * limit. If the database cannot be reached the answer is no: an endpoint that cannot count
 * its callers does not serve them.
 */
export async function rateLimit(db: Db, key: string, limit: number, windowSec: number, nowMs: number = Date.now()): Promise<{ ok: boolean; retryAfterSec: number }> {
  const windowStart = Math.floor(nowMs / 1000 / windowSec) * windowSec;
  const retryAfterSec = Math.max(1, windowStart + windowSec - Math.floor(nowMs / 1000));
  try {
    const rows = await db.query("INSERT INTO rate_limits (key, window_start, count) VALUES ($1, $2::bigint, 1) ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limits.count + 1 RETURNING count", [key.slice(0, 120), windowStart]);
    const count = Number(rows[0]?.count ?? limit + 1);
    // old windows are swept occasionally, by whoever happens to open a new one
    if (count === 1) await db.query("DELETE FROM rate_limits WHERE window_start < $1::bigint", [windowStart - 24 * 3600]).catch(() => undefined);
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

/** The owner's session, if this request carries a valid one. Reads nothing but headers. */
export function ownerSession(request: Request, nowMs: number = Date.now()): { session: Session; secret: string } | null {
  const secret = authSecret();
  if (!secret) return null;
  const cookie = readCookie(request.headers.get("cookie"), cookieName(isSecure(request)));
  const session = readSession(secret, cookie, nowMs);
  return session ? { session, secret } : null;
}

/**
 * Gate for owner endpoints. `write` adds the same-origin and anti-forgery checks that every
 * state-changing request must pass.
 */
export function requireOwner(request: Request, write: boolean, nowMs: number = Date.now()): Guarded {
  if (write && !sameOrigin(request)) return { ok: false, response: refuse(403, "cross_origin") };
  const owner = ownerSession(request, nowMs);
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
