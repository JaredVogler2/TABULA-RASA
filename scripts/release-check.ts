/**
 * Is a running site what a release should be? Everything a release has to show, asked of the
 * site itself — a deployment's address, or a local `next start`.
 *
 *   pnpm release:check -- https://SITE                       the game alone (level 1 of docs/DEPLOYMENT.md)
 *   pnpm release:check -- https://SITE --level 2             …with the owner's console configured
 *   pnpm release:check -- http://127.0.0.1:3299 --fast --out evidence/phase-18/local
 *
 * It signs in nowhere, sends no secret and changes nothing on the server: it asks what a
 * stranger can ask, and then plays the game the way a visitor would, in a real browser, once in
 * a desktop window and once as a phone. What it checks:
 *
 *   - the health line, and that it tells nothing of configuration; that the engine served is
 *     the engine of this checkout
 *   - the security headers
 *   - that a stranger is refused by every route that could cost money or change anything, and
 *     that a request from another origin is refused whatever it carries
 *   - the public files a release ships (the bundled recording, the studies, the licences)
 *   - in the browser: a world is made, a day passes, the Chronicle has lines, a save survives a
 *     reload; the bundled recording replays to its end and matches its record; the laboratory
 *     and the owner's door draw; nothing is asked of any other origin; no page error; and
 *     nothing the browser was sent contains what belongs only on the server (the same rules as
 *     `pnpm scan:bundle`, applied to what the site actually served)
 *
 * `--fast` asks the game for its simplest picture, for machines without a graphics chip;
 * `--quick` leaves out the replay of the recording (a minute or more). Exit code 0 only if
 * every check passed.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { AFFORDANCE_VERSION, ENGINE_VERSION, SCHEMA_VERSION } from "../src/engine/version";
import { bundleFindings } from "./scan-bundle";

const args = process.argv.slice(2).filter((a) => a !== "--");
const flag = (name: string): boolean => args.includes(`--${name}`);
const option = (name: string, fallback: string): string => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? (args[i + 1] as string) : fallback;
};
const base = (args.find((a) => /^https?:\/\//.test(a)) ?? "").replace(/\/+$/, "");
if (!base) {
  console.error("usage: pnpm release:check -- <https://site> [--level 1|2] [--fast] [--quick] [--out <dir>]");
  process.exit(2);
}
const level = Number(option("level", "1"));
const out = option("out", "");
const fast = flag("fast");
const quick = flag("quick");
const origin = new URL(base).origin;
const secure = base.startsWith("https://");
if (out) mkdirSync(out, { recursive: true });

interface Result {
  name: string;
  ok: boolean;
  detail: string;
}
const results: Result[] = [];

function need(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function check(name: string, run: () => Promise<string>): Promise<boolean> {
  let result: Result;
  try {
    result = { name, ok: true, detail: await run() };
  } catch (err) {
    result = { name, ok: false, detail: (err instanceof Error ? err.message : String(err)).split("\n")[0] ?? "failed" };
  }
  results.push(result);
  console.log(`${result.ok ? "ok  " : "FAIL"}  ${name}${result.detail ? ` — ${result.detail}` : ""}`);
  return result.ok;
}

const get = (path: string, init?: RequestInit): Promise<Response> => fetch(base + path, { redirect: "manual", ...init });
const post = (path: string, from: string = origin): Promise<Response> => get(path, { method: "POST", headers: { "content-type": "application/json", origin: from }, body: "{}" });

// ───────────────────────── what a stranger can ask, without a browser

async function overHttp(): Promise<void> {
  await check("health: the service answers, and says nothing of how it is configured", async () => {
    const r = await get("/api/health");
    need(r.status === 200, `status ${r.status}`);
    const body = (await r.json()) as Record<string, unknown>;
    need(JSON.stringify(Object.keys(body).sort()) === JSON.stringify(["affordances", "engine", "ok", "schema", "service"]), `unexpected fields: ${Object.keys(body).join(", ")}`);
    need(body.ok === true && body.service === "tabula-rasa", "not this service");
    need(body.engine === ENGINE_VERSION && body.schema === SCHEMA_VERSION && body.affordances === AFFORDANCE_VERSION, `the site serves engine ${String(body.engine)}, schema ${String(body.schema)}, affordances ${String(body.affordances)}; this checkout is ${ENGINE_VERSION}, ${SCHEMA_VERSION}, ${AFFORDANCE_VERSION}`);
    return `engine ${ENGINE_VERSION}, schema ${SCHEMA_VERSION}, affordances ${AFFORDANCE_VERSION}: the same as this checkout`;
  });

  await check("security headers on the game's page", async () => {
    const r = await get("/");
    need(r.status === 200, `status ${r.status}`);
    const h = r.headers;
    const csp = h.get("content-security-policy") ?? "";
    for (const part of ["default-src 'self'", "connect-src 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'"]) need(csp.includes(part), `the policy lacks ${part}`);
    need(!/https?:\/\//.test(csp), "the policy names another origin");
    need(h.get("x-frame-options") === "DENY", "X-Frame-Options is not DENY");
    need(h.get("x-content-type-options") === "nosniff", "X-Content-Type-Options is not nosniff");
    need((h.get("referrer-policy") ?? "") !== "", "no Referrer-Policy");
    need((h.get("permissions-policy") ?? "").includes("camera=()"), "no Permissions-Policy");
    need(h.get("cross-origin-opener-policy") === "same-origin", "no Cross-Origin-Opener-Policy");
    need(h.get("x-powered-by") === null, "X-Powered-By is sent");
    if (secure) need((h.get("strict-transport-security") ?? "").includes("max-age="), "no Strict-Transport-Security on an https site");
    return secure ? "policy, framing, sniffing, referrer, permissions, opener and transport security" : "policy, framing, sniffing, referrer, permissions, opener (no transport security expected over http)";
  });

  await check("answers from the API are never stored by anything in between", async () => {
    for (const path of ["/api/health", "/api/owner/status", "/api/recordings"]) {
      const r = await get(path);
      need((r.headers.get("cache-control") ?? "").includes("no-store"), `${path} is sent without no-store`);
    }
    return "Cache-Control: no-store";
  });

  await check("a stranger is refused by everything that could spend or change", async () => {
    const routes = ["/api/runs", "/api/runs/preview", "/api/runs/x/step", "/api/runs/x/control", "/api/owner/budget", "/api/owner/kill", "/api/owner/reconcile"];
    for (const path of routes) {
      const r = await post(path);
      const text = await r.text();
      need(r.status === 401, `POST ${path} answered ${r.status}`);
      need(text.includes("not_signed_in"), `POST ${path} did not say why`);
    }
    const unknown = await get("/api/runs/no-such-run");
    need(unknown.status === 404, `a run that does not exist answered ${unknown.status}`);
    return `${routes.length} routes answer 401; a run that is not published is not found`;
  });

  await check("a request from another origin is refused whatever it carries", async () => {
    for (const path of ["/api/runs", "/api/owner/login", "/api/owner/budget", "/api/owner/kill"]) {
      const r = await post(path, "https://elsewhere.example");
      need(r.status === 403, `POST ${path} from another origin answered ${r.status}`);
    }
    return "403";
  });

  await check(level >= 2 ? "the owner's door: sign-in is possible, and nothing else is told" : "the owner's door: not configured, and it says so", async () => {
    const r = await get("/api/owner/status");
    need(r.status === 200, `status ${r.status}`);
    const body = (await r.json()) as Record<string, unknown>;
    need(JSON.stringify(Object.keys(body).sort()) === JSON.stringify(["signInPossible", "signedIn"]), `a stranger is told: ${Object.keys(body).join(", ")}`);
    need(body.signedIn === false, "a stranger is signed in");
    need(body.signInPossible === level >= 2, level >= 2 ? "sign-in is not configured (OWNER_PASSWORD_HASH and AUTH_SECRET)" : "sign-in is configured: run this with --level 2");
    if (level < 2) {
      const tried = await post("/api/owner/login");
      need(tried.status === 503, `signing in answered ${tried.status}`);
    }
    return level >= 2 ? "signInPossible: true (no sign-in was attempted)" : "signInPossible: false; an attempt answers 503";
  });

  await check("the public list of recordings", async () => {
    const r = await get("/api/recordings");
    need(r.status === 200, `status ${r.status}`);
    const body = (await r.json()) as { ok?: boolean; recordings?: unknown[] };
    need(body.ok === true && Array.isArray(body.recordings), "not a list");
    return `${body.recordings.length} published by the owner`;
  });

  await check("the files a release ships", async () => {
    const index = await get("/recordings/index.json");
    need(index.status === 200, `/recordings/index.json answered ${index.status}`);
    const listed = (await index.json()) as { id: string }[];
    need(listed.some((entry) => entry.id === "mock-first-light"), "the bundled recording is not listed");
    const tape = await get("/recordings/mock-first-light.json");
    need(tape.status === 200, `the bundled recording answered ${tape.status}`);
    const bytes = (await tape.arrayBuffer()).byteLength;
    const studies = await get("/studies/index.json");
    need(studies.status === 200, `/studies/index.json answered ${studies.status}`);
    const licences = await get("/licenses.txt");
    need(licences.status === 200 && (await licences.text()).length > 1000, "the licence list is missing");
    return `the bundled recording (${Math.round(bytes / 1024)} KB), the studies, the licences`;
  });
}

// ───────────────────────── what a visitor does, in a browser

interface Watch {
  errors: string[];
  elsewhere: Set<string>;
  findings: string[];
  scanned: number;
  pending: Promise<void>[];
}

function watch(page: Page): Watch {
  const w: Watch = { errors: [], elsewhere: new Set(), findings: [], scanned: 0, pending: [] };
  page.on("pageerror", (err) => w.errors.push(String(err).slice(0, 200)));
  page.on("request", (request) => {
    const url = request.url();
    if (url.startsWith("data:") || url.startsWith("blob:")) return;
    if (new URL(url).origin !== origin) w.elsewhere.add(new URL(url).origin);
  });
  page.on("response", (response) => {
    const url = response.url();
    if (!url.startsWith(origin)) return;
    const type = response.headers()["content-type"] ?? "";
    if (!/javascript|css|html|json|text\/plain|x-component/.test(type)) return;
    w.pending.push(
      response
        .text()
        .then((text) => {
          w.scanned++;
          w.findings.push(...bundleFindings(new URL(url).pathname, text));
        })
        .catch(() => undefined),
    );
  });
  return w;
}

const tickOf = async (page: Page): Promise<number> => Number(((await page.getByTestId("tick").textContent()) ?? "").replace(/\D+/g, ""));

async function visit(browser: Browser, kind: "desktop" | "phone"): Promise<void> {
  const context: BrowserContext = await browser.newContext(
    kind === "phone" ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: fast ? 1 : 3, isMobile: true, hasTouch: true } : { viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1 },
  );
  const page = await context.newPage();
  const w = watch(page);
  const press = (target: Locator): Promise<void> => (kind === "phone" ? target.tap() : target.click());
  const home = fast ? "/?q=low&pr=0.5" : "/";
  const shot = async (name: string): Promise<void> => {
    if (out) await page.screenshot({ path: join(out, `${kind}-${name}.jpg`), type: "jpeg", quality: 80 });
  };

  let alive = await check(`${kind}: the title screen draws`, async () => {
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    let transferred = 0;
    cdp.on("Network.loadingFinished", (e) => (transferred += e.encodedDataLength));
    await page.goto(base + home, { waitUntil: "networkidle", timeout: 120_000 });
    await page.getByTestId("title").waitFor({ state: "visible", timeout: 60_000 });
    await shot("1-title");
    return `${(transferred / 1024).toFixed(0)} KB over the network for a first visit`;
  });

  alive =
    alive &&
    (await check(`${kind}: a world is made and a day passes`, async () => {
      await press(page.getByTestId("begin"));
      await press(page.getByTestId("scenario-first_light"));
      await page.getByTestId("seed-input").fill("7");
      await press(page.getByTestId("create-world"));
      await page.getByTestId("world-label").waitFor({ state: "attached", timeout: 120_000 });
      await page.waitForFunction(() => /seed 7$/.test(document.querySelector('[data-testid="world-label"]')?.textContent ?? ""), null, { timeout: 120_000 });
      if ((await page.getByTestId("coach-skip").count()) > 0) await press(page.getByTestId("coach-skip"));
      await press(page.getByTestId("speed-5"));
      await press(page.getByTestId("play-toggle"));
      await page.waitForFunction(() => Number((document.querySelector('[data-testid="tick"]')?.textContent ?? "").replace(/\D+/g, "")) > 100, null, { timeout: 300_000 });
      await press(page.getByTestId("play-toggle"));
      await page.waitForFunction(() => document.querySelector('[data-testid="play-toggle"]')?.getAttribute("data-playing") === "false", null, { timeout: 60_000 });
      // (how far it got depends on the machine: on a slow one the world runs on while the click that pauses it waits its turn)
      const day = Number(/Day\s*(\d+)/.exec((await page.getByTestId("stat-date").textContent()) ?? "")?.[1] ?? "0");
      need(day >= 2, `the date reads day ${day}`);
      await shot("2-world");
      return `day ${day}, tick ${await tickOf(page)}`;
    }));

  if (alive) {
    await check(`${kind}: the Chronicle has lines the engine logged`, async () => {
      await press(page.getByTestId("open-chronicle"));
      await page.getByTestId("chronicle").waitFor({ state: "visible", timeout: 30_000 });
      const lines = await page.getByTestId("chronicle-entries").locator("li").count();
      need(lines > 0, "no lines");
      await shot("3-chronicle");
      await press(page.getByTestId("chronicle-close"));
      return `${lines} lines`;
    });

    await check(`${kind}: a save survives a reload, to the tick`, async () => {
      const saved = await tickOf(page);
      await press(page.getByTestId("open-menu"));
      await press(page.getByTestId("save-game"));
      await page.getByTestId("toast").filter({ hasText: "Saved" }).waitFor({ state: "visible", timeout: 60_000 });
      const said = ((await page.getByTestId("toast").textContent()) ?? "").trim();
      await page.reload({ timeout: 120_000 });
      await page.getByTestId("title").waitFor({ state: "visible", timeout: 60_000 });
      await press(page.getByTestId("continue"));
      await page.waitForFunction(() => /seed 7$/.test(document.querySelector('[data-testid="world-label"]')?.textContent ?? ""), null, { timeout: 120_000 });
      await page.waitForFunction((t) => Number((document.querySelector('[data-testid="tick"]')?.textContent ?? "").replace(/\D+/g, "")) === t, saved, { timeout: 60_000 });
      return `${said} Resumed at tick ${saved}`;
    });
  }

  if (kind === "desktop" && !quick) {
    await check("desktop: the bundled recording replays to its end and matches its record, with nobody consulted", async () => {
      await page.goto(base + home, { timeout: 120_000 });
      await press(page.getByTestId("title-recordings"));
      await press(page.getByTestId("recording-mock-first-light"));
      await page.getByTestId("recording-badge").waitFor({ state: "visible", timeout: 120_000 });
      const badge = ((await page.getByTestId("recording-badge").textContent()) ?? "").replace(/\s+/g, " ").trim();
      await press(page.getByTestId("speed-5"));
      await page.waitForFunction(() => (document.querySelector('[data-testid="recording-state"]')?.textContent ?? "").startsWith("ended:"), null, { timeout: 420_000 });
      const state = ((await page.getByTestId("recording-state").textContent()) ?? "").trim();
      need(state === "ended: all 6 days matched the record", `the recording says "${state}"`);
      await shot("4-recording");
      return `${state} (${badge.slice(0, 90)})`;
    });
  }

  if (kind === "desktop") {
    await check("desktop: the laboratory draws its studies", async () => {
      await page.goto(`${base}/lab`, { timeout: 120_000 });
      await page.locator('[data-testid^="study-"]').first().waitFor({ state: "visible", timeout: 60_000 });
      const studies = await page.locator('[data-testid^="study-"]').count();
      await shot("5-lab");
      return `${studies} studies`;
    });

    await check(level >= 2 ? "desktop: the owner's door asks for a passphrase" : "desktop: the owner's door says it is not configured", async () => {
      await page.goto(`${base}/owner`, { timeout: 120_000 });
      await page.getByTestId(level >= 2 ? "passphrase" : "signin-unavailable").waitFor({ state: "visible", timeout: 60_000 });
      await shot("6-owner");
      return level >= 2 ? "nothing was typed into it" : "";
    });
  }

  await Promise.all(w.pending);
  await check(`${kind}: nothing was asked of any other origin`, async () => {
    need(w.elsewhere.size === 0, `requests went to ${[...w.elsewhere].join(", ")}`);
    return "";
  });
  await check(`${kind}: no page error`, async () => {
    need(w.errors.length === 0, w.errors.join(" | "));
    return "";
  });
  await check(`${kind}: nothing the browser was sent belongs only on the server`, async () => {
    need(w.findings.length === 0, w.findings.slice(0, 3).join(" | "));
    return `${w.scanned} responses read`;
  });
  await context.close();
}

async function main(): Promise<number> {
  console.log(`release check — ${base} — level ${level}${fast ? ", simplest picture" : ""}${quick ? ", without the recording" : ""}\n`);
  await overHttp();
  const browser = await chromium.launch();
  try {
    await visit(browser, "desktop");
    await visit(browser, "phone");
  } finally {
    await browser.close();
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length} of ${results.length} checks passed${failed.length ? `; FAILED: ${failed.map((f) => f.name).join("; ")}` : ""}.`);
  console.log("Not checked by this: the signed-in console (docs/DEPLOYMENT.md §8 has the steps), a real phone, any browser but Chromium.");
  if (out) writeFileSync(join(out, "release-check.json"), `${JSON.stringify({ base, level, fast, quick, at: new Date().toISOString(), results }, null, 2)}\n`);
  return failed.length ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    console.error(`release check could not run: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
