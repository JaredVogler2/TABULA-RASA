/**
 * Text hygiene for anything a mind supplies that will be stored, shown or passed on.
 *
 * What these functions keep decides what is written into the world, so their answer has to be
 * the same in every JavaScript engine. They therefore list code points explicitly and never
 * ask the runtime for a Unicode property (`\p{…}`): a browser and a server that ship different
 * versions of Unicode would otherwise disagree about a newly assigned character, and a world
 * replayed on one would no longer match the world recorded on the other.
 */

/**
 * Code points that have no business in a sentence someone else will read: controls, anything
 * invisible, anything that breaks a line or reorders the text around it, private-use and
 * surrogate code points, and noncharacters.
 */
function unwanted(c: number): boolean {
  return (
    c < 0x20 || // C0 controls, tab and line feed among them
    (c >= 0x7f && c <= 0x9f) || // DEL and the C1 controls (U+0085 next line among them)
    c === 0xad || // soft hyphen
    c === 0x34f || // combining grapheme joiner
    (c >= 0x600 && c <= 0x605) || // Arabic number signs (format characters that reach over what follows)
    c === 0x61c || // Arabic letter mark
    c === 0x6dd || // Arabic end of ayah
    c === 0x70f || // Syriac abbreviation mark
    c === 0x890 || // Arabic pound and piastre marks above
    c === 0x891 ||
    c === 0x8e2 || // Arabic disputed end of ayah
    c === 0x115f || // Hangul fillers
    c === 0x1160 ||
    c === 0x17b4 || // Khmer inherent vowels (invisible)
    c === 0x17b5 ||
    (c >= 0x180b && c <= 0x180f) || // Mongolian variation selectors and vowel separator
    (c >= 0x200b && c <= 0x200f) || // zero-width space and joiners, direction marks
    (c >= 0x2028 && c <= 0x202e) || // line and paragraph separators, direction embeddings and overrides
    (c >= 0x2060 && c <= 0x206f) || // word joiner, invisible operators, direction isolates
    c === 0x2800 || // blank Braille pattern
    c === 0x3164 || // Hangul filler
    (c >= 0xd800 && c <= 0xf8ff) || // lone surrogates and the private-use area
    (c >= 0xfdd0 && c <= 0xfdef) || // noncharacters
    (c >= 0xfe00 && c <= 0xfe0f) || // variation selectors
    c === 0xfeff || // byte-order mark / zero-width no-break space
    c === 0xffa0 || // halfwidth Hangul filler
    (c >= 0xfff0 && c <= 0xfffc) || // specials: annotation anchors, object replacement
    (c & 0xfffe) === 0xfffe || // U+FFFE, U+FFFF and their like at the end of every plane
    c === 0x110bd || // Kaithi number signs
    c === 0x110cd ||
    (c >= 0x13430 && c <= 0x1343f) || // Egyptian hieroglyph format controls
    (c >= 0x1bca0 && c <= 0x1bca3) || // shorthand format controls
    (c >= 0x1d173 && c <= 0x1d17a) || // musical format controls
    (c >= 0xe0000 && c <= 0xe0fff) || // tag characters and the variation-selector supplement
    c >= 0xf0000 // supplementary private-use planes
  );
}

/** Spaces that are not the plain space: all are written as one. */
function oddSpace(c: number): boolean {
  return c === 0xa0 || c === 0x1680 || (c >= 0x2000 && c <= 0x200a) || c === 0x202f || c === 0x205f || c === 0x3000;
}

/**
 * A mind's words as they are stored: every unwanted character and every run of spaces becomes
 * one plain space, none is left at either end, and the result is at most `max` UTF-16 units
 * long without ever splitting a character in two. Cleaning text that is already clean changes
 * nothing.
 */
export function cleanText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  let out = "";
  let gap = false;
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (code === 0x20 || unwanted(code) || oddSpace(code)) {
      gap = out.length > 0;
      continue;
    }
    const piece = gap ? ` ${ch}` : ch;
    if (out.length + piece.length > max) break;
    out += piece;
    gap = false;
  }
  return out;
}

/**
 * A short plain label — the name of a role in an agreement. Only unaccented Latin letters,
 * digits, hyphens and underscores are kept, as words separated by single spaces; everything
 * else separates words. A label is always shown inside quotation marks, and this is what makes
 * that safe: it holds nothing that could close the quotation, end the sentence it stands in,
 * or start another.
 */
export function cleanLabel(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  let out = "";
  let gap = false;
  const end = Math.min(value.length, 4096);
  for (let i = 0; i < end; i++) {
    const c = value.charCodeAt(i);
    const kept = (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 45 || c === 95;
    if (!kept) {
      gap = out.length > 0;
      continue;
    }
    if (out.length + (gap ? 2 : 1) > max) break;
    out += gap ? ` ${value[i]}` : value[i];
    gap = false;
  }
  return out;
}
