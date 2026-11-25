/**
 * WorldRenderer: draws view frames from the simulation worker.
 *
 * It owns the WebGL context, the scene and the camera. It never touches simulation
 * state: its only inputs are the static world view, the stream of view frames, and
 * user camera gestures. Rendering quality can change freely without affecting outcomes.
 */
import {
  ACESFilmicToneMapping,
  Color,
  type InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  SRGBColorSpace,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import { dayLength } from "@/engine";
import { AF, AGENT_STRIDE, type StaticWorldView, type ViewFrame } from "@/worker/protocol";
import { buildAtmosphere, type AtmosphereParts } from "./atmosphere";
import { CameraRig } from "./cameraRig";
import { buildCitizens, type CitizenParts } from "./citizens";
import { buildFlora, type FloraParts } from "./flora";
import { HeightField } from "./heightfield";
import { buildPost, type PostChain } from "./post";
import { buildStructures, type StructureParts } from "./structures";
import { buildTerrain, type TerrainParts } from "./terrain";
import { buildWater, type WaterParts } from "./water";

export type Quality = "low" | "medium" | "high";

export type Pick =
  | { type: "agent"; id: number }
  | { type: "structure"; id: number; x: number; y: number }
  | { type: "node"; id: number; x: number; y: number }
  | { type: "tile"; x: number; y: number };

export interface RendererOptions {
  quality: Quality;
  reducedMotion: boolean;
  /** Maximum device pixel ratio to render at. */
  maxPixelRatio?: number;
  /** Lower the internal resolution when frames run long (default true). Still captures turn it off. */
  adaptiveResolution?: boolean;
  onPick?(pick: Pick | null): void;
  onHover?(pick: Pick | null): void;
  onUserCamera?(): void;
}

export interface RenderStats {
  fps: number;
  frameMsP50: number;
  frameMsP95: number;
  drawCalls: number;
  triangles: number;
  pixelRatio: number;
  quality: Quality;
  renderer: string;
}

interface Bubble {
  el: HTMLElement;
  agent: number;
  until: number;
}

export class WorldRenderer {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private field: HeightField | null = null;
  private view: StaticWorldView | null = null;
  private rig: CameraRig | null = null;
  private terrain: TerrainParts | null = null;
  private water: WaterParts | null = null;
  private flora: FloraParts | null = null;
  private citizens: CitizenParts | null = null;
  private structures: StructureParts | null = null;
  private atmosphere: AtmosphereParts | null = null;
  private post: PostChain | null = null;
  private frame: ViewFrame | null = null;
  private frameArrival = 0;
  private raf = 0;
  private running = false;
  private last = 0;
  private time = 0;
  private quality: Quality;
  private pixelRatio = 1;
  private readonly frameTimes: number[] = [];
  private slowSince = 0;
  private selection: Pick | null = null;
  private readonly ring: Mesh;
  private readonly resizeObserver: ResizeObserver;
  private nameTag: HTMLElement | null = null;
  private readonly bubbles: Bubble[] = [];
  private deadKey = "";
  private structureList: { id: number; x: number; y: number }[] = [];
  private readonly tmp = new Vector3();
  private readonly tmp2 = new Vector3();
  private disposed = false;
  private glInfo = "unknown";

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly overlay: HTMLElement | null,
    private readonly options: RendererOptions,
  ) {
    this.quality = options.quality;
    this.renderer = new WebGLRenderer({ canvas, antialias: options.quality === "low", alpha: false, powerPreference: "high-performance", stencil: false });
    // totals across every pass of a frame (shadow, scene, post), reset by hand in renderFrame
    this.renderer.info.autoReset = false;
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.setClearColor(new Color("#0b130f"), 1);
    const gl = this.renderer.getContext();
    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    this.glInfo = String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));

    this.ring = new Mesh(new RingGeometry(0.3, 0.37, 40), new MeshBasicMaterial({ color: new Color("#f6c57e"), transparent: true, opacity: 0.95, depthTest: false, toneMapped: false }));
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.renderOrder = 20;
    this.ring.visible = false;
    this.scene.add(this.ring);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    canvas.addEventListener("webglcontextlost", this.onContextLost);
  }

  private onContextLost = (e: Event): void => {
    e.preventDefault();
    this.stop();
  };

  // ───────────────────────── world

  setWorld(view: StaticWorldView): void {
    this.clearWorld();
    this.view = view;
    const field = new HeightField(view);
    this.field = field;
    const q = this.quality;

    this.terrain = buildTerrain(view, field, q);
    this.water = buildWater(field, q);
    this.flora = buildFlora(view, field, q);
    this.citizens = buildCitizens(field, view.agents.length + 32, q);
    this.citizens.setRoster(view.agents);
    this.structures = buildStructures(field, q);
    this.atmosphere = buildAtmosphere(Math.max(view.w, view.h), q);
    this.atmosphere.configure(this.renderer);

    this.scene.add(this.terrain.floor, this.terrain.plinth, this.terrain.skirt, this.terrain.mesh, this.water.sea, this.water.fresh);
    for (const o of this.flora.objects) this.scene.add(o);
    for (const o of this.citizens.objects) this.scene.add(o);
    for (const o of this.structures.objects) this.scene.add(o);
    for (const o of this.atmosphere.objects) this.scene.add(o);

    this.rig = new CameraRig(this.canvas, field, {
      reducedMotion: this.options.reducedMotion,
      onTap: (x, y) => this.options.onPick?.(this.pick(x, y)),
      onHover: (x, y) => this.options.onHover?.(this.pickAgent(x, y)),
      onUserMove: () => this.options.onUserCamera?.(),
    });
    if (q !== "low") this.post = buildPost(this.renderer, this.scene, this.rig.camera, q, this.options.reducedMotion);
    this.deadKey = "";
    this.resize();
  }

  private clearWorld(): void {
    for (const part of [this.terrain, this.water, this.flora, this.citizens, this.structures, this.atmosphere]) part?.dispose();
    const keep = new Set([this.ring]);
    for (const child of [...this.scene.children]) if (!keep.has(child as Mesh)) this.scene.remove(child);
    this.post?.dispose();
    this.post = null;
    this.rig?.dispose();
    this.rig = null;
    this.terrain = null;
    this.water = null;
    this.flora = null;
    this.citizens = null;
    this.structures = null;
    this.atmosphere = null;
    this.frame = null;
    for (const b of this.bubbles) b.el.remove();
    this.bubbles.length = 0;
  }

  pushFrame(frame: ViewFrame): void {
    this.frame = frame;
    this.frameArrival = performance.now();
    if (!this.view || !this.field) return;
    this.flora?.setAmounts(frame.nodeAmounts);
    if (frame.roster) this.citizens?.setRoster(frame.roster);
    if (frame.structures) {
      this.structures?.setStructures(frame.structures);
      this.structureList = frame.structures.map((s) => ({ id: s.id, x: s.x, y: s.y }));
    }
    if (frame.piles) this.structures?.setPiles(frame.piles);
    if (frame.traffic) this.terrain?.setTraffic(frame.traffic);
    // cairns for the dead
    let key = "";
    const dead: { x: number; y: number; id: number }[] = [];
    const n = frame.agentCount;
    for (let i = 0; i < n; i++) {
      if ((frame.agents[i * AGENT_STRIDE + AF.alive] as number) < 0.5) {
        key += `${i},`;
        dead.push({ x: frame.agents[i * AGENT_STRIDE + AF.x] as number, y: frame.agents[i * AGENT_STRIDE + AF.y] as number, id: i });
      }
    }
    if (key !== this.deadKey) {
      this.deadKey = key;
      this.structures?.setCairns(dead);
    }
    for (const e of frame.events) {
      if (e.k === "say" && e.a >= 0) this.addBubble(e.a, "say");
      else if (e.k === "give" && e.a >= 0) this.addBubble(e.a, "give");
    }
  }

  // ───────────────────────── loop

  start(): void {
    if (this.running || this.disposed) return;
    this.running = true;
    this.last = performance.now();
    const loop = (now: number) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      const interval = now - this.last;
      const dt = Math.min(0.1, interval / 1000);
      this.last = now;
      // the cadence that reaches the screen, including time the GPU process spent after our calls returned
      this.frameTimes.push(interval);
      if (this.frameTimes.length > 120) this.frameTimes.shift();
      this.renderFrame(dt, now);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  /** Render exactly one frame immediately (used when paused, and by tests). */
  renderOnce(): void {
    this.renderFrame(0.016, performance.now());
  }

  private renderFrame(dt: number, now: number): void {
    const { rig, frame, view, field } = this;
    if (!rig || !view || !field) return;
    this.renderer.info.reset();
    this.time += this.options.reducedMotion ? dt * 0.35 : dt;
    const time = this.time;

    rig.update(dt);

    if (frame) {
      const tickFraction = frame.tps > 0 ? Math.min(1, ((now - this.frameArrival + frame.sinceTickMs) * frame.tps) / 1000) : 0;
      const yearPos = frame.cal.yearPos;
      const light = this.atmosphere!.update(frame.cal.tickOfDay + tickFraction, dayLength(yearPos), yearPos, frame.climate, time, rig.target);
      this.renderer.toneMappingExposure = light.exposure;

      // seasonal ground tint: lush in summer, dormant in winter
      const seasonal = Math.sin(2 * Math.PI * (yearPos - 0.125));
      const autumn = Math.max(0, Math.sin(2 * Math.PI * (yearPos - 0.55)));
      const tu = this.terrain!.uniforms;
      tu.uTime.value = time;
      tu.uSeason.value.set(1 + 0.1 * autumn, 1 + 0.05 * seasonal, 1 - 0.12 * autumn);
      tu.uSeasonMix.value = Math.max(0, Math.min(1, -seasonal * 0.9 + autumn * 0.35));
      tu.uSnow.value = frame.climate.snow / 1000;
      tu.uWet.value = frame.climate.wet / 1000;
      tu.uNight.value = light.night;

      const wu = this.water!.uniforms;
      wu.uTime.value = time;
      wu.uSunDir.value.copy(light.sunDir);
      wu.uSunColor.value.copy(light.sunColor).multiplyScalar(Math.min(1.5, light.sunIntensity * 0.5));
      wu.uSky.value.copy(light.skyColor).multiplyScalar(0.35 + 0.65 * (1 - light.night));
      // water is lit by the same sources as the land so it never glows against a dark shore
      const ambient = Math.min(1.12, 0.42 * light.hemiIntensity + 0.24 * light.sunIntensity + 0.2 * light.moonIntensity);
      wu.uLight.value.copy(light.skyColor).lerp(light.sunColor, 0.5 * (1 - light.night)).multiplyScalar(ambient);
      wu.uNight.value = light.night;
      wu.uRain.value = frame.climate.weather === 2 ? 0.6 : frame.climate.weather === 3 ? 1 : 0;
      wu.uIce.value = frame.climate.temp < -10 ? Math.min(1, (-10 - frame.climate.temp) / 40) : 0;
      (this.terrain!.skirt.material as unknown as { uniforms: Record<string, { value: Color }> }).uniforms.uLight!.value
        .copy(light.skyColor)
        .lerp(light.sunColor, 0.4)
        .multiplyScalar(0.3 * light.hemiIntensity + 0.24 * light.sunIntensity + 0.22 * light.moonIntensity);

      // the table under the plinth follows the room's light: bright by day, a dim blue at night
      const room = 0.34 + 0.66 * (1 - light.night);
      (this.terrain!.floor.material as unknown as { uniforms: Record<string, { value: Color }> }).uniforms.uDim!.value.setRGB(room * (1 - 0.25 * light.night), room * (1 - 0.1 * light.night), room * (1 + 0.25 * light.night));

      this.flora!.uniforms.uTime.value = time;
      this.flora!.uniforms.uWind.value = (frame.climate.weather === 3 ? 2.4 : frame.climate.weather === 2 ? 1.5 : 1) * (this.options.reducedMotion ? 0.25 : 1);
      this.flora!.setSeason(yearPos, frame.climate.snow / 1000);
      this.structures!.uniforms.uTime.value = time;
      this.structures!.animate(time, light.night);
      this.citizens!.update(frame, tickFraction, dt, time);
    }

    this.updateSelection(time);
    this.updateLabels(now);

    if (this.post) {
      // keep the sharp band on the orbit target; blur grows as the camera comes closer
      this.tmp.copy(rig.target).project(rig.camera);
      const focusY = 0.5 + this.tmp.y * 0.5;
      this.post.setMiniature(focusY, 0.06 + 0.94 * rig.closeness(), time);
      this.post.render(dt);
    } else {
      this.renderer.render(this.scene, rig.camera);
    }

    if (this.options.adaptiveResolution !== false) this.adapt(dt, now);
  }

  /** Lower resolution, never fidelity of the simulation, when frames run long. */
  private adapt(dt: number, now: number): void {
    if (dt * 1000 > 42) {
      if (this.slowSince === 0) this.slowSince = now;
      // step the internal resolution down (to 60% at the lowest) rather than drop frames
      if (now - this.slowSince > 3000 && this.pixelRatio > 0.6) {
        this.pixelRatio = Math.max(0.6, this.pixelRatio - 0.2);
        this.slowSince = 0;
        this.applySize();
      }
    } else {
      this.slowSince = 0;
    }
  }

  // ───────────────────────── size & quality

  resize(): void {
    const max = this.options.maxPixelRatio ?? (this.quality === "high" ? 2 : this.quality === "medium" ? 1.5 : 1);
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, max);
    this.applySize();
  }

  private applySize(): void {
    const w = Math.max(1, this.canvas.clientWidth);
    const h = Math.max(1, this.canvas.clientHeight);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(w, h, false);
    this.rig?.resize(w, h);
    this.post?.setSize(w, h, this.pixelRatio);
    this.atmosphere?.configure(this.renderer);
    if (!this.running) this.renderOnce();
  }

  // ───────────────────────── picking

  private toNdc(clientX: number, clientY: number, out: Vector2): Vector2 {
    const rect = this.canvas.getBoundingClientRect();
    return out.set(((clientX - rect.left) / rect.width) * 2 - 1, -(((clientY - rect.top) / rect.height) * 2 - 1));
  }

  private pickAgent(clientX: number, clientY: number): Pick | null {
    const { rig, frame, citizens } = this;
    if (!rig || !frame || !citizens) return null;
    const rect = this.canvas.getBoundingClientRect();
    let best = -1;
    let bestD = Math.max(20, Math.min(46, 1500 / rig.getDistance()));
    const n = Math.min(frame.agentCount, citizens.count());
    for (let i = 0; i < n; i++) {
      if (!citizens.positionOf(i, this.tmp)) continue;
      this.tmp.y += 0.4;
      this.tmp.project(rig.camera);
      if (this.tmp.z > 1) continue;
      const sx = rect.left + (this.tmp.x * 0.5 + 0.5) * rect.width;
      const sy = rect.top + (-this.tmp.y * 0.5 + 0.5) * rect.height;
      const d = Math.hypot(sx - clientX, sy - clientY);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best >= 0 ? { type: "agent", id: best } : null;
  }

  /** Intersect the pointer ray with the height field by marching, then refine. */
  private groundPoint(clientX: number, clientY: number, out: Vector3): boolean {
    const { rig, field } = this;
    if (!rig || !field) return false;
    const ndc = this.toNdc(clientX, clientY, new Vector2());
    const origin = rig.camera.position;
    const dir = this.tmp2.set(ndc.x, ndc.y, 0.5).unproject(rig.camera).sub(origin).normalize();
    let prev = 0;
    const maxT = rig.getDistance() * 3;
    for (let t = 0.5; t < maxT; t += 0.4) {
      const x = origin.x + dir.x * t;
      const y = origin.y + dir.y * t;
      const z = origin.z + dir.z * t;
      const inside = Math.abs(x) <= field.w / 2 && Math.abs(z) <= field.h / 2;
      const ground = inside ? Math.max(0, field.heightAt(x, z)) : -1e9;
      if (inside && y <= ground) {
        let lo = prev;
        let hi = t;
        for (let k = 0; k < 8; k++) {
          const mid = (lo + hi) / 2;
          const my = origin.y + dir.y * mid;
          const mg = Math.max(0, field.heightAt(origin.x + dir.x * mid, origin.z + dir.z * mid));
          if (my <= mg) hi = mid;
          else lo = mid;
        }
        out.set(origin.x + dir.x * hi, origin.y + dir.y * hi, origin.z + dir.z * hi);
        return true;
      }
      prev = t;
    }
    return false;
  }

  pick(clientX: number, clientY: number): Pick | null {
    const agent = this.pickAgent(clientX, clientY);
    if (agent) return agent;
    const { view, field } = this;
    if (!view || !field) return null;
    const p = new Vector3();
    if (!this.groundPoint(clientX, clientY, p)) return null;
    const tx = Math.floor(p.x + view.w / 2);
    const ty = Math.floor(p.z + view.h / 2);
    if (tx < 0 || ty < 0 || tx >= view.w || ty >= view.h) return null;
    const s = this.structureList.find((q) => q.x === tx && q.y === ty);
    if (s) return { type: "structure", id: s.id, x: tx, y: ty };
    for (let n = 0; n < view.nodeKind.length; n++) {
      if (view.nodeX[n] === tx && view.nodeY[n] === ty) return { type: "node", id: n, x: tx, y: ty };
    }
    return { type: "tile", x: tx, y: ty };
  }

  // ───────────────────────── selection, labels, camera

  select(pick: Pick | null): void {
    this.selection = pick;
    if (!pick) this.rig?.follow(null);
    if (!this.running) this.renderOnce();
  }

  private selectionPoint(out: Vector3): boolean {
    const sel = this.selection;
    const { field, view } = this;
    if (!sel || !field || !view) return false;
    if (sel.type === "agent") return this.citizens?.positionOf(sel.id, out) ?? false;
    const c = field.tileCentre(sel.x, sel.y);
    out.set(c.x, field.standAt(c.x, c.z), c.z);
    return true;
  }

  private updateSelection(time: number): void {
    if (!this.selectionPoint(this.tmp)) {
      this.ring.visible = false;
      return;
    }
    this.ring.visible = true;
    const pulse = this.options.reducedMotion ? 1 : 1 + 0.06 * Math.sin(time * 4);
    const size = this.selection?.type === "agent" ? 1 : 1.9;
    this.ring.position.set(this.tmp.x, this.tmp.y + 0.04, this.tmp.z);
    this.ring.scale.setScalar(size * pulse);
  }

  followSelection(on: boolean): void {
    const sel = this.selection;
    if (!this.rig) return;
    if (!on || !sel) {
      this.rig.follow(null);
      return;
    }
    if (sel.type === "agent") {
      const id = sel.id;
      const v = new Vector3();
      this.rig.follow(() => (this.citizens?.positionOf(id, v) ? v : null), 26);
    } else if (this.field) {
      const c = this.field.tileCentre(sel.x, sel.y);
      this.rig.focus(c.x, c.z, 30);
    }
  }

  isFollowing(): boolean {
    return this.rig?.isFollowing() ?? false;
  }

  focusTile(x: number, y: number, distance = 34): void {
    if (!this.field || !this.rig) return;
    const c = this.field.tileCentre(x, y);
    this.rig.focus(c.x, c.z, distance);
  }

  focusAgent(id: number, distance = 30): void {
    if (!this.rig || !this.citizens) return;
    if (this.citizens.positionOf(id, this.tmp)) this.rig.focus(this.tmp.x, this.tmp.z, distance);
  }

  camera(): CameraRig | null {
    return this.rig;
  }

  private addBubble(agent: number, kind: "say" | "give"): void {
    if (!this.overlay) return;
    const existing = this.bubbles.find((b) => b.agent === agent);
    const until = performance.now() + 2600;
    if (existing) {
      existing.until = until;
      existing.el.dataset.kind = kind;
      return;
    }
    if (this.bubbles.length >= 14) return;
    const el = document.createElement("div");
    el.className = "tr-bubble";
    el.dataset.kind = kind;
    el.setAttribute("aria-hidden", "true");
    this.overlay.appendChild(el);
    this.bubbles.push({ el, agent, until });
  }

  /** The name tag element is created by the UI and handed over; the renderer only positions it. */
  setNameTag(el: HTMLElement | null): void {
    this.nameTag = el;
  }

  private place(el: HTMLElement, world: Vector3, lift: number): boolean {
    const rig = this.rig;
    if (!rig) return false;
    this.tmp2.copy(world);
    this.tmp2.y += lift;
    this.tmp2.project(rig.camera);
    if (this.tmp2.z > 1 || Math.abs(this.tmp2.x) > 1.1 || Math.abs(this.tmp2.y) > 1.1) {
      el.style.visibility = "hidden";
      return false;
    }
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    el.style.visibility = "visible";
    el.style.transform = `translate3d(${((this.tmp2.x * 0.5 + 0.5) * w).toFixed(1)}px, ${((-this.tmp2.y * 0.5 + 0.5) * h).toFixed(1)}px, 0) translate(-50%, -100%)`;
    return true;
  }

  private updateLabels(now: number): void {
    if (this.nameTag) {
      if (this.selection?.type === "agent" && this.citizens?.positionOf(this.selection.id, this.tmp)) this.place(this.nameTag, this.tmp, 1.05);
      else this.nameTag.style.visibility = "hidden";
    }
    for (let i = this.bubbles.length - 1; i >= 0; i--) {
      const b = this.bubbles[i]!;
      if (now > b.until || !this.citizens?.positionOf(b.agent, this.tmp)) {
        b.el.remove();
        this.bubbles.splice(i, 1);
        continue;
      }
      this.place(b.el, this.tmp, 0.98);
    }
  }

  /** Where a citizen currently appears on screen, in client pixels (read-only; for tests and labels). */
  screenOf(agent: number): { x: number; y: number } | null {
    const rig = this.rig;
    if (!rig || !this.citizens?.positionOf(agent, this.tmp)) return null;
    this.tmp.y += 0.45;
    this.tmp.project(rig.camera);
    if (this.tmp.z > 1 || Math.abs(this.tmp.x) > 1 || Math.abs(this.tmp.y) > 1) return null;
    const rect = this.canvas.getBoundingClientRect();
    return { x: rect.left + (this.tmp.x * 0.5 + 0.5) * rect.width, y: rect.top + (-this.tmp.y * 0.5 + 0.5) * rect.height };
  }

  // ───────────────────────── stats

  stats(): RenderStats {
    const sorted = this.frameTimes.slice().sort((a, b) => a - b);
    const q = (p: number) => (sorted.length ? (sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] as number) : 0);
    const p50 = q(0.5);
    return {
      fps: p50 > 0 ? Math.round(1000 / p50) : 0,
      frameMsP50: Math.round(p50 * 10) / 10,
      frameMsP95: Math.round(q(0.95) * 10) / 10,
      drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      pixelRatio: this.pixelRatio,
      quality: this.quality,
      renderer: this.glInfo,
    };
  }

  /** Triangles submitted per mesh (instances included), largest first: the render budget, measured. */
  budget(): { name: string; triangles: number; instances: number }[] {
    const rows: { name: string; triangles: number; instances: number }[] = [];
    this.scene.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh || !mesh.visible) return;
      const g = mesh.geometry;
      const per = (g.index ? g.index.count : (g.getAttribute("position")?.count ?? 0)) / 3;
      const instances = (mesh as InstancedMesh).isInstancedMesh ? (mesh as InstancedMesh).count : 1;
      rows.push({ name: mesh.name || mesh.type, triangles: Math.round(per * instances), instances });
    });
    return rows.sort((a, b) => b.triangles - a.triangles);
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
    this.resizeObserver.disconnect();
    this.canvas.removeEventListener("webglcontextlost", this.onContextLost);
    this.clearWorld();
    this.ring.geometry.dispose();
    (this.ring.material as MeshBasicMaterial).dispose();
    this.renderer.dispose();
  }
}
