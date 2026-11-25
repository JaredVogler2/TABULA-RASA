import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { memoryDb } from "../../tests/support/db";
import { SESSION_TTL_MS, cookieName, csrfMatches, csrfToken, hashPassphrase, issueSession, readCookie, readSession, sessionCookie, verifyPassphrase } from "./auth";
import type { Db } from "./db";
import { liveStatus, ownerAuthConfigured } from "./env";
import { BodyError, clientKey, isSecure, rateLimit, readJson, requireOwner, sameOrigin } from "./http";

const SECRET = "test-secret-0123456789abcdef0123456789abcdef";
const NOW = Date.parse("2026-12-01T10:00:00Z");

describe("the owner's passphrase", () => {
  it("is stored as a salted scrypt hash that only the passphrase opens", async () => {
    const hash = await hashPassphrase("correct horse battery staple");
    expect(hash).toMatch(/^scrypt:32768:8:1:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]{43}$/);
    expect(hash).not.toMatch(/[$\s"'#=]/); // nothing an .env file would mangle
    expect(await verifyPassphrase("correct horse battery staple", hash)).toBe(true);
    expect(await verifyPassphrase("correct horse battery stapl", hash)).toBe(false);
    expect(await verifyPassphrase("Correct horse battery staple", hash)).toBe(false);
    // the same passphrase hashes differently each time
    expect(await hashPassphrase("correct horse battery staple")).not.toBe(hash);
  });

  it("matches nothing when the hash is missing, malformed or absurd, and never throws", async () => {
    const good = await hashPassphrase("a perfectly fine passphrase");
    const [, , , , salt, key] = good.split(":");
    const bad = [null, "", "plain", "scrypt:1:8:1:aa:bb", `scrypt:12:8:1:${salt}:${key}`, `scrypt:33554432:8:1:${salt}:${key}`, `scrypt:32768:64:1:${salt}:${key}`, `scrypt:32768:8:99:${salt}:${key}`, `scrypt:32768:8:1::${key}`, `scrypt:32768:8:1:${salt}:`, `bcrypt:32768:8:1:${salt}:${key}`, `scrypt:32768:8:1:${salt}:${key}:extra`];
    for (const h of bad) expect(await verifyPassphrase("a perfectly fine passphrase", h), String(h)).toBe(false);
    for (const p of [undefined, null, 42, "", "x".repeat(2000), {}]) expect(await verifyPassphrase(p, good)).toBe(false);
    await expect(hashPassphrase("too short")).rejects.toThrow(/at least 12/);
  });
});

describe("sessions", () => {
  it("a session cookie is ours only if we signed it, and only until it expires", () => {
    const { session, cookie } = issueSession(SECRET, NOW);
    expect(readSession(SECRET, cookie, NOW + 1000)).toEqual(session);
    expect(session.expiresAt - session.issuedAt).toBe(SESSION_TTL_MS);
    expect(readSession(SECRET, cookie, NOW + SESSION_TTL_MS)).toBeNull();
    expect(readSession("another-secret-0123456789abcdef0123456789", cookie, NOW)).toBeNull();
    // any change to the payload or the signature is refused
    const [v, payload, sig] = cookie.split(".") as [string, string, string];
    const forged = Buffer.from(JSON.stringify({ v: 1, sid: session.sid, iat: NOW, exp: NOW + 10 * SESSION_TTL_MS })).toString("base64url");
    expect(readSession(SECRET, `${v}.${forged}.${sig}`, NOW)).toBeNull();
    expect(readSession(SECRET, `${v}.${payload}.${sig.slice(0, -2)}AA`, NOW)).toBeNull();
    expect(readSession(SECRET, `v2.${payload}.${sig}`, NOW)).toBeNull();
    for (const junk of [undefined, null, "", "a.b", "v1..", "v1.%%%.%%%", "x".repeat(5000)]) expect(readSession(SECRET, junk, NOW)).toBeNull();
    // two sign-ins are two sessions
    expect(issueSession(SECRET, NOW).session.sid).not.toBe(session.sid);
  });

  it("the anti-forgery token belongs to one session and cannot be guessed from another", () => {
    const a = issueSession(SECRET, NOW).session;
    const b = issueSession(SECRET, NOW).session;
    const token = csrfToken(SECRET, a);
    expect(csrfMatches(SECRET, a, token)).toBe(true);
    expect(csrfMatches(SECRET, b, token)).toBe(false);
    expect(csrfMatches("another-secret-0123456789abcdef0123456789", a, token)).toBe(false);
    for (const junk of [null, undefined, "", "nope", a.sid, "x".repeat(500)]) expect(csrfMatches(SECRET, a, junk)).toBe(false);
  });

  it("the cookie is HttpOnly, SameSite=Strict, host-bound and Secure wherever HTTPS is used", () => {
    expect(sessionCookie("VALUE", true, 60)).toBe("__Host-tr_owner=VALUE; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=60");
    expect(sessionCookie("VALUE", false, 60)).toBe("tr_owner=VALUE; Path=/; HttpOnly; SameSite=Strict; Max-Age=60");
    expect(sessionCookie("", true, 0)).toContain("Max-Age=0");
    expect(readCookie("a=1; __Host-tr_owner=abc.def.ghi; b=2", cookieName(true))).toBe("abc.def.ghi");
    expect(readCookie("tr_owner=x", cookieName(true))).toBeNull();
    expect(readCookie(null, "x")).toBeNull();
  });
});

describe("the gate in front of every owner endpoint", () => {
  const { session, cookie } = issueSession(SECRET, NOW);
  const base = { host: "tabula.example", "x-forwarded-proto": "https" };
  const req = (headers: Record<string, string>, method = "POST") => new Request("https://tabula.example/api/owner/x", { method, headers: { ...base, ...headers } });
  const signedIn = { cookie: `__Host-tr_owner=${cookie}` };
  const withSecret = <T>(fn: () => T): T => {
    const saved = process.env.AUTH_SECRET;
    process.env.AUTH_SECRET = SECRET;
    try {
      return fn();
    } finally {
      if (saved === undefined) delete process.env.AUTH_SECRET;
      else process.env.AUTH_SECRET = saved;
    }
  };

  it("lets the owner's own page through and nobody else", async () => {
    const good = req({ ...signedIn, origin: "https://tabula.example", "sec-fetch-site": "same-origin", "x-csrf-token": csrfToken(SECRET, session) });
    expect(withSecret(() => requireOwner(good, true, NOW)).ok).toBe(true);
    const cases: [string, Record<string, string>, number, string][] = [
      ["no cookie", { origin: "https://tabula.example", "x-csrf-token": csrfToken(SECRET, session) }, 401, "not_signed_in"],
      ["another site's page", { ...signedIn, origin: "https://evil.example", "x-csrf-token": csrfToken(SECRET, session) }, 403, "cross_origin"],
      ["a cross-site fetch that spoofs nothing", { ...signedIn, origin: "https://tabula.example", "sec-fetch-site": "cross-site", "x-csrf-token": csrfToken(SECRET, session) }, 403, "cross_origin"],
      ["no Origin at all", { ...signedIn, "x-csrf-token": csrfToken(SECRET, session) }, 403, "cross_origin"],
      ["no token", { ...signedIn, origin: "https://tabula.example" }, 403, "bad_csrf_token"],
      ["another session's token", { ...signedIn, origin: "https://tabula.example", "x-csrf-token": csrfToken(SECRET, issueSession(SECRET, NOW).session) }, 403, "bad_csrf_token"],
      ["a forged cookie", { cookie: "__Host-tr_owner=v1.e30.AAAA", origin: "https://tabula.example", "x-csrf-token": "x" }, 401, "not_signed_in"],
      ["the dev cookie name on HTTPS", { cookie: `tr_owner=${cookie}`, origin: "https://tabula.example", "x-csrf-token": csrfToken(SECRET, session) }, 401, "not_signed_in"],
    ];
    for (const [name, headers, status, code] of cases) {
      const r = withSecret(() => requireOwner(req(headers), true, NOW));
      expect(r.ok, name).toBe(false);
      if (!r.ok) {
        expect(r.response.status, name).toBe(status);
        expect(((await r.response.json()) as { error: string }).error, name).toBe(code);
        expect(r.response.headers.get("cache-control")).toBe("no-store");
      }
    }
    // an expired session
    expect(withSecret(() => requireOwner(good, true, NOW + SESSION_TTL_MS + 1)).ok).toBe(false);
    // reading needs the session but not the token
    expect(withSecret(() => requireOwner(req(signedIn, "GET"), false, NOW)).ok).toBe(true);
    expect(withSecret(() => requireOwner(req({}, "GET"), false, NOW)).ok).toBe(false);
  });

  it("with no signing secret configured, nobody is the owner", () => {
    const saved = process.env.AUTH_SECRET;
    delete process.env.AUTH_SECRET;
    try {
      const good = req({ ...signedIn, origin: "https://tabula.example", "x-csrf-token": csrfToken(SECRET, session) });
      expect(requireOwner(good, true, NOW).ok).toBe(false);
      process.env.AUTH_SECRET = "short";
      expect(requireOwner(good, true, NOW).ok).toBe(false);
    } finally {
      if (saved === undefined) delete process.env.AUTH_SECRET;
      else process.env.AUTH_SECRET = saved;
    }
  });

  it("judges origin by the host the client addressed, behind a proxy or not", () => {
    const r = (url: string, headers: Record<string, string>) => new Request(url, { method: "POST", headers });
    expect(sameOrigin(r("http://localhost:3000/api/x", { host: "localhost:3000", origin: "http://localhost:3000" }))).toBe(true);
    expect(sameOrigin(r("http://internal:8080/api/x", { host: "internal:8080", "x-forwarded-host": "tabula.example", origin: "https://tabula.example" }))).toBe(true);
    expect(sameOrigin(r("http://internal:8080/api/x", { host: "internal:8080", "x-forwarded-host": "tabula.example", origin: "http://internal:8080" }))).toBe(false);
    expect(sameOrigin(r("https://tabula.example/api/x", { host: "tabula.example", origin: "https://tabula.example.evil.io" }))).toBe(false);
    expect(sameOrigin(r("https://tabula.example/api/x", { host: "tabula.example", origin: "null" }))).toBe(false);
    expect(isSecure(r("http://internal/api", { "x-forwarded-proto": "https" }))).toBe(true);
    expect(isSecure(r("http://localhost:3000/api", {}))).toBe(false);
    expect(clientKey(r("https://x/api", { "x-forwarded-for": "203.0.113.9, 10.0.0.1" }))).toBe("203.0.113.9");
    expect(clientKey(r("https://x/api", { "x-forwarded-for": "<script>alert(1)</script>" }))).toMatch(/^[0-9a-f:.]{1,64}$/); // only address characters survive
    expect(clientKey(r("https://x/api", {}))).toBe("unknown");
  });

  it("reads only JSON, and only so much of it", async () => {
    const post = (body: string, type = "application/json", extra: Record<string, string> = {}) => new Request("https://tabula.example/api/x", { method: "POST", headers: { "content-type": type, ...extra }, body });
    expect(await readJson(post('{"a":1}'))).toEqual({ a: 1 });
    const code = async (r: Request, max?: number) => {
      try {
        await readJson(r, max);
        return "ok";
      } catch (err) {
        return err instanceof BodyError ? `${err.status}:${err.code}` : "threw";
      }
    };
    expect(await code(post('{"a":1}', "text/plain"))).toBe("415:json_required");
    expect(await code(post("{not json"))).toBe("400:bad_json");
    expect(await code(post(JSON.stringify({ a: "x".repeat(5000) })), 1000)).toBe("413:too_large");
    // a body that lies about its length is still cut off
    const liar = new Request("https://tabula.example/api/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ a: "y".repeat(50_000) }) });
    expect(await code(liar, 2000)).toBe("413:too_large");
    expect(await code(new Request("https://tabula.example/api/x", { method: "POST", headers: { "content-type": "application/json" } }))).toBe("400:empty_body");
  });
});

describe("rate limiting, shared through the database", () => {
  let db: Db;
  beforeAll(async () => {
    db = await memoryDb();
  });
  afterAll(async () => {
    await db.close();
  });

  it("allows a fixed number of requests per window per key, then refuses until the window turns", async () => {
    const t0 = Date.parse("2026-12-01T10:00:05Z");
    for (let i = 0; i < 5; i++) expect((await rateLimit(db, "login:203.0.113.9", 5, 900, t0 + i)).ok).toBe(true);
    const refused = await rateLimit(db, "login:203.0.113.9", 5, 900, t0 + 10);
    expect(refused.ok).toBe(false);
    expect(refused.retryAfterSec).toBeGreaterThan(0);
    expect(refused.retryAfterSec).toBeLessThanOrEqual(900);
    // another client is not affected
    expect((await rateLimit(db, "login:198.51.100.7", 5, 900, t0 + 10)).ok).toBe(true);
    // the next window starts fresh
    expect((await rateLimit(db, "login:203.0.113.9", 5, 900, t0 + 900_000)).ok).toBe(true);
  });

  it("refuses when it cannot count", async () => {
    const dead = await memoryDb();
    await dead.close();
    expect((await rateLimit(dead, "k", 5, 60)).ok).toBe(false);
  });
});

describe("live mode is off unless everything it needs is in place", () => {
  const ready = { LIVE_ENABLED: "true", ANTHROPIC_API_KEY: "sk-ant-test", ANTHROPIC_MODEL: "claude-fable-5-2", DATABASE_URL: "postgres://x", OWNER_PASSWORD_HASH: "scrypt:32768:8:1:aaaa:bbbb", AUTH_SECRET: SECRET, NODE_ENV: "production" };
  const at = Date.parse("2026-12-01T00:00:00Z");

  it("is available only with the switch on, a key, a priced model, a database, owner sign-in and fresh prices", () => {
    expect(liveStatus(ready, at)).toMatchObject({ available: true, reasons: [], model: "claude-fable-5-2", keyConfigured: true, database: "postgres" });
    const without = (key: string) => liveStatus({ ...ready, [key]: undefined }, at);
    for (const key of ["LIVE_ENABLED", "ANTHROPIC_API_KEY", "ANTHROPIC_MODEL", "DATABASE_URL", "OWNER_PASSWORD_HASH", "AUTH_SECRET"]) {
      const s = without(key);
      expect(s.available, key).toBe(false);
      expect(s.reasons.length, key).toBeGreaterThan(0);
    }
    expect(liveStatus({}, at).available).toBe(false);
    expect(liveStatus({ ...ready, LIVE_ENABLED: "TRUE" }, at).available).toBe(false);
    expect(liveStatus({ ...ready, LIVE_ENABLED: "1" }, at).available).toBe(false);
    expect(liveStatus({ ...ready, ANTHROPIC_MODEL: "claude-made-up-9" }, at).reasons.join(" ")).toContain("no entry in the price table");
    expect(liveStatus({ ...ready, VERCEL_ENV: "preview" }, at).reasons.join(" ")).toContain("preview deployments run mock minds only");
    expect(liveStatus({ ...ready, VERCEL_ENV: "production" }, at).available).toBe(true);
    expect(liveStatus({ ...ready, AUTH_SECRET: "short" }, at).available).toBe(false);
    expect(ownerAuthConfigured({ OWNER_PASSWORD_HASH: "plaintext", AUTH_SECRET: SECRET })).toBe(false);
  });

  it("goes unavailable when the price table is stale, and says so without revealing anything else", () => {
    const later = Date.parse("2027-03-01T00:00:00Z");
    const s = liveStatus(ready, later);
    expect(s.available).toBe(false);
    expect(s.prices.stale).toBe(true);
    expect(s.reasons.join(" ")).toContain("price table");
    expect(liveStatus({ ...ready, PRICES_ATTESTED_ON: "2027-02-20" }, later).available).toBe(true);
    // the report never contains a secret value
    const text = JSON.stringify(liveStatus(ready, at)) + JSON.stringify(s);
    for (const secret of [ready.ANTHROPIC_API_KEY, ready.DATABASE_URL, ready.OWNER_PASSWORD_HASH, ready.AUTH_SECRET]) expect(text).not.toContain(secret);
  });
});
