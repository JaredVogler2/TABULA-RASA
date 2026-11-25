/**
 * Soundscape: procedural ambience and event cues, synthesized in the browser.
 *
 * Nothing is recorded or bundled: wind, surf, rain, birds, crickets, fire, a quiet pad and
 * the cue tones are all made from oscillators and one buffer of noise. What is heard follows
 * what the simulation and the camera say — the weather, the hour, the season, whether a lit
 * fire is near the point being looked at, whether time is running — and never the reverse:
 * sound reads state and changes nothing.
 *
 * No sound is made until `enable()` is called from a user gesture (browsers require it, and
 * so does good manners).
 */

export interface SoundLevels {
  /** Each 0..1. */
  master: number;
  ambience: number;
  music: number;
  cues: number;
}

export const DEFAULT_LEVELS: SoundLevels = { master: 0.7, ambience: 0.8, music: 0.3, cues: 0.7 };

/** What the world sounds like right now, as read from the latest frame and the camera. */
export interface Ambience {
  /** 0 clear · 1 overcast · 2 rain · 3 storm · 4 snow */
  weather: number;
  /** 0 (night) .. 1 (full day) */
  daylight: number;
  /** 0 spring · 1 summer · 2 autumn · 3 winter */
  season: number;
  /** 0..1: a lit fire close to what the camera is looking at */
  fire: number;
  /** 0..1: how near the camera's focus is to the sea */
  shore: number;
  /** 0 (whole island in view) .. 1 (close to the ground) */
  closeness: number;
  /** Whether simulated time is passing. */
  running: boolean;
}

export type Cue = "ratified" | "dissolved" | "death" | "arrival" | "built" | "fork" | "season";

const SILENT: Ambience = { weather: 0, daylight: 1, season: 0, fire: 0, shore: 0.5, closeness: 0, running: false };

/** Pentatonic clusters on D (Hz), low to high: the pad chooses among them by time of day. */
const CHORDS: readonly (readonly number[])[] = [
  [146.83, 220.0, 293.66],
  [164.81, 220.0, 329.63],
  [196.0, 293.66, 392.0],
  [146.83, 246.94, 369.99],
  [220.0, 329.63, 440.0],
  [130.81, 196.0, 293.66],
];

export class Soundscape {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private ambienceBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private cueBus: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private wind: GainNode | null = null;
  private windBand: BiquadFilterNode | null = null;
  private surf: GainNode | null = null;
  private rain: GainNode | null = null;
  private roar: GainNode | null = null;
  private crackle: GainNode | null = null;
  private crickets: GainNode | null = null;
  private sources: AudioScheduledSourceNode[] = [];
  private levels: SoundLevels = { ...DEFAULT_LEVELS };
  private state: Ambience = SILENT;
  private lastUpdate = 0;
  private nextChord = 0;
  private nextThunder = 0;
  private chord = 0;
  private enabled = false;
  private meter: Float32Array<ArrayBuffer> | null = null;
  /** A small deterministic generator: variety without touching Math.random's global stream in tests. */
  private seed = 0x2f6e2b1;

  private rnd(): number {
    let x = this.seed;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.seed = x | 0;
    return ((x >>> 0) % 100000) / 100000;
  }

  isEnabled(): boolean {
    return this.enabled && this.ctx?.state === "running";
  }

  /** Must be called from a user gesture. Resolves false where audio is not available. */
  async enable(): Promise<boolean> {
    try {
      if (!this.ctx) this.build();
      if (!this.ctx) return false;
      if (this.ctx.state !== "running") await this.ctx.resume();
      this.enabled = this.ctx.state === "running";
      this.applyLevels(0.4);
      return this.enabled;
    } catch {
      this.enabled = false;
      return false;
    }
  }

  /**
   * Stop making sound while nobody can be listening (the tab is hidden), and take it up again
   * afterwards — only if it was on: this never starts sound that was not asked for.
   */
  hush(on: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !this.enabled) return;
    if (on && ctx.state === "running") void ctx.suspend().catch(() => undefined);
    else if (!on && ctx.state === "suspended") void ctx.resume().catch(() => undefined);
  }

  disable(): void {
    this.enabled = false;
    if (this.ctx && this.master) this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.08);
    const ctx = this.ctx;
    if (ctx) setTimeout(() => void (this.enabled ? null : ctx.suspend().catch(() => undefined)), 400);
  }

  setLevels(levels: Partial<SoundLevels>): void {
    this.levels = { ...this.levels, ...levels };
    this.applyLevels(0.08);
  }

  private applyLevels(timeConstant: number): void {
    const { ctx, master, ambienceBus, musicBus, cueBus } = this;
    if (!ctx || !master || !ambienceBus || !musicBus || !cueBus) return;
    const t = ctx.currentTime;
    master.gain.setTargetAtTime(this.enabled ? clamp01(this.levels.master) : 0, t, timeConstant);
    ambienceBus.gain.setTargetAtTime(clamp01(this.levels.ambience), t, timeConstant);
    musicBus.gain.setTargetAtTime(clamp01(this.levels.music), t, timeConstant);
    cueBus.gain.setTargetAtTime(clamp01(this.levels.cues), t, timeConstant);
  }

  private build(): void {
    const Ctor = typeof window === "undefined" ? undefined : (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;
    const master = ctx.createGain();
    master.gain.value = 0;
    // a gentle limiter so that a storm with a fire and a cue can never clip
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.knee.value = 12;
    limiter.ratio.value = 8;
    limiter.attack.value = 0.005;
    limiter.release.value = 0.25;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    master.connect(limiter).connect(analyser).connect(ctx.destination);
    this.master = master;
    this.analyser = analyser;
    this.meter = new Float32Array(new ArrayBuffer(analyser.fftSize * 4));
    const bus = (): GainNode => {
      const g = ctx.createGain();
      g.connect(master);
      return g;
    };
    this.ambienceBus = bus();
    this.musicBus = bus();
    this.cueBus = bus();

    // one buffer of noise feeds every weather voice
    const seconds = 3;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = this.rnd() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;
    noise.start();
    this.sources.push(noise);

    const lfo = (hz: number, depth: number, to: AudioParam): void => {
      const o = ctx.createOscillator();
      o.frequency.value = hz;
      const g = ctx.createGain();
      g.gain.value = depth;
      o.connect(g).connect(to);
      o.start();
      this.sources.push(o);
    };
    const voice = (...filters: BiquadFilterNode[]): GainNode => {
      let node: AudioNode = noise;
      for (const f of filters) {
        node.connect(f);
        node = f;
      }
      const g = ctx.createGain();
      g.gain.value = 0;
      node.connect(g).connect(this.ambienceBus!);
      return g;
    };
    const filter = (type: BiquadFilterType, hz: number, q = 0.7): BiquadFilterNode => {
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = hz;
      f.Q.value = q;
      return f;
    };

    // wind: a band of noise whose centre wanders
    this.windBand = filter("bandpass", 480, 0.55);
    this.wind = voice(this.windBand);
    lfo(0.07, 190, this.windBand.frequency);
    // surf: low noise that swells
    const surfTone = filter("lowpass", 430, 0.4);
    const swell = ctx.createGain();
    swell.gain.value = 0.6;
    noise.connect(surfTone).connect(swell);
    lfo(0.11, 0.4, swell.gain);
    this.surf = ctx.createGain();
    this.surf.gain.value = 0;
    swell.connect(this.surf).connect(this.ambienceBus);
    // rain: the bright end of the noise
    this.rain = voice(filter("highpass", 1700, 0.5), filter("lowpass", 7600, 0.5));
    // fire: a low roar, and crackles scheduled as short bursts
    this.roar = voice(filter("lowpass", 230, 0.6));
    this.crackle = voice(filter("bandpass", 2100, 1.4));
    // crickets: two pulsed high tones
    this.crickets = ctx.createGain();
    this.crickets.gain.value = 0;
    this.crickets.connect(this.ambienceBus);
    for (const [hz, pulse, gate] of [[4300, 31, 0.9], [4720, 27, 0.63]] as const) {
      const o = ctx.createOscillator();
      o.frequency.value = hz;
      const am = ctx.createGain();
      am.gain.value = 0.5;
      lfo(pulse, 0.5, am.gain);
      const breathe = ctx.createGain();
      breathe.gain.value = 0.5;
      lfo(gate, 0.5, breathe.gain);
      o.connect(am).connect(breathe).connect(this.crickets);
      o.start();
      this.sources.push(o);
    }
  }

  /** Call a few times a second with the latest state; it schedules what the next moments sound like. */
  update(state: Ambience): void {
    this.state = state;
    const ctx = this.ctx;
    if (!ctx || !this.enabled || ctx.state !== "running") return;
    const now = ctx.currentTime;
    const dt = Math.min(1, Math.max(0, now - this.lastUpdate));
    this.lastUpdate = now;
    const calm = state.running ? 1 : 0.4;
    const wet = state.weather === 2 ? 0.55 : state.weather === 3 ? 1 : 0;
    const gust = state.weather === 3 ? 0.85 : state.weather === 2 ? 0.4 : state.weather === 1 ? 0.28 : state.weather === 4 ? 0.22 : 0.16;
    const far = 1 - state.closeness;
    const set = (g: GainNode | null, v: number, tc = 0.6): void => {
      g?.gain.setTargetAtTime(Math.max(0, v), now, tc);
    };
    set(this.wind, gust * (0.5 + 0.5 * far) * 0.5 * calm);
    set(this.surf, (0.1 + 0.3 * state.shore + 0.12 * far) * calm);
    set(this.rain, wet * 0.3 * calm);
    set(this.roar, state.fire * 0.5 * calm, 0.3);
    const warm = state.season === 1 ? 1 : state.season === 0 || state.season === 2 ? 0.6 : 0;
    const night = 1 - state.daylight;
    set(this.crickets, night * warm * (1 - wet) * 0.012 * (0.4 + 0.6 * state.closeness) * calm, 1.5);

    if (state.running) {
      // birds by day, fewer in rain and in winter
      const birds = state.daylight * (1 - wet * 0.85) * (state.season === 3 ? 0.25 : 1) * (state.weather === 4 ? 0.3 : 1);
      if (this.rnd() < birds * dt * 0.9) this.chirp(now + this.rnd() * 0.2);
      // crackles: a few a second when a fire is close
      const pops = Math.floor(state.fire * dt * 9 + this.rnd());
      for (let i = 0; i < pops; i++) this.pop(now + this.rnd() * dt, state.fire);
      if (state.weather === 3 && now > this.nextThunder) {
        this.nextThunder = now + 14 + this.rnd() * 26;
        this.thunder(now + 0.2);
      }
      if (now > this.nextChord) {
        this.nextChord = now + 13 + this.rnd() * 9;
        this.pad(now + 0.1);
      }
    }
  }

  private chirp(at: number): void {
    const { ctx, ambienceBus } = this;
    if (!ctx || !ambienceBus) return;
    const notes = 2 + Math.floor(this.rnd() * 4);
    const base = 2600 + this.rnd() * 2400;
    const pan = ctx.createStereoPanner();
    pan.pan.value = this.rnd() * 1.6 - 0.8;
    const out = ctx.createGain();
    out.gain.value = 0.035 + this.rnd() * 0.03;
    pan.connect(out).connect(ambienceBus);
    let t = at;
    for (let n = 0; n < notes; n++) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const f = base * (0.85 + this.rnd() * 0.4);
      const len = 0.05 + this.rnd() * 0.07;
      o.frequency.setValueAtTime(f, t);
      o.frequency.exponentialRampToValueAtTime(f * (this.rnd() < 0.5 ? 1.35 : 0.72), t + len);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(1, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.001, t + len);
      o.connect(g).connect(pan);
      o.start(t);
      o.stop(t + len + 0.02);
      t += len + 0.02 + this.rnd() * 0.06;
    }
  }

  private pop(at: number, strength: number): void {
    const { ctx, crackle } = this;
    if (!ctx || !crackle) return;
    const peak = (0.2 + this.rnd() * 0.8) * strength * 0.9;
    crackle.gain.setValueAtTime(0, at);
    crackle.gain.linearRampToValueAtTime(peak, at + 0.002);
    crackle.gain.exponentialRampToValueAtTime(0.0008, at + 0.012 + this.rnd() * 0.03);
  }

  private thunder(at: number): void {
    const { ctx, ambienceBus } = this;
    if (!ctx || !ambienceBus) return;
    const len = 2.6 + this.rnd() * 1.6;
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * len), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let low = 0;
    for (let i = 0; i < data.length; i++) {
      // brown-ish noise with a rolling envelope
      low = low * 0.985 + (this.rnd() * 2 - 1) * 0.12;
      const k = i / data.length;
      data[i] = low * Math.exp(-k * 3.2) * (0.6 + 0.4 * Math.sin(k * 23));
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const g = ctx.createGain();
    g.gain.value = 0.9;
    const tone = ctx.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = 180;
    src.connect(tone).connect(g).connect(ambienceBus);
    src.start(at);
  }

  private pad(at: number): void {
    const { ctx, musicBus } = this;
    if (!ctx || !musicBus) return;
    // by day the higher clusters, at night the lower; never the same twice running
    const night = 1 - this.state.daylight;
    let pick = Math.floor(this.rnd() * 3) + (night > 0.5 ? 3 : 0);
    if (pick === this.chord) pick = (pick + 1) % CHORDS.length;
    this.chord = pick;
    const notes = CHORDS[pick]!;
    const tone = ctx.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = 520 + 420 * this.state.daylight;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0, at);
    out.gain.linearRampToValueAtTime(0.11, at + 4.5);
    out.gain.setTargetAtTime(0, at + 9, 3.2);
    tone.connect(out).connect(musicBus);
    for (let i = 0; i < notes.length; i++) {
      for (const detune of [-5, 6]) {
        const o = ctx.createOscillator();
        o.type = "triangle";
        o.frequency.value = notes[i]! * (night > 0.6 ? 0.5 : 1);
        o.detune.value = detune + this.rnd() * 3;
        const g = ctx.createGain();
        g.gain.value = i === 0 ? 0.5 : 0.32;
        o.connect(g).connect(tone);
        o.start(at);
        o.stop(at + 24);
      }
    }
  }

  /** A short tone for something that happened in the world. */
  cue(kind: Cue): void {
    const { ctx, cueBus } = this;
    if (!ctx || !cueBus || !this.enabled || ctx.state !== "running") return;
    const t = ctx.currentTime + 0.02;
    const bell = (hz: number, at: number, gain: number, decay: number): void => {
      for (const [mult, level] of [[1, 1], [2.01, 0.32], [3.02, 0.12]] as const) {
        const o = ctx.createOscillator();
        o.frequency.value = hz * mult;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, at);
        g.gain.linearRampToValueAtTime(gain * level, at + 0.008);
        g.gain.exponentialRampToValueAtTime(0.0006, at + decay / mult);
        o.connect(g).connect(cueBus);
        o.start(at);
        o.stop(at + decay + 0.1);
      }
    };
    switch (kind) {
      case "ratified":
        bell(587.33, t, 0.22, 1.8);
        bell(880.0, t + 0.16, 0.2, 2.2);
        break;
      case "dissolved":
        bell(880.0, t, 0.16, 1.4);
        bell(587.33, t + 0.18, 0.18, 2.0);
        break;
      case "death":
        bell(146.83, t, 0.3, 3.4);
        break;
      case "arrival":
        bell(440.0, t, 0.14, 1.1);
        bell(554.37, t + 0.11, 0.14, 1.1);
        bell(659.25, t + 0.22, 0.14, 1.5);
        break;
      case "built":
        bell(392.0, t, 0.14, 0.9);
        break;
      case "fork":
        bell(196.0, t, 0.26, 2.2);
        bell(293.66, t + 0.05, 0.16, 2.4);
        break;
      case "season":
        bell(659.25, t, 0.1, 2.6);
        break;
    }
  }

  /** Root-mean-square level of what is being sent to the speakers right now (0 when silent or off). */
  level(): number {
    const { analyser, meter } = this;
    if (!analyser || !meter || !this.isEnabled()) return 0;
    analyser.getFloatTimeDomainData(meter);
    let sum = 0;
    for (let i = 0; i < meter.length; i++) sum += (meter[i] as number) * (meter[i] as number);
    return Math.sqrt(sum / meter.length);
  }

  dispose(): void {
    this.enabled = false;
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {
        // already stopped
      }
    }
    this.sources = [];
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
  }
}

function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
}
