/** Shared meshes for the citizens. Figures face +Z. Limbs are modelled in joint space along -Y. */
import {
  BufferAttribute,
  type BufferGeometry,
  Color,
  CylinderGeometry,
  DataTexture,
  LatheGeometry,
  LinearFilter,
  LinearMipmapLinearFilter,
  RepeatWrapping,
  RGBAFormat,
  SphereGeometry,
  UnsignedByteType,
  Vector2,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { rand01 } from "./palette";

export const UPPER_ARM = 0.136;
export const FOREARM = 0.128;
export const THIGH = 0.167;
export const SHIN = 0.151;
export const BOOT_HEIGHT = 0.039;
export const HEAD_HEIGHT = 0.375;

function paint(geometry: BufferGeometry, color: string, shade?: (x: number, y: number, z: number) => number): BufferGeometry {
  const vertices = geometry.getAttribute("position");
  const rgb = new Color(color);
  const colors = new Float32Array(vertices.count * 3);
  for (let i = 0; i < vertices.count; i++) {
    const value = shade?.(vertices.getX(i), vertices.getY(i), vertices.getZ(i)) ?? 1;
    colors.set([rgb.r * value, rgb.g * value, rgb.b * value], i * 3);
  }
  geometry.setAttribute("color", new BufferAttribute(colors, 3));
  return geometry;
}

function join(parts: BufferGeometry[]): BufferGeometry {
  const geometry = mergeGeometries(parts.map((part) => part.index ? part.toNonIndexed() : part))!;
  for (const part of parts) part.dispose();
  return geometry;
}

function oval(x: number, y: number, z: number, segments: number, rows = 6): SphereGeometry {
  return new SphereGeometry(1, segments, rows).scale(x, y, z);
}

function profile(points: [radius: number, y: number][], segments: number, depth = 1): BufferGeometry {
  return new LatheGeometry(points.map(([radius, y]) => new Vector2(radius, y)), segments).scale(1, 1, depth);
}

function tunic(segments: number): BufferGeometry {
  const cloth = profile([
    [0, -0.069], [0.128, -0.069], [0.128, -0.056], [0.107, 0.012],
    [0.091, 0.081], [0.093, 0.124], [0.108, 0.187], [0.122, 0.242],
    [0.111, 0.271], [0.071, 0.286], [0.041, 0.296], [0, 0.296],
  ], segments, 0.61);
  const pos = cloth.getAttribute("position");
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const theta = Math.atan2(x, z);
    const drape = (Math.cos(theta * 5 + y * 8) + 0.5 * Math.sin(theta * 9 - y * 13)) *
      (y < 0.07 ? 0.045 : 0.023);
    const skirt = Math.max(0, Math.min(1, (0.06 - y) / 0.13));
    pos.setXYZ(i, x * (1 + drape), y + Math.sin(theta * 3) * 0.005 * skirt, z * (1 + drape + 0.26 * skirt));
  }
  cloth.computeVertexNormals();
  // Weld the two sets of normals at the UV seam so it lights as a continuous garment.
  const normals = cloth.getAttribute("normal");
  const rows = pos.count / (segments + 1);
  for (let i = 0; i < rows; i++) {
    const far = i + segments * rows;
    const x = normals.getX(i) + normals.getX(far);
    const y = normals.getY(i) + normals.getY(far);
    const z = normals.getZ(i) + normals.getZ(far);
    const length = Math.hypot(x, y, z) || 1;
    normals.setXYZ(i, x / length, y / length, z / length);
    normals.setXYZ(far, x / length, y / length, z / length);
  }
  const belt = new CylinderGeometry(0.098, 0.099, 0.023, segments).scale(1, 1, 0.66).translate(0, 0.088, 0);
  const knot = oval(0.021, 0.013, 0.014, 6, 4).translate(0.025, 0.087, 0.066);
  return join([
    paint(cloth, "#ffffff", (x, y, z) => {
      const theta = Math.atan2(x, z);
      if (y < -0.055) return 0.66;
      if (y > 0.268 && z > 0 && Math.abs(x) < 0.044) return 0.63;
      return 0.9 + Math.sin(theta * 5 + y * 7) * 0.09;
    }),
    paint(belt, "#856d58"),
    paint(knot, "#aa9072"),
  ]);
}

function head(segments: number, rows: number, detailed: boolean): BufferGeometry {
  const skull = oval(0.062, 0.086, 0.066, segments, rows);
  const pos = skull.getAttribute("position");
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const jaw = Math.max(0, Math.min(1, (-y - 0.02) / 0.057));
    const front = Math.max(0, z / 0.066);
    const cheek = Math.exp(-((Math.abs(x) - 0.035) ** 2 / 0.00038 + (y + 0.012) ** 2 / 0.0005));
    const socket = Math.exp(-((Math.abs(x) - 0.026) ** 2 / 0.00025 + (y - 0.018) ** 2 / 0.000085));
    const chin = Math.exp(-(x ** 2 / 0.0008 + (y + 0.06) ** 2 / 0.0004));
    pos.setXYZ(i, x * (1 - jaw * 0.22), y, z + front * (0.008 * cheek - 0.009 * socket + 0.019 * chin));
  }
  skull.computeVertexNormals();

  const parts = [
    paint(skull, "#ffffff", (x, y, z) => 0.93 + y * 0.8 + z * 0.6 + Math.abs(x) * 0.35),
    paint(oval(0.013, 0.025, 0.016, 8).rotateX(-0.28).translate(0, 0.001, 0.065), "#f4e5d9"),
    paint(new CylinderGeometry(0.029, 0.032, 0.066, 8).translate(0, -0.076, -0.009), "#e4d5c4"),
  ];
  for (const side of [-1, 1]) {
    parts.push(paint(oval(0.013, 0.022, 0.012, 7).rotateZ(-side * 0.16).translate(side * 0.057, -0.005, -0.008), "#edd6c7"));
    if (detailed) {
      parts.push(
        paint(oval(0.014, 0.004, 0.006, 8, 4).rotateY(side * 0.30).translate(side * 0.026, 0.016, 0.056), "#c2b6a5"),
        paint(oval(0.0044, 0.004, 0.0046, 6, 4).translate(side * 0.025, 0.016, 0.061), "#382b24"),
        paint(oval(0.014, 0.0026, 0.004, 8, 4).rotateY(side * 0.28).translate(side * 0.026, 0.029, 0.058), "#796757"),
      );
    }
  }
  if (detailed) parts.push(paint(oval(0.017, 0.0031, 0.004, 8, 4).translate(0, -0.034, 0.062), "#b78072"));
  return join(parts);
}

function hair(segments: number): BufferGeometry {
  const rows = 8;
  const geometry = new SphereGeometry(1, segments, rows, 0, Math.PI * 2, 0, 1);
  const pos = geometry.getAttribute("position");
  for (let i = 0; i < pos.count; i++) {
    const u = (i % (segments + 1)) / segments;
    const v = Math.floor(i / (segments + 1)) / rows;
    const around = u * Math.PI * 2;
    const forward = Math.cos(around);
    const hairline = 1.52 - forward * 0.43 + Math.sin(around * 2) * 0.075;
    const theta = v * hairline;
    const locks = 1 + (0.03 * Math.sin(around * 9 + theta * 4) + 0.02 * Math.sin(around * 15)) * Math.sin(theta);
    pos.setXYZ(i, Math.sin(around) * Math.sin(theta) * 0.066 * locks, Math.cos(theta) * 0.092 * locks, Math.cos(around) * Math.sin(theta) * 0.071 * locks - 0.003);
  }
  geometry.computeVertexNormals();
  return paint(geometry, "#ffffff", (x, y, z) => {
    const theta = Math.atan2(x, z + 0.003);
    return 0.82 + 0.18 * Math.cos(theta * 11 + y * 65) + Math.max(y, 0) * 2.1;
  });
}

function limbs(segments: number) {
  const upperArm = join([
    paint(profile([[0, -UPPER_ARM - 0.014], [0.022, -UPPER_ARM], [0.026, -0.088], [0.033, -0.043], [0.029, 0], [0, 0.02]], segments), "#ffffff"),
    paint(new CylinderGeometry(0.028, 0.026, 0.017, segments).translate(0, -0.107, 0), "#b7a896"),
  ]);
  const forearm = join([
    paint(profile([[0, -FOREARM], [0.014, -0.115], [0.022, -0.048], [0.023, 0.006], [0, 0.02]], segments), "#efddd0"),
    paint(oval(0.018, 0.029, 0.015, segments).translate(0, -FOREARM, 0.005), "#f5e8dd"),
    paint(oval(0.009, 0.016, 0.010, 6, 4).rotateZ(0.36).translate(0, -FOREARM + 0.008, 0.017), "#e6cbb7"),
  ]);
  const thigh = paint(profile([[0, -THIGH - 0.012], [0.025, -THIGH], [0.032, -0.107], [0.041, -0.034], [0.039, 0.014], [0, 0.026]], segments, 0.90), "#ffffff");
  const shin = join([
    paint(profile([[0, -SHIN], [0.020, -0.128], [0.028, -0.063], [0.026, 0.007], [0, 0.016]], segments, 0.93), "#e9e3d9"),
    paint(oval(0.028, 0.024, 0.057, segments).translate(0, -SHIN - 0.015, 0.028), "#51453c"),
    paint(oval(0.029, 0.008, 0.058, segments, 4).translate(0, -SHIN - 0.030, 0.028), "#37332e"),
    paint(new CylinderGeometry(0.025, 0.025, 0.014, segments).translate(0, -SHIN + 0.008, 0), "#9c8270"),
  ]);
  return { upperArm, forearm, thigh, shin };
}

function hat(segments: number): BufferGeometry {
  const straw = profile([
    [0.035, -0.008], [0.085, -0.008], [0.125, -0.016], [0.132, -0.011],
    [0.131, -0.005], [0.088, 0.008], [0.073, 0.025], [0.065, 0.046],
    [0.051, 0.062], [0.021, 0.067], [0, 0.066],
  ], segments);
  const band = new CylinderGeometry(0.075, 0.082, 0.011, segments, 1, true).translate(0, 0.017, 0);
  return join([
    paint(straw, "#d4b675", (x, y, z) => 0.88 + 0.12 * Math.sin(Math.atan2(x, z) * 12 + y * 32)),
    paint(band, "#796449"),
  ]);
}

export function buildCitizenGeometry(quality: "low" | "medium" | "high") {
  const detailed = quality !== "low";
  return {
    body: tunic(quality === "high" ? 20 : detailed ? 16 : 12),
    head: head(quality === "high" ? 20 : detailed ? 16 : 10, detailed ? 12 : 8, detailed),
    hair: hair(detailed ? 20 : 12),
    hat: hat(detailed ? 20 : 12),
    ...limbs(detailed ? 10 : 6),
  };
}

export function buildCitizenSilhouettes() {
  return {
    body: profile([[0.125, -0.065], [0.09, 0.09], [0.12, 0.244], [0.04, 0.296]], 8, 0.61),
    head: oval(0.064, 0.089, 0.069, 8, 6),
  };
}

/** A small mipmapped weave shared by every tunic, so distant cloth stays smooth. */
export function buildWeave(): DataTexture {
  const size = 64;
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const warp = (x % 4) === 0;
      const weft = (y % 4) === 0;
      const value = Math.round(222 + 16 * Number(warp || weft) + rand01(x, y) * 16);
      pixels.set([value, value, value, 255], (y * size + x) * 4);
    }
  }
  const texture = new DataTexture(pixels, size, size, RGBAFormat, UnsignedByteType);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.repeat.set(2, 2);
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}
