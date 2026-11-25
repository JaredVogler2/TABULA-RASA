import { describe, expect, it } from "vitest";
import { selfTestDigest } from "./selftest";

/**
 * Cross-runtime determinism contract. The Playwright suite computes this digest in
 * Node and compares it with the browser main thread and a Web Worker, so a mismatch
 * there means that browser is not bit-compatible with the reference run.
 * The values below are pinned so that an accidental change to the RNG, hashing or
 * canonical encoding is caught immediately.
 */
describe("determinism self-test", () => {
  it("produces the pinned digest in Node", () => {
    const r = selfTestDigest(20261125, 20000);
    expect({ digest: r.digest, sha: r.sha }).toMatchInlineSnapshot(`
      {
        "digest": "143d0f5b09ed8b06",
        "sha": "b5ff2e7db145a7f731e5e6ad0e119aa0a759f8745a29e39df192a83630a06c1b",
      }
    `);
  });

  it("changes with the seed", () => {
    expect(selfTestDigest(1, 500).digest).not.toBe(selfTestDigest(2, 500).digest);
  });
});
