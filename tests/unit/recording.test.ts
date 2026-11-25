import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ENGINE_VERSION, createWorld, validateConfig, type DecisionRecord, type WorldConfig } from "../../src/engine";
import { PROMPT_VERSION } from "../../src/providers/prompt";
import { verifyTape } from "../../src/providers/run";

/**
 * The bundled recording is a golden fixture: a world's configuration, the decisions that were
 * made in it, and the digest of its state at the end of each of its 24 epochs. If this engine
 * no longer arrives at those digests from those decisions, either the engine's behaviour has
 * changed (and its version must, and the recording must be made again: `pnpm record`) or the
 * file has been altered. The browser tests replay it too; this is the same check without a browser.
 */
interface Recording {
  format: string;
  version: number;
  id: string;
  provider: string;
  promptVersion: string;
  config: WorldConfig;
  epochs: { epoch: number; toTick: number; digest: string }[];
  tape: DecisionRecord[];
}

const recording = JSON.parse(readFileSync("public/recordings/mock-first-light.json", "utf8")) as Recording;

describe("the bundled recording is reproduced by this engine", () => {
  it("is what it says it is: a recording of mock minds, made with this prompt version, of a valid world", () => {
    expect(recording.format).toBe("tabula-rasa/recording");
    expect(recording.provider).toBe("mock");
    expect(recording.promptVersion).toBe(PROMPT_VERSION);
    expect(() => validateConfig(recording.config)).not.toThrow();
    expect(recording.epochs).toHaveLength(24);
    expect(recording.tape.length).toBeGreaterThan(100);
    expect(typeof ENGINE_VERSION).toBe("string");
  });

  it("every epoch's digest is reached from the recorded decisions, with no mind consulted", () => {
    expect(verifyTape(createWorld(recording.config), recording.tape, recording.epochs)).toBe(-1);
  });

  it("and it is the decisions that carry it there: one of them changed, and the digests are no longer reached", () => {
    // a recorded decision replaced by doing nothing: the world that follows is another world
    const changed = recording.tape.map((r, i) => (i === 40 ? { ...r, intents: [] } : r));
    const firstWrong = verifyTape(createWorld(recording.config), changed as DecisionRecord[], recording.epochs);
    expect(firstWrong).toBeGreaterThanOrEqual(0);
  });
});
