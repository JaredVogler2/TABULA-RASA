/**
 * Post-processing: a gentle bloom for fire and glints, and a tilt-shift blur with
 * vignette that gives the island the scale of a miniature. Tone mapping and colour
 * conversion happen once, in the output pass.
 */
import { HalfFloatType, Vector2, WebGLRenderTarget, type Camera, type Scene, type WebGLRenderer } from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";

const MiniatureShader = {
  name: "MiniatureShader",
  uniforms: {
    tDiffuse: { value: null },
    uRes: { value: new Vector2(1, 1) },
    uFocus: { value: 0.5 },
    uBand: { value: 0.16 },
    uBlur: { value: 5.0 },
    uVignette: { value: 0.38 },
    uGrain: { value: 0.012 },
    uTime: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    precision highp float;
    uniform sampler2D tDiffuse;
    uniform vec2 uRes;
    uniform float uFocus;
    uniform float uBand;
    uniform float uBlur;
    uniform float uVignette;
    uniform float uGrain;
    uniform float uTime;
    varying vec2 vUv;
    float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
    void main() {
      float d = abs(vUv.y - uFocus);
      float amt = smoothstep(uBand, uBand + 0.42, d);
      float radius = amt * uBlur;
      vec3 col = texture2D(tDiffuse, vUv).rgb;
      if (radius > 0.35) {
        // golden-angle disc; brighter samples weigh more so highlights bloom into discs
        vec3 acc = col;
        float wsum = 1.0;
        for (int i = 1; i < 14; i++) {
          float a = float(i) * 2.39996323;
          float r = sqrt(float(i) / 13.0) * radius;
          vec2 o = vec2(cos(a), sin(a)) * r / uRes;
          vec3 s = texture2D(tDiffuse, vUv + o).rgb;
          float w = 1.0 + dot(s, vec3(0.3333)) * 0.6;
          acc += s * w;
          wsum += w;
        }
        col = acc / wsum;
      }
      vec2 q = vUv - 0.5;
      float vig = 1.0 - uVignette * smoothstep(0.25, 0.95, dot(q, q) * 2.2);
      col *= vig;
      col += (hash(vUv * uRes + uTime) - 0.5) * uGrain;
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }`,
};

export interface PostChain {
  render(dt: number): void;
  setSize(width: number, height: number, pixelRatio: number): void;
  /** `focusY` 0..1 screen height of the sharp band; `strength` 0..1 scales blur with zoom. */
  setMiniature(focusY: number, strength: number, time: number): void;
  dispose(): void;
}

export function buildPost(renderer: WebGLRenderer, scene: Scene, camera: Camera, quality: "medium" | "high", reducedMotion: boolean): PostChain {
  const size = renderer.getDrawingBufferSize(new Vector2());
  // the stencil buffer is what lets a hidden citizen show as a faint shape (see citizens.ts)
  const target = new WebGLRenderTarget(size.x, size.y, { type: HalfFloatType, samples: quality === "high" ? 4 : 2, stencilBuffer: true });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  let bloom: UnrealBloomPass | null = null;
  if (quality === "high") {
    bloom = new UnrealBloomPass(new Vector2(size.x / 2, size.y / 2), 0.2, 0.55, 0.96);
    composer.addPass(bloom);
  }
  const mini = new ShaderPass(MiniatureShader);
  mini.uniforms.uGrain!.value = reducedMotion ? 0 : 0.012;
  composer.addPass(mini);
  composer.addPass(new OutputPass());

  return {
    render(dt: number) {
      composer.render(dt);
    },
    setSize(width: number, height: number, pixelRatio: number) {
      composer.setPixelRatio(pixelRatio);
      composer.setSize(width, height);
      (mini.uniforms.uRes!.value as Vector2).set(width * pixelRatio, height * pixelRatio);
      if (bloom) bloom.resolution.set((width * pixelRatio) / 2, (height * pixelRatio) / 2);
    },
    setMiniature(focusY: number, strength: number, time: number) {
      mini.uniforms.uFocus!.value = focusY;
      mini.uniforms.uBlur!.value = 1.0 + 4.6 * strength;
      mini.uniforms.uBand!.value = 0.2 - 0.07 * strength;
      mini.uniforms.uTime!.value = reducedMotion ? 0 : time;
    },
    dispose() {
      composer.dispose();
      target.dispose();
    },
  };
}
