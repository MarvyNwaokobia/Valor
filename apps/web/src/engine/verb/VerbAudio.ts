/**
 * Placeholder synth voices for the Verb graybox (CLONE_PLAN.md slice 1).
 *
 * Pure WebAudio, zero samples — same approach that voices the guns
 * (CombatAudio.playGunshot). These are throwaway sketches that let the feel
 * gate run muted-or-not; slice 2's AudioDirector replaces them with the real
 * impact stack. The one sound designed with intent already is the CATCH:
 * sub thump + mid slap + metallic ring, because the catch is the signature
 * beat everything else will be tuned around.
 *
 * The recall whistle is continuous: start on recallStart, feed it progress
 * every frame (pitch rises as the Edge closes in), kill it at the catch.
 */
export class VerbAudio {
  private ctx: AudioContext | null = null;
  private master: DynamicsCompressorNode | null = null;
  private whistleOsc: OscillatorNode | null = null;
  private whistleGain: GainNode | null = null;

  private get audio(): { ctx: AudioContext; out: AudioNode } | null {
    try {
      if (!this.ctx) {
        const Ctor = window.AudioContext
          ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return null;
        this.ctx = new Ctor();
        this.master = this.ctx.createDynamicsCompressor();
        this.master.threshold.value = -18;
        this.master.ratio.value = 6;
        this.master.connect(this.ctx.destination);
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return { ctx: this.ctx, out: this.master! };
    } catch {
      return null;
    }
  }

  dispose() {
    this.stopWhistle();
    void this.ctx?.close();
    this.ctx = null;
    this.master = null;
  }

  // ── One-shots ──────────────────────────────────────────────────────────────

  /** Heavy blade leaving the hand: low whoosh that falls away. */
  throw_() {
    this.noiseSweep(900, 300, 0.22, 0.4);
    this.sine(140, 90, 0.12, 0.15);
  }

  /** Blade buries in wood/stone: dead low thunk + splinter tick. */
  embedWorld() {
    this.sine(120, 44, 0.16, 0.5);
    this.noiseSweep(2400, 900, 0.05, 0.25);
  }

  /** Blade buries in a body: same weight, wetter mid. */
  embedFlesh() {
    this.sine(150, 55, 0.14, 0.55);
    this.noiseSweep(700, 350, 0.09, 0.35);
  }

  /** The rip as the blade tears free at recall start. */
  rip() {
    this.noiseSweep(500, 1600, 0.09, 0.3);
  }

  /** Blade clips a body on the return arc. */
  recallSweepHit() {
    this.sine(180, 80, 0.08, 0.35);
    this.noiseSweep(1200, 500, 0.05, 0.25);
  }

  /**
   * THE sound. Sub punch you feel, mid slap you hear, and a short metallic
   * ring so the blade reads as steel seating into a grip.
   */
  catch_() {
    this.sine(95, 36, 0.24, 0.9);          // chest
    this.sine(240, 100, 0.08, 0.4);        // knuckle
    this.noiseSweep(1800, 700, 0.04, 0.35); // slap
    this.ring(1320, 0.3, 0.08);            // steel
    this.ring(1980, 0.22, 0.05);
  }

  meleeWhiff(stage: number) {
    this.noiseSweep(1400 + stage * 200, 500, 0.1, 0.18);
  }

  meleeHit(stage: number, buffed: boolean) {
    const big = stage === 3 || buffed;
    this.sine(big ? 170 : 200, big ? 48 : 70, big ? 0.14 : 0.09, big ? 0.7 : 0.45);
    this.noiseSweep(1000, 400, 0.05, 0.3);
    if (big) this.sine(70, 34, 0.2, 0.6);
  }

  dash() {
    this.noiseSweep(600, 1800, 0.12, 0.2);
  }

  death() {
    this.sine(110, 30, 0.3, 0.6);
  }

  // ── Recall whistle (continuous) ────────────────────────────────────────────

  startWhistle() {
    const a = this.audio;
    if (!a) return;
    this.stopWhistle();
    this.whistleOsc = a.ctx.createOscillator();
    this.whistleOsc.type = 'sawtooth';
    this.whistleOsc.frequency.value = 300;
    const bp = a.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900;
    bp.Q.value = 6;
    this.whistleGain = a.ctx.createGain();
    this.whistleGain.gain.value = 0.0001;
    this.whistleOsc.connect(bp).connect(this.whistleGain).connect(a.out);
    this.whistleOsc.start();
  }

  /** p = 0..1 recall progress: pitch and level rise as the Edge closes in. */
  setWhistleProgress(p: number) {
    if (!this.whistleOsc || !this.whistleGain || !this.ctx) return;
    const t = this.ctx.currentTime;
    this.whistleOsc.frequency.setTargetAtTime(300 + p * p * 900, t, 0.02);
    this.whistleGain.gain.setTargetAtTime(0.02 + p * 0.14, t, 0.03);
  }

  stopWhistle() {
    try {
      this.whistleOsc?.stop();
      this.whistleOsc?.disconnect();
      this.whistleGain?.disconnect();
    } catch {}
    this.whistleOsc = null;
    this.whistleGain = null;
  }

  // ── Building blocks ────────────────────────────────────────────────────────

  private sine(f0: number, f1: number, dur: number, vol: number) {
    const a = this.audio;
    if (!a) return;
    try {
      const now = a.ctx.currentTime;
      const osc = a.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f0, now);
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), now + dur);
      const g = a.ctx.createGain();
      g.gain.setValueAtTime(vol, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + dur + 0.02);
      osc.connect(g).connect(a.out);
      osc.start(now);
      osc.stop(now + dur + 0.03);
    } catch {}
  }

  private noiseSweep(f0: number, f1: number, dur: number, vol: number) {
    const a = this.audio;
    if (!a) return;
    try {
      const now = a.ctx.currentTime;
      const buf = a.ctx.createBuffer(1, Math.max(1, Math.floor(a.ctx.sampleRate * dur)), a.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
      const src = a.ctx.createBufferSource();
      src.buffer = buf;
      const bp = a.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 1.2;
      bp.frequency.setValueAtTime(f0, now);
      bp.frequency.exponentialRampToValueAtTime(Math.max(40, f1), now + dur);
      const g = a.ctx.createGain();
      g.gain.setValueAtTime(vol, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + dur + 0.01);
      src.connect(bp).connect(g).connect(a.out);
      src.start(now);
      src.stop(now + dur + 0.02);
    } catch {}
  }

  /** Short resonant metallic partial (the steel in the catch). */
  private ring(freq: number, dur: number, vol: number) {
    const a = this.audio;
    if (!a) return;
    try {
      const now = a.ctx.currentTime;
      const osc = a.ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      const g = a.ctx.createGain();
      g.gain.setValueAtTime(vol, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + dur);
      osc.connect(g).connect(a.out);
      osc.start(now);
      osc.stop(now + dur + 0.02);
    } catch {}
  }
}
