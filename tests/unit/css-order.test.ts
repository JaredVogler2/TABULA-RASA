/**
 * A responsive override only works if it comes after the rule it overrides: two rules with
 * the same selector have the same specificity, so the later one wins whatever its media query
 * says. A phone-only rule written above its base rule is silently dead — the Atlas shipped two
 * columns to a 390-pixel screen that way. This reads every stylesheet and fails on any
 * media-query declaration that a later, unconditional rule for the same selector sets again.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

interface Rule {
  selector: string;
  line: number;
  media: string | null;
  properties: string[];
}

function stylesheets(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) stylesheets(path, out);
    else if (name.endsWith(".css")) out.push(path);
  }
  return out;
}

/** A small reader for the CSS this project writes: rules, one level of @media/@supports, no nesting. */
export function rulesOf(css: string): Rule[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  const rules: Rule[] = [];
  let i = 0;
  let line = 1;
  let media: string | null = null;
  let prelude = "";
  let preludeLine = 1;
  const n = text.length;
  while (i < n) {
    const ch = text[i] as string;
    if (ch === "\n") line++;
    if (ch === "{") {
      const head = prelude.trim();
      if (head.startsWith("@media") || head.startsWith("@supports") || head.startsWith("@container")) {
        media = head;
        prelude = "";
        i++;
        continue;
      }
      // a declaration block (or an at-rule body such as @keyframes / @font-face, which is skipped whole)
      let depth = 1;
      let j = i + 1;
      let body = "";
      while (j < n && depth > 0) {
        const c = text[j] as string;
        if (c === "{") depth++;
        else if (c === "}") depth--;
        if (depth > 0) body += c;
        if (c === "\n") line++;
        j++;
      }
      if (!head.startsWith("@")) {
        const properties = body
          .split(";")
          .map((d) => d.split(":")[0]?.trim() ?? "")
          .filter((p) => p !== "" && !p.startsWith("--"));
        for (const selector of head.split(",").map((s) => s.trim().replace(/\s+/g, " ")).filter(Boolean)) rules.push({ selector, line: preludeLine, media, properties });
      }
      prelude = "";
      i = j;
      continue;
    }
    if (ch === "}") {
      media = null;
      prelude = "";
      i++;
      continue;
    }
    if (prelude.trim() === "" && ch.trim() !== "") preludeLine = line;
    prelude += ch;
    i++;
  }
  return rules;
}

export function deadOverrides(css: string): string[] {
  const rules = rulesOf(css);
  const dead: string[] = [];
  for (const r of rules) {
    if (!r.media) continue;
    for (const later of rules) {
      if (later.media || later.selector !== r.selector || later.line <= r.line) continue;
      const again = r.properties.filter((p) => later.properties.includes(p));
      if (again.length) dead.push(`${r.selector} { ${again.join(", ")} } inside ${r.media} (line ${r.line}) is overridden by the unconditional rule on line ${later.line}`);
    }
  }
  return dead;
}

describe("stylesheets: responsive rules come after the rules they override", () => {
  it("the reader finds rules, their media queries and their properties", () => {
    const rules = rulesOf(`.a { color: red; --x: 1; }\n@media (max-width: 500px) {\n  .a,\n  .b > i { color: blue; margin: 0 }\n}\n@keyframes spin { from { color: red } to { color: blue } }\n.c { top: 0 }`);
    expect(rules).toEqual([
      { selector: ".a", line: 1, media: null, properties: ["color"] },
      { selector: ".a", line: 3, media: "@media (max-width: 500px)", properties: ["color", "margin"] },
      { selector: ".b > i", line: 3, media: "@media (max-width: 500px)", properties: ["color", "margin"] },
      { selector: ".c", line: 7, media: null, properties: ["top"] },
    ]);
  });

  it("flags an override written above its base rule, and only then", () => {
    const wrong = `@media (max-width: 500px) { .grid { grid-template-columns: 1fr; } }\n.grid { display: grid; grid-template-columns: 1fr 1fr; }`;
    const right = `.grid { display: grid; grid-template-columns: 1fr 1fr; }\n@media (max-width: 500px) { .grid { grid-template-columns: 1fr; } }`;
    const unrelated = `@media (max-width: 500px) { .grid { gap: 4px; } }\n.grid { display: grid; }`;
    expect(deadOverrides(wrong)).toHaveLength(1);
    expect(deadOverrides(wrong)[0]).toContain("grid-template-columns");
    expect(deadOverrides(right)).toEqual([]);
    expect(deadOverrides(unrelated)).toEqual([]);
  });

  it("no stylesheet in the application has one", () => {
    const files = stylesheets(join(process.cwd(), "src"));
    expect(files.length).toBeGreaterThan(1);
    const found = files.flatMap((f) => deadOverrides(readFileSync(f, "utf8")).map((d) => `${f.replace(`${process.cwd()}/`, "")}: ${d}`));
    expect(found, found.join("\n")).toEqual([]);
  });
});
