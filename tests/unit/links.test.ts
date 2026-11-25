import { describe, expect, it } from "vitest";
import { deadReferences } from "../../scripts/check-links";

/**
 * The documents cite files as their evidence. This holds the checker that keeps a document from
 * outliving what it cites (`pnpm check:links`, part of `pnpm check`).
 */
describe("references in the documents", () => {
  it("a link or a cited path that exists is passed; one that does not is named with its line", () => {
    const text = ["See [the cost sheet](./COST.md#prices) and `src/server/db.ts`.", "", "The run is in `evidence/phase-00/nothing.txt`, and [here](missing.md)."].join("\n");
    expect(deadReferences("docs/EXAMPLE.md", text)).toEqual(["docs/EXAMPLE.md:3: link to missing.md", "docs/EXAMPLE.md:3: `evidence/phase-00/nothing.txt`"]);
  });

  it("reads the documents' shorthand for several files: braces and stars, a trailing line number, a trailing full stop", () => {
    const ok = ["`evidence/phase-15/load.{txt,json}`", "`evidence/phase-16/review-*.md`", "`src/server/db.ts:46`", "`src/server/db.ts:40-52`", "`tests/unit/scans.test.ts`.", "`src/engine/**`"].join(" ");
    expect(deadReferences("docs/EXAMPLE.md", ok)).toEqual([]);
    expect(deadReferences("docs/EXAMPLE.md", "`evidence/phase-15/load.{txt,nope}`")).toEqual(["docs/EXAMPLE.md:1: `evidence/phase-15/load.nope`"]);
    expect(deadReferences("docs/EXAMPLE.md", "`evidence/phase-16/nothing-*.md`")).toEqual(["docs/EXAMPLE.md:1: `evidence/phase-16/nothing-*.md`"]);
  });

  it("does not take for a path what is not one: other sites, commands in fences, patterns for the reader to fill in, names with no root", () => {
    const text = ["[the docs](https://example.com/docs/x.md) and `load.txt` and `evidence/<dir>/x.txt` and `src/…/y.ts`", "```bash", "cat evidence/phase-00/nothing.txt `docs/NOPE.md`", "```"].join("\n");
    expect(deadReferences("docs/EXAMPLE.md", text)).toEqual([]);
  });
});
