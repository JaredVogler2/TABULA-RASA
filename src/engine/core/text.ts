/** Text hygiene for anything a mind supplies that will be stored, shown or passed on. */

/** Strip control, zero-width and bidirectional-override characters and bound the length. */
export function cleanText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  let out = "";
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 32 || code === 127 || (code >= 0x200b && code <= 0x200f) || (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069)) {
      out += " ";
    } else {
      out += ch;
    }
    if (out.length >= max) break;
  }
  return out.trim().slice(0, max);
}
