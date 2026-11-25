/**
 * Canonical serialization.
 *
 * `canonicalJson` produces one and only one byte sequence for a given value:
 * object keys are sorted, typed arrays are encoded as tagged base64, and values
 * that would make the output ambiguous or non-deterministic (NaN, ±Infinity,
 * undefined, functions, Map/Set, class instances) are rejected instead of being
 * silently coerced. Snapshot hashes are computed over this encoding.
 */

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64_LOOKUP = (() => {
  const t = new Int16Array(128).fill(-1);
  for (let i = 0; i < B64.length; i++) t[B64.charCodeAt(i)] = i;
  return t;
})();

export function bytesToBase64(bytes: Uint8Array): string {
  let out = "";
  const n = bytes.length;
  let i = 0;
  for (; i + 2 < n; i += 3) {
    const v = ((bytes[i] as number) << 16) | ((bytes[i + 1] as number) << 8) | (bytes[i + 2] as number);
    out += B64[(v >> 18) & 63]! + B64[(v >> 12) & 63]! + B64[(v >> 6) & 63]! + B64[v & 63]!;
  }
  if (i + 1 === n) {
    const v = (bytes[i] as number) << 16;
    out += B64[(v >> 18) & 63]! + B64[(v >> 12) & 63]! + "==";
  } else if (i + 2 === n) {
    const v = ((bytes[i] as number) << 16) | ((bytes[i + 1] as number) << 8);
    out += B64[(v >> 18) & 63]! + B64[(v >> 12) & 63]! + B64[(v >> 6) & 63]! + "=";
  }
  return out;
}

export function base64ToBytes(text: string): Uint8Array {
  const len = text.length;
  if (len % 4 !== 0) throw new Error("base64: length is not a multiple of 4");
  let pad = 0;
  if (len > 0 && text[len - 1] === "=") pad++;
  if (len > 1 && text[len - 2] === "=") pad++;
  const out = new Uint8Array((len / 4) * 3 - pad);
  let o = 0;
  for (let i = 0; i < len; i += 4) {
    const quad = [0, 0, 0, 0];
    for (let j = 0; j < 4; j++) {
      const ch = text.charCodeAt(i + j);
      if (ch === 61 /* = */) {
        if (i + j < len - pad) throw new Error("base64: unexpected padding");
        quad[j] = 0;
      } else {
        const v = ch < 128 ? (B64_LOOKUP[ch] as number) : -1;
        if (v < 0) throw new Error("base64: invalid character");
        quad[j] = v;
      }
    }
    const v = ((quad[0] as number) << 18) | ((quad[1] as number) << 12) | ((quad[2] as number) << 6) | (quad[3] as number);
    if (o < out.length) out[o++] = (v >> 16) & 0xff;
    if (o < out.length) out[o++] = (v >> 8) & 0xff;
    if (o < out.length) out[o++] = v & 0xff;
  }
  return out;
}

type TypedArrayTag = "u8" | "i8" | "u16" | "i16" | "u32" | "i32";

type AnyTyped = Uint8Array | Int8Array | Uint16Array | Int16Array | Uint32Array | Int32Array;

function tagOf(x: unknown): TypedArrayTag | null {
  if (x instanceof Uint8Array) return "u8";
  if (x instanceof Int8Array) return "i8";
  if (x instanceof Uint16Array) return "u16";
  if (x instanceof Int16Array) return "i16";
  if (x instanceof Uint32Array) return "u32";
  if (x instanceof Int32Array) return "i32";
  return null;
}

/** Encode a typed array as little-endian bytes regardless of host endianness. */
function typedToBytes(arr: AnyTyped, tag: TypedArrayTag): Uint8Array {
  const width = tag === "u8" || tag === "i8" ? 1 : tag === "u16" || tag === "i16" ? 2 : 4;
  const out = new Uint8Array(arr.length * width);
  for (let i = 0; i < arr.length; i++) {
    const v = (arr[i] as number) >>> 0;
    const o = i * width;
    out[o] = v & 0xff;
    if (width > 1) out[o + 1] = (v >>> 8) & 0xff;
    if (width > 2) {
      out[o + 2] = (v >>> 16) & 0xff;
      out[o + 3] = (v >>> 24) & 0xff;
    }
  }
  return out;
}

function bytesToTyped(bytes: Uint8Array, tag: TypedArrayTag): AnyTyped {
  const width = tag === "u8" || tag === "i8" ? 1 : tag === "u16" || tag === "i16" ? 2 : 4;
  if (bytes.length % width !== 0) throw new Error("canonical: typed array byte length mismatch");
  const n = bytes.length / width;
  const out: AnyTyped =
    tag === "u8"
      ? new Uint8Array(n)
      : tag === "i8"
        ? new Int8Array(n)
        : tag === "u16"
          ? new Uint16Array(n)
          : tag === "i16"
            ? new Int16Array(n)
            : tag === "u32"
              ? new Uint32Array(n)
              : new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * width;
    let v = bytes[o] as number;
    if (width > 1) v |= (bytes[o + 1] as number) << 8;
    if (width > 2) v |= ((bytes[o + 2] as number) << 16) | ((bytes[o + 3] as number) << 24);
    out[i] = v;
  }
  return out;
}

function quote(s: string): string {
  return JSON.stringify(s);
}

function write(value: unknown, path: string, out: string[]): void {
  if (value === null) {
    out.push("null");
    return;
  }
  switch (typeof value) {
    case "number":
      if (!Number.isFinite(value)) throw new Error(`canonical: non-finite number at ${path}`);
      // -0 would serialise as "0" but is distinguishable in JS; normalise explicitly.
      out.push(Object.is(value, -0) ? "0" : String(value));
      return;
    case "boolean":
      out.push(value ? "true" : "false");
      return;
    case "string":
      out.push(quote(value));
      return;
    case "undefined":
      throw new Error(`canonical: undefined at ${path}`);
    case "object":
      break;
    default:
      throw new Error(`canonical: unsupported type ${typeof value} at ${path}`);
  }
  const tag = tagOf(value);
  if (tag) {
    out.push(`{"$t":"${tag}","b":"${bytesToBase64(typedToBytes(value as AnyTyped, tag))}"}`);
    return;
  }
  if (Array.isArray(value)) {
    out.push("[");
    for (let i = 0; i < value.length; i++) {
      if (i) out.push(",");
      write(value[i], `${path}[${i}]`, out);
    }
    out.push("]");
    return;
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    throw new Error(`canonical: non-plain object (${proto?.constructor?.name ?? "?"}) at ${path}`);
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  out.push("{");
  let first = true;
  for (const k of keys) {
    const v = obj[k];
    if (v === undefined) continue; // absent optional fields are omitted, never written as null
    if (!first) out.push(",");
    first = false;
    out.push(quote(k), ":");
    write(v, `${path}.${k}`, out);
  }
  out.push("}");
}

export function canonicalJson(value: unknown): string {
  const out: string[] = [];
  write(value, "$", out);
  return out.join("");
}

/** Inverse of canonicalJson: revives tagged typed arrays. */
export function parseCanonical<T = unknown>(text: string): T {
  return JSON.parse(text, (_k, v: unknown) => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const o = v as Record<string, unknown>;
      if (typeof o.$t === "string" && typeof o.b === "string" && Object.keys(o).length === 2) {
        return bytesToTyped(base64ToBytes(o.b), o.$t as TypedArrayTag);
      }
    }
    return v;
  }) as T;
}

/** Structural deep clone for plain data + typed arrays (snapshots, forks). */
export function deepClone<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  const tag = tagOf(value);
  if (tag) return (value as unknown as AnyTyped).slice() as unknown as T;
  if (Array.isArray(value)) {
    const out = new Array(value.length);
    for (let i = 0; i < value.length; i++) out[i] = deepClone(value[i]);
    return out as unknown as T;
  }
  const out: Record<string, unknown> = {};
  const src = value as Record<string, unknown>;
  for (const k of Object.keys(src)) {
    const v = src[k];
    if (v !== undefined) out[k] = deepClone(v);
  }
  return out as T;
}
