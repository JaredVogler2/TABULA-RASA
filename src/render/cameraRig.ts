/**
 * Camera rig: orbit, pan and zoom around a point on the ground, with damping, bounds,
 * touch gestures, focus animation and follow mode.
 *
 *   mouse   left-drag pan · right-drag / Alt-drag orbit · wheel zoom
 *   touch   one finger pan · pinch zoom · two-finger twist orbit · two-finger vertical drag tilt
 *
 * While someone is followed the rig looks at them. Moving the view across the ground lets go of them
 * (the observer has said where they would rather look); zooming, turning and tilting do not, because
 * none of them looks anywhere else. They used to: a pinch to see the person followed more closely
 * ended the follow without a word.
 */
import { PerspectiveCamera, Vector3 } from "three";
import type { HeightField } from "./heightfield";

export interface RigOptions {
  reducedMotion: boolean;
  onTap(clientX: number, clientY: number): void;
  onHover(clientX: number, clientY: number): void;
  onUserMove(): void;
}

const MIN_DIST = 7;
const MIN_POLAR = 0.32; // from vertical
const MAX_POLAR = 1.36;

export class CameraRig {
  readonly camera: PerspectiveCamera;
  readonly target = new Vector3();
  private want = new Vector3();
  private distance = 92;
  private wantDistance = 92;
  private azimuth = 0.62;
  private wantAzimuth = 0.62;
  private polar = 0.92;
  private wantPolar = 0.92;
  private maxDist: number;
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private dragMode: "none" | "pan" | "orbit" = "none";
  private downAt = { x: 0, y: 0, t: 0 };
  private moved = 0;
  private pinch = { dist: 0, angle: 0, midY: 0 };
  private followFn: (() => Vector3 | null) | null = null;
  private autoOrbit = 0;
  /**
   * How much of the picture the interface covers from the top and from the bottom, in CSS pixels.
   * What the rig looks at is drawn at the middle of what is left, not at the middle of the canvas:
   * on a phone the inspector is a sheet over the lower half of the map, and a citizen held at the
   * middle of the canvas was held behind it.
   */
  private readonly inset = { top: 0, bottom: 0 };
  private readonly wantInset = { top: 0, bottom: 0 };
  private readonly size = { w: 1, h: 1 };
  private readonly cleanup: (() => void)[] = [];

  constructor(
    private readonly dom: HTMLElement,
    private readonly field: HeightField,
    private readonly options: RigOptions,
  ) {
    this.camera = new PerspectiveCamera(30, 1, 1, 900);
    this.maxDist = Math.max(field.w, field.h) * 2.4;
    this.wantDistance = this.distance = Math.max(field.w, field.h) * 1.95;
    this.place();
    this.bind();
  }

  private bind(): void {
    const dom = this.dom;
    const on = <K extends keyof HTMLElementEventMap>(type: K, fn: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      dom.addEventListener(type, fn as EventListener, opts);
      this.cleanup.push(() => dom.removeEventListener(type, fn as EventListener, opts));
    };
    on("contextmenu", (e) => e.preventDefault());
    on("pointerdown", (e) => {
      dom.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 1) {
        this.downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
        this.moved = 0;
        this.dragMode = e.button === 2 || e.altKey || e.ctrlKey || e.metaKey ? "orbit" : "pan";
      } else if (this.pointers.size === 2) {
        this.startPinch();
        this.moved = 99;
      }
    });
    on("pointermove", (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) {
        if (e.pointerType === "mouse") this.options.onHover(e.clientX, e.clientY);
        return;
      }
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      if (this.pointers.size === 1) {
        this.moved += Math.abs(dx) + Math.abs(dy);
        if (this.moved < 5) return;
        if (this.dragMode === "orbit") {
          this.userTurned();
          this.wantAzimuth -= dx * 0.0052;
          this.wantPolar = clamp(this.wantPolar - dy * 0.004, MIN_POLAR, MAX_POLAR);
        } else {
          this.userMoved();
          this.panPixels(dx, dy);
        }
      } else if (this.pointers.size === 2) {
        this.userTurned();
        this.updatePinch();
      }
    });
    const end = (e: PointerEvent) => {
      const had = this.pointers.delete(e.pointerId);
      if (!had) return;
      if (this.pointers.size === 0) {
        const quick = performance.now() - this.downAt.t < 450;
        if (this.moved < 7 && quick) this.options.onTap(e.clientX, e.clientY);
        this.dragMode = "none";
      } else if (this.pointers.size === 1) {
        this.moved = 99; // the remaining finger must not register as a tap
      }
    };
    on("pointerup", end);
    on("pointercancel", end);
    on(
      "wheel",
      (e) => {
        e.preventDefault();
        this.userTurned();
        const k = Math.exp(clamp(e.deltaY, -120, 120) * 0.0014);
        this.wantDistance = clamp(this.wantDistance * k, MIN_DIST, this.maxDist);
      },
      { passive: false },
    );
  }

  /** The observer moved the view across the ground: whoever was followed is let go. */
  private userMoved(): void {
    this.followFn = null;
    this.autoOrbit = 0;
    this.options.onUserMove();
  }

  /** The observer zoomed, turned or tilted the view: it stays on what it is on, and on whoever is followed. */
  private userTurned(): void {
    this.autoOrbit = 0;
  }

  private startPinch(): void {
    const [a, b] = [...this.pointers.values()];
    if (!a || !b) return;
    this.pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), angle: Math.atan2(b.y - a.y, b.x - a.x), midY: (a.y + b.y) / 2 };
  }

  private updatePinch(): void {
    const [a, b] = [...this.pointers.values()];
    if (!a || !b) return;
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    const midY = (a.y + b.y) / 2;
    if (this.pinch.dist > 0 && dist > 0) this.wantDistance = clamp((this.wantDistance * this.pinch.dist) / dist, MIN_DIST, this.maxDist);
    let da = angle - this.pinch.angle;
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    this.wantAzimuth -= da;
    this.wantPolar = clamp(this.wantPolar - (midY - this.pinch.midY) * 0.005, MIN_POLAR, MAX_POLAR);
    this.pinch = { dist, angle, midY };
  }

  /** Pan so that the ground appears to stick to the pointer. */
  panPixels(dx: number, dy: number): void {
    const height = this.dom.clientHeight || 1;
    const worldPerPixel = (2 * this.distance * Math.tan((this.camera.fov * Math.PI) / 360)) / height;
    const sin = Math.sin(this.azimuth);
    const cos = Math.cos(this.azimuth);
    // screen right is (cos, 0, -sin); screen "up the ground" is (−sin, 0, −cos), stretched by the tilt
    const forward = (dy * worldPerPixel) / Math.max(0.35, Math.cos(this.polar));
    const right = dx * worldPerPixel;
    this.want.x += -right * cos - forward * sin;
    this.want.z += right * sin - forward * cos;
    this.clampTarget();
  }

  private clampTarget(): void {
    const hx = this.field.w / 2 + 2;
    const hz = this.field.h / 2 + 2;
    this.want.x = clamp(this.want.x, -hx, hx);
    this.want.z = clamp(this.want.z, -hz, hz);
  }

  /** Programmatic controls (keyboard and buttons). */
  nudge(dx: number, dz: number): void {
    this.userMoved();
    this.panPixels(dx, dz);
  }
  rotate(delta: number): void {
    this.userTurned();
    this.wantAzimuth += delta;
  }
  tilt(delta: number): void {
    this.userTurned();
    this.wantPolar = clamp(this.wantPolar + delta, MIN_POLAR, MAX_POLAR);
  }
  zoom(factor: number): void {
    this.userTurned();
    this.wantDistance = clamp(this.wantDistance * factor, MIN_DIST, this.maxDist);
  }

  focus(x: number, z: number, distance?: number): void {
    this.followFn = null;
    this.want.set(x, 0, z);
    this.clampTarget();
    if (distance !== undefined) this.wantDistance = clamp(distance, MIN_DIST, this.maxDist);
  }

  follow(fn: (() => Vector3 | null) | null, distance?: number): void {
    this.followFn = fn;
    if (fn && distance !== undefined) this.wantDistance = clamp(Math.min(this.wantDistance, distance), MIN_DIST, this.maxDist);
  }

  isFollowing(): boolean {
    return this.followFn !== null;
  }

  /** Tell the rig what the interface covers (CSS pixels from the top and from the bottom of the canvas). */
  setInsets(top: number, bottom: number, snap = false): void {
    this.wantInset.top = Math.max(0, top);
    this.wantInset.bottom = Math.max(0, bottom);
    if (snap || this.options.reducedMotion) {
      this.inset.top = this.wantInset.top;
      this.inset.bottom = this.wantInset.bottom;
      this.applyInsets();
    }
  }

  /** Where, in CSS pixels from the top of the canvas, the point the rig looks at is drawn. */
  focusY(): number {
    return this.size.h / 2 + this.shift();
  }

  /** How far down the picture is moved so that its middle falls in the middle of what is not covered. */
  private shift(): number {
    // never so far that the middle would leave the canvas, whatever it is told
    const most = this.size.h * 0.4;
    return clamp((this.inset.top - this.inset.bottom) / 2, -most, most);
  }

  private applyInsets(): void {
    const dy = this.shift();
    if (Math.abs(dy) < 0.5) this.camera.clearViewOffset();
    // the canvas shows a window of the same size on a picture moved by `dy`: the same lens, looked through off-centre
    else this.camera.setViewOffset(this.size.w, this.size.h, 0, -dy, this.size.w, this.size.h);
  }

  setAutoOrbit(speed: number): void {
    this.autoOrbit = this.options.reducedMotion ? 0 : speed;
  }

  setView(azimuth: number, polar: number, distance: number, snap = false): void {
    this.wantAzimuth = azimuth;
    this.wantPolar = clamp(polar, MIN_POLAR, MAX_POLAR);
    this.wantDistance = clamp(distance, MIN_DIST, this.maxDist);
    if (snap) {
      this.azimuth = this.wantAzimuth;
      this.polar = this.wantPolar;
      this.distance = this.wantDistance;
      this.target.copy(this.want);
      this.place();
    }
  }

  /** 0 when fully zoomed out … 1 when closest. */
  closeness(): number {
    return 1 - clamp((this.distance - MIN_DIST) / (this.maxDist * 0.6 - MIN_DIST), 0, 1);
  }

  getDistance(): number {
    return this.distance;
  }

  resize(width: number, height: number): void {
    this.size.w = Math.max(1, width);
    this.size.h = Math.max(1, height);
    this.camera.aspect = width / Math.max(1, height);
    // keep the whole island in view on tall, narrow screens
    this.camera.fov = this.camera.aspect < 0.8 ? 40 : this.camera.aspect < 1.2 ? 34 : 30;
    this.camera.updateProjectionMatrix();
    this.applyInsets();
  }

  update(dt: number): void {
    if (this.followFn) {
      const p = this.followFn();
      if (p) {
        this.want.x = p.x;
        this.want.z = p.z;
      } else {
        this.followFn = null;
      }
    }
    if (this.autoOrbit !== 0) this.wantAzimuth += this.autoOrbit * dt;
    const snap = this.options.reducedMotion;
    const k = snap ? 1 : 1 - Math.exp(-dt * 7.5);
    this.target.x += (this.want.x - this.target.x) * k;
    this.target.z += (this.want.z - this.target.z) * k;
    const ground = Math.max(0, this.field.heightAt(this.target.x, this.target.z));
    this.target.y += (ground - this.target.y) * (snap ? 1 : 1 - Math.exp(-dt * 4));
    this.distance += (this.wantDistance - this.distance) * k;
    this.azimuth += (this.wantAzimuth - this.azimuth) * k;
    this.polar += (this.wantPolar - this.polar) * k;
    if (this.inset.top !== this.wantInset.top || this.inset.bottom !== this.wantInset.bottom) {
      const ease = (from: number, to: number): number => (Math.abs(to - from) < 0.5 ? to : from + (to - from) * k);
      this.inset.top = ease(this.inset.top, this.wantInset.top);
      this.inset.bottom = ease(this.inset.bottom, this.wantInset.bottom);
      this.applyInsets();
    }
    this.place();
  }

  private place(): void {
    const sinP = Math.sin(this.polar);
    const cosP = Math.cos(this.polar);
    const x = this.target.x + this.distance * sinP * Math.sin(this.azimuth);
    const z = this.target.z + this.distance * sinP * Math.cos(this.azimuth);
    let y = this.target.y + this.distance * cosP;
    // never let the camera sink into a hillside
    const floor = this.field.heightAt(clamp(x, -this.field.w / 2, this.field.w / 2), clamp(z, -this.field.h / 2, this.field.h / 2)) + 1.2;
    if (Math.abs(x) < this.field.w / 2 && Math.abs(z) < this.field.h / 2 && y < floor) y = floor;
    this.camera.position.set(x, y, z);
    this.camera.near = Math.max(0.3, this.distance * 0.04);
    this.camera.far = this.distance + 700;
    this.camera.lookAt(this.target);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
  }

  dispose(): void {
    for (const fn of this.cleanup) fn();
    this.cleanup.length = 0;
    this.pointers.clear();
  }
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}
