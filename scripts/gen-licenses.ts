/**
 * The licences of everything this project depends on, from what is installed.
 *
 *   pnpm gen:licenses           rewrite docs/THIRD_PARTY.md and public/licenses.txt
 *   pnpm gen:licenses --check   fail if either is out of date
 *
 * docs/THIRD_PARTY.md is the manifest: every package by licence, for what runs in production
 * and for what only builds and tests. public/licenses.txt is what a visitor can read: the
 * notice and licence text of each package whose code or files are sent to their browser (the
 * fonts' licence requires that it travel with them).
 *
 * Packages that exist once per operating system and processor (prebuilt binaries of SWC,
 * sharp, libvips, lightningcss, esbuild, rollup) are left out of the lists and named once,
 * so that the documents are the same wherever they are generated.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

interface Listed {
  name: string;
  versions: string[];
  paths: string[];
  license: string;
}

const MANIFEST = "docs/THIRD_PARTY.md";
const NOTICES = "public/licenses.txt";

/** Code or files from these reach the browser. The first group is bundled by name; the rest come with the framework. */
const IN_THE_BROWSER = ["next", "react", "react-dom", "scheduler", "three", "zustand", "lucide-react", "fflate", "@swc/helpers", "@fontsource-variable/fraunces", "@fontsource-variable/inter"];

/** Only ever loaded on the server (src/server, src/app/api). */
const ON_THE_SERVER = new Set(["@anthropic-ai/sdk", "pg", "server-only"]);

// (fsevents is installed only on macOS, and the three after it only where a prebuilt binary falls back to WebAssembly)
const PER_PLATFORM = /(^|[-/])(linux|linuxmusl|darwin|win32|freebsd|android|openbsd|netbsd|sunos|aix|wasm32)([-/]|$)|-(x64|arm64|arm|ia32|riscv64|s390x|ppc64|loong64)(-|$)|-(gnu|musl|msvc|gnueabihf|musleabihf)$|^fsevents$|^@emnapi\/|^@napi-rs\/wasm-runtime$|^@tybys\/wasm-util$/;

function listed(prod: boolean): Listed[] {
  const raw = execFileSync("pnpm", ["licenses", "list", "--json", ...(prod ? ["--prod"] : [])], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const byLicence = JSON.parse(raw) as Record<string, Listed[]>;
  const out: Listed[] = [];
  for (const [license, pkgs] of Object.entries(byLicence)) for (const p of pkgs) out.push({ name: p.name, versions: [...p.versions].sort(), paths: p.paths, license });
  return out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

function licenceText(pkg: Listed): string {
  for (const dir of pkg.paths) for (const file of ["LICENSE", "LICENSE.md", "LICENSE.txt", "license", "license.md", "LICENCE"]) if (existsSync(join(dir, file))) return readFileSync(join(dir, file), "utf8").replace(/\r\n/g, "\n").trim();
  throw new Error(`no licence file found for ${pkg.name}: add it to the notices by hand`);
}

function byLicence(pkgs: Listed[]): [string, Listed[]][] {
  const groups = new Map<string, Listed[]>();
  for (const p of pkgs) groups.set(p.license, [...(groups.get(p.license) ?? []), p]);
  return [...groups.entries()].sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1));
}

function render(): { manifest: string; notices: string } {
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { dependencies: Record<string, string>; devDependencies: Record<string, string>; license?: string };
  const everything = listed(false);
  const production = listed(true);
  const portable = (list: Listed[]): Listed[] => list.filter((p) => !PER_PLATFORM.test(p.name));
  const perPlatform = everything.filter((p) => PER_PLATFORM.test(p.name));
  const find = (name: string): Listed => {
    const hit = everything.find((p) => p.name === name);
    if (!hit) throw new Error(`${name} is not installed`);
    return hit;
  };
  const prodNames = new Set(portable(production).map((p) => p.name));
  const devOnly = portable(everything).filter((p) => !prodNames.has(p.name));
  const where = (name: string): string => (ON_THE_SERVER.has(name) ? "server only" : IN_THE_BROWSER.includes(name) ? "browser (and the server that renders the pages)" : "server and build");
  const row = (name: string): string => {
    const p = find(name);
    return `| \`${name}\` | ${p.versions.join(", ")} | ${p.license} | ${where(name)} |`;
  };
  const group = ([licence, list]: [string, Listed[]]): string => `- **${licence}** (${list.length}): ${list.map((p) => `\`${p.name}\``).join(", ")}`;
  const platformLicences = byLicence(perPlatform).map(([licence, list]) => `${licence} (${[...new Set(list.map((p) => p.name.replace(/^@img\/sharp-libvips-.*/, "libvips").replace(/^@img\/sharp-.*/, "sharp").replace(/^@next\/swc-.*/, "@next/swc").replace(/^lightningcss-.*/, "lightningcss").replace(/^@esbuild\/.*/, "esbuild").replace(/^@rollup\/rollup-.*/, "rollup").replace(/^@rolldown\/binding-.*/, "rolldown").replace(/^@oxc-[a-z]+\/binding-.*/, "oxc").replace(/^@unrs\/resolver-binding-.*/, "unrs-resolver")))].sort().join(", ")})`);

  const manifest = [
    "# Third-party software and fonts",
    "",
    "Generated by `pnpm gen:licenses` from what the lockfile installs. Do not edit by hand; CI fails if this",
    "file is out of date (`pnpm gen:licenses --check`). Licences are those each package declares; nobody has",
    "read every package's files to confirm them.",
    "",
    `This project's own licence field is \`${pkg.license ?? "(none)"}\`: the owner has not chosen a licence for it.`,
    "",
    "## What the application itself depends on",
    "",
    "| Package | Version | Licence | Where it runs |",
    "|---|---|---|---|",
    ...Object.keys(pkg.dependencies).sort().map(row),
    "",
    "The notice and licence text of every package whose code or files are sent to a visitor's browser is",
    "served with the application at `/licenses.txt` and linked from the game's menu. The two typefaces",
    "(Fraunces and Inter) are under the SIL Open Font License 1.1, which asks that its text travel with the",
    "fonts; that file is how it does. The framework also carries compiled code of its own dependencies",
    "inside its package (`next/dist/compiled`), each with a licence file of its own there; those are not",
    "reproduced in `/licenses.txt`.",
    "",
    "## Everything installed for production, by licence",
    "",
    `${portable(production).length} packages (the direct dependencies above and what they bring with them).`,
    "",
    ...byLicence(portable(production)).map(group),
    "",
    "## Installed only to build and test, by licence",
    "",
    `${devOnly.length} packages. None of them is deployed.`,
    "",
    ...byLicence(devOnly).map(group),
    "",
    "## Prebuilt binaries",
    "",
    "Some packages are installed once per operating system and processor and are left out of the lists above",
    "so that this file is the same wherever it is generated. By licence: " + platformLicences.join("; ") + ".",
    "They run on the build machine and the server and are never sent to a browser. libvips (LGPL-3.0-or-later)",
    "comes with the framework's image optimizer, which this application does not use.",
    "",
    "## Things worth knowing",
    "",
    "- **MPL-2.0** packages (`axe-core`, `@axe-core/playwright`, `lightningcss`) are tools: the first two test",
    "  accessibility, the third processes stylesheets at build time. None is modified and none is deployed as source.",
    "- **CC-BY-4.0** is `caniuse-lite`, browser-support data read at build time.",
    "- `pnpm audit` is run at release; its output for this commit is in `evidence/phase-16/dependencies.txt`.",
    "",
  ].join("\n");

  const rule = "=".repeat(78);
  const notices = [
    "TABULA RASA: open-source software and fonts sent to your browser",
    "",
    "The application is built with the packages below. Each is the work of its authors and is",
    "used under the licence reproduced with it. A manifest of everything the project depends",
    "on, including what runs only on the server or only at build time, is in the repository",
    "(docs/THIRD_PARTY.md).",
    "",
    ...IN_THE_BROWSER.flatMap((name) => {
      const p = find(name);
      return [rule, `${name} ${p.versions.join(", ")} (${p.license})`, rule, "", licenceText(p), ""];
    }),
  ].join("\n");
  return { manifest, notices: notices.endsWith("\n") ? notices : notices + "\n" };
}

const { manifest, notices } = render();
if (process.argv.includes("--check")) {
  const stale = [
    [MANIFEST, manifest],
    [NOTICES, notices],
  ].filter(([file, text]) => !existsSync(file as string) || readFileSync(file as string, "utf8") !== text);
  if (stale.length) {
    console.error(`${stale.map(([file]) => file).join(" and ")} ${stale.length > 1 ? "are" : "is"} out of date. Run \`pnpm gen:licenses\`.`);
    process.exit(1);
  }
  console.log(`${MANIFEST} and ${NOTICES} are up to date.`);
} else {
  writeFileSync(MANIFEST, manifest);
  writeFileSync(NOTICES, notices);
  console.log(`wrote ${MANIFEST} (${manifest.length} characters) and ${NOTICES} (${notices.length} characters)`);
}
