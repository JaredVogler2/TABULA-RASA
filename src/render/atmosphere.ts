/**
 * Light and air: the sun and moon that follow the simulated day, a quiet backdrop,
 * stars, and precipitation. Weather here is a rendering of `climate` in the frame;
 * it has no state of its own beyond animation phase.
 */
import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  type Object3D,
  PCFShadowMap,
  Points,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  type IUniform,
  type WebGLRenderer,
} from "three";
import type { ClimateView } from "@/worker/protocol";
import { lightAt, makeLightState, type LightState } from "./palette";

export interface AtmosphereParts {
  objects: Object3D[];
  sun: DirectionalLight;
  state: LightState;
  /** Update lights and sky for a moment of the day. Returns the light state used. */
  update(tickOfDay: number, dayLength: number, yearPos: number, climate: ClimateView, time: number, focus: Vector3): LightState;
  configure(renderer: WebGLRenderer): void;
  dispose(): void;
}

const WEATHER = { clear: 0, overcast: 1, rain: 2, storm: 3, snow: 4 } as const;

export function buildAtmosphere(extent: number, quality: "low" | "medium" | "high"): AtmosphereParts {
  const state = makeLightState();

  const sun = new DirectionalLight(0xffffff, 3);
  sun.castShadow = quality !== "low";
  const shadowSize = quality === "high" ? 2048 : 1024;
  sun.shadow.mapSize.set(shadowSize, shadowSize);
  const half = extent * 0.62;
  sun.shadow.camera.left = -half;
  sun.shadow.camera.right = half;
  sun.shadow.camera.top = half;
  sun.shadow.camera.bottom = -half;
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = extent * 3.2;
  sun.shadow.bias = -0.0008;
  sun.shadow.normalBias = 0.06;
  // (3.5 until D-054: the filter this three.js uses scatters its five samples, and over that width it showed as stipple)
  sun.shadow.radius = 2.2;

  const moon = new DirectionalLight(new Color("#a9c2ee"), 0);
  moon.position.set(-0.45, 0.8, -0.35).multiplyScalar(extent);
  const hemi = new HemisphereLight(0xffffff, 0x444444, 1);

  // ── backdrop: a dark, softly graded dome that takes a hint of the hour
  const backdropUniforms: Record<string, IUniform<unknown>> = {
    uTop: { value: new Color() },
    uHorizon: { value: new Color() },
    uSunDir: { value: new Vector3(0, 1, 0) },
    uGlow: { value: new Color() },
    uGlowAmt: { value: 0 },
  };
  const backdrop = new Mesh(
    new SphereGeometry(420, 32, 20),
    new ShaderMaterial({
      side: BackSide,
      depthWrite: false,
      uniforms: backdropUniforms,
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww;
        }`,
      fragmentShader: /* glsl */ `
        precision highp float;
        varying vec3 vDir;
        uniform vec3 uTop;
        uniform vec3 uHorizon;
        uniform vec3 uSunDir;
        uniform vec3 uGlow;
        uniform float uGlowAmt;
        void main() {
          float h = clamp(vDir.y * 0.5 + 0.5, 0.0, 1.0);
          vec3 col = mix(uHorizon, uTop, smoothstep(0.42, 0.95, h));
          col = mix(col * 0.55, col, smoothstep(0.2, 0.5, h));
          float sunward = max(0.0, dot(normalize(vec3(vDir.x, 0.0, vDir.z)), normalize(vec3(uSunDir.x, 0.0, uSunDir.z))));
          col += uGlow * uGlowAmt * pow(sunward, 5.0) * (1.0 - smoothstep(0.5, 0.78, h)) * smoothstep(0.3, 0.5, h);
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }`,
    }),
  );
  backdrop.renderOrder = -10;
  backdrop.frustumCulled = false;
  backdrop.name = "backdrop";

  // ── stars
  const starCount = quality === "low" ? 300 : 900;
  const starPos = new Float32Array(starCount * 3);
  const starSeed = new Float32Array(starCount);
  for (let i = 0; i < starCount; i++) {
    // deterministic scatter over the upper dome
    const u = ((i * 0.61803398875) % 1) * Math.PI * 2;
    const v = 0.12 + 0.86 * (((i * 0.7548776662) % 1) ** 0.8);
    const r = 400;
    const y = v;
    const s = Math.sqrt(1 - y * y);
    starPos[i * 3] = Math.cos(u) * s * r;
    starPos[i * 3 + 1] = y * r;
    starPos[i * 3 + 2] = Math.sin(u) * s * r;
    starSeed[i] = (i * 0.3819660113) % 1;
  }
  const starGeometry = new BufferGeometry();
  starGeometry.setAttribute("position", new BufferAttribute(starPos, 3));
  starGeometry.setAttribute("aSeed", new BufferAttribute(starSeed, 1));
  const starUniforms: Record<string, IUniform<unknown>> = { uNight: { value: 0 }, uTime: { value: 0 }, uScale: { value: 1 } };
  const stars = new Points(
    starGeometry,
    new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: starUniforms,
      vertexShader: /* glsl */ `
        attribute float aSeed;
        varying float vTw;
        uniform float uTime;
        uniform float uScale;
        void main() {
          vTw = 0.6 + 0.4 * sin(uTime * (0.6 + aSeed * 1.8) + aSeed * 40.0);
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww;
          gl_PointSize = (1.0 + aSeed * 1.8) * uScale;
        }`,
      fragmentShader: /* glsl */ `
        precision highp float;
        varying float vTw;
        uniform float uNight;
        void main() {
          vec2 d = gl_PointCoord - 0.5;
          float a = smoothstep(0.5, 0.0, length(d));
          gl_FragColor = vec4(vec3(0.85, 0.9, 1.0) * a * vTw * uNight * 0.9, a * uNight);
          #include <colorspace_fragment>
        }`,
    }),
  );
  stars.frustumCulled = false;
  stars.renderOrder = -9;
  stars.name = "stars";

  // ── precipitation: one particle cloud reused for rain and snow
  const dropCount = quality === "low" ? 500 : quality === "medium" ? 1400 : 2600;
  const dropPos = new Float32Array(dropCount * 3);
  const dropSeed = new Float32Array(dropCount);
  for (let i = 0; i < dropCount; i++) {
    dropPos[i * 3] = (((i * 0.61803398875) % 1) - 0.5) * extent * 1.1;
    dropPos[i * 3 + 1] = ((i * 0.7548776662) % 1) * 26;
    dropPos[i * 3 + 2] = (((i * 0.5698402909) % 1) - 0.5) * extent * 1.1;
    dropSeed[i] = (i * 0.3819660113) % 1;
  }
  const dropGeometry = new BufferGeometry();
  dropGeometry.setAttribute("position", new BufferAttribute(dropPos, 3));
  dropGeometry.setAttribute("aSeed", new BufferAttribute(dropSeed, 1));
  const dropUniforms: Record<string, IUniform<unknown>> = {
    uTime: { value: 0 },
    uAmount: { value: 0 },
    uSnow: { value: 0 },
    uScale: { value: 1 },
    uLight: { value: new Color(1, 1, 1) },
  };
  const drops = new Points(
    dropGeometry,
    new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: dropUniforms,
      vertexShader: /* glsl */ `
        attribute float aSeed;
        uniform float uTime;
        uniform float uSnow;
        uniform float uAmount;
        uniform float uScale;
        varying float vShow;
        void main() {
          vec3 p = position;
          float speed = mix(17.0, 2.2, uSnow) * (0.75 + aSeed * 0.5);
          p.y = mod(p.y - uTime * speed, 26.0);
          float drift = mix(0.6, 2.2, uSnow);
          p.x += sin(uTime * 0.7 + aSeed * 30.0) * drift * uSnow + (26.0 - p.y) * 0.08 * (1.0 - uSnow);
          p.z += cos(uTime * 0.5 + aSeed * 17.0) * drift * uSnow;
          vShow = step(aSeed, uAmount);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = uScale * mix(110.0, 150.0, uSnow) / max(1.0, -mv.z);
        }`,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform float uSnow;
        uniform vec3 uLight;
        varying float vShow;
        void main() {
          vec2 d = gl_PointCoord - 0.5;
          // rain is a thin vertical streak, snow a soft disc
          float streak = smoothstep(0.09, 0.0, abs(d.x)) * smoothstep(0.5, 0.1, abs(d.y));
          float flake = smoothstep(0.42, 0.05, length(d));
          float a = mix(streak * 0.42, flake * 0.85, uSnow) * vShow;
          if (a < 0.01) discard;
          vec3 col = mix(vec3(0.72, 0.8, 0.88), vec3(1.0), uSnow) * (uLight * 0.7 + 0.3);
          gl_FragColor = vec4(col, a);
          #include <colorspace_fragment>
        }`,
    }),
  );
  drops.frustumCulled = false;
  drops.renderOrder = 6;
  drops.name = "precipitation";

  let overcast = 0;
  let amount = 0;
  let snowMix = 0;
  const glow = new Color("#ffb066");

  return {
    objects: [sun, sun.target, moon, hemi, backdrop, stars, drops],
    sun,
    state,
    configure(renderer: WebGLRenderer) {
      renderer.shadowMap.enabled = quality !== "low";
      // (the soft variant asked for here until D-054 no longer exists in this three.js: it warned and fell back to this one)
      renderer.shadowMap.type = PCFShadowMap;
      // the shadow map is redrawn when the renderer says so, not on every frame (WorldRenderer, D-054)
      renderer.shadowMap.autoUpdate = false;
      renderer.shadowMap.needsUpdate = true;
      const pr = renderer.getPixelRatio();
      starUniforms.uScale!.value = pr;
      dropUniforms.uScale!.value = pr;
    },
    update(tickOfDay, dayLength, yearPos, climate, time, focus) {
      const w = climate.weather;
      const wantOvercast = w === WEATHER.clear ? 0 : w === WEATHER.overcast ? 0.6 : w === WEATHER.storm ? 1 : 0.85;
      const wantAmount = w === WEATHER.rain ? 0.55 : w === WEATHER.storm ? 1 : w === WEATHER.snow ? 0.7 : 0;
      overcast += (wantOvercast - overcast) * 0.04;
      amount += (wantAmount - amount) * 0.05;
      snowMix += ((w === WEATHER.snow ? 1 : 0) - snowMix) * 0.05;
      lightAt(tickOfDay, dayLength, yearPos, overcast, state);

      sun.color.copy(state.sunColor);
      sun.intensity = state.sunIntensity;
      sun.position.copy(focus).addScaledVector(state.sunDir, extent * 1.6);
      sun.target.position.copy(focus);
      sun.target.updateMatrixWorld();
      moon.intensity = state.moonIntensity;
      moon.position.copy(focus).add(new Vector3(-0.45, 0.8, -0.35).multiplyScalar(extent));
      hemi.color.copy(state.skyColor);
      hemi.groundColor.copy(state.groundColor);
      hemi.intensity = state.hemiIntensity;

      (backdropUniforms.uTop!.value as Color).copy(state.backdropTop);
      (backdropUniforms.uHorizon!.value as Color).copy(state.backdropHorizon);
      (backdropUniforms.uSunDir!.value as Vector3).copy(state.sunDir);
      (backdropUniforms.uGlow!.value as Color).copy(glow);
      backdropUniforms.uGlowAmt!.value = state.golden * 0.55 * (1 - overcast * 0.7);
      starUniforms.uNight!.value = state.night * (1 - overcast * 0.9);
      starUniforms.uTime!.value = time;
      dropUniforms.uTime!.value = time;
      dropUniforms.uAmount!.value = amount;
      dropUniforms.uSnow!.value = snowMix;
      (dropUniforms.uLight!.value as Color).copy(state.skyColor).multiplyScalar(0.6 + 0.6 * (1 - state.night));
      drops.visible = amount > 0.01;
      drops.position.set(focus.x, 0, focus.z);
      return state;
    },
    dispose() {
      backdrop.geometry.dispose();
      (backdrop.material as ShaderMaterial).dispose();
      starGeometry.dispose();
      (stars.material as ShaderMaterial).dispose();
      dropGeometry.dispose();
      (drops.material as ShaderMaterial).dispose();
      sun.dispose();
      moon.dispose();
      hemi.dispose();
    },
  };
}
