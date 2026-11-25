import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Text contrast, computed from the design tokens.
 *
 * The automated accessibility scan cannot measure contrast over the game's textured paper
 * and its translucent "glass" controls, so the pairs are computed here instead, with the
 * glass composited over the brightest thing it can sit on (snow) and the darkest (night).
 * WCAG 2.1 AA: 4.5:1 for body text, 3:1 for large or bold display text and for the
 * outlines of controls.
 */
const css = readFileSync("src/app/globals.css", "utf8");

function token(name: string): string {
  const m = new RegExp(`--${name}:\\s*([^;]+);`).exec(css);
  if (!m) throw new Error(`no token --${name}`);
  const value = (m[1] as string).trim();
  const ref = /^var\(--([a-z0-9-]+)\)$/.exec(value);
  return ref ? token(ref[1] as string) : value;
}

type Rgb = [number, number, number];

function rgb(value: string): { c: Rgb; a: number } {
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex) {
    const n = parseInt(hex[1] as string, 16);
    return { c: [(n >> 16) & 255, (n >> 8) & 255, n & 255], a: 1 };
  }
  const fn = /^rgba?\(([^)]+)\)$/.exec(value);
  if (!fn) throw new Error(`cannot read colour ${value}`);
  const parts = (fn[1] as string).split(",").map((x) => Number(x.trim()));
  return { c: [parts[0] as number, parts[1] as number, parts[2] as number], a: parts[3] ?? 1 };
}

const over = (top: { c: Rgb; a: number }, under: Rgb): Rgb => [0, 1, 2].map((i) => (top.c[i] as number) * top.a + (under[i] as number) * (1 - top.a)) as Rgb;

function luminance(c: Rgb): number {
  const lin = c.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * (lin[0] as number) + 0.7152 * (lin[1] as number) + 0.0722 * (lin[2] as number);
}

function contrast(a: Rgb, b: Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const SNOW: Rgb = [238, 242, 244];
const NIGHT: Rgb = [11, 19, 15];

describe("text contrast from the design tokens (WCAG 2.1 AA)", () => {
  const paper = [rgb(token("paper-50")).c, rgb(token("paper-100")).c, rgb(token("paper-200")).c];
  const glass = rgb(token("glass"));

  it.each([
    ["text-on-paper", 4.5],
    ["text-on-paper-muted", 4.5],
    ["umber-600", 4.5],
    ["umber-700", 4.5],
    ["berry-500", 4.5],
  ])("%s on every parchment surface is at least %s:1", (name, floor) => {
    for (const surface of paper) expect(contrast(rgb(token(name)).c, surface), `${name} on ${surface.join(",")}`).toBeGreaterThanOrEqual(floor);
  });

  it.each([
    ["text-on-dark", 4.5],
    ["text-on-dark-muted", 4.5],
    ["ember-300", 4.5],
    ["sage-200", 4.5],
  ])("%s on glass is at least %s:1 over snow and over night", (name, floor) => {
    for (const scene of [SNOW, NIGHT]) expect(contrast(rgb(token(name)).c, over(glass, scene)), `${name} on glass over ${scene.join(",")}`).toBeGreaterThanOrEqual(floor);
  });

  it("the focus ring stands out from both paper and glass (3:1 for a control's outline)", () => {
    const focus = rgb(token("focus")).c;
    expect(contrast(focus, over(glass, NIGHT))).toBeGreaterThanOrEqual(3);
    expect(contrast(focus, over(glass, SNOW))).toBeGreaterThanOrEqual(3);
  });
});
