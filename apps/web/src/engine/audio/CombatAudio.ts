import { Howl, Howler } from 'howler';
import type { DamageEvent } from '../combat/DamageSystem';

interface SoundBank {
  sounds: Howl[];
  volume: number;
}

function loadBank(paths: string[], volume = 1): SoundBank {
  return {
    sounds: paths.map(
      (src) => new Howl({ src: [src], preload: true, volume })
    ),
    volume,
  };
}

function playOne(bank: SoundBank, pitchVariation = 0.08): number | undefined {
  if (bank.sounds.length === 0) return;
  const sound = bank.sounds[Math.floor(Math.random() * bank.sounds.length)];
  const rate = 1 + (Math.random() - 0.5) * pitchVariation * 2;
  sound.rate(rate);
  sound.volume(bank.volume);
  return sound.play();
}

export class CombatAudio {
  private whoosh: SoundBank;
  private punchHit: SoundBank;
  private slashHit: SoundBank;
  private blockHit: SoundBank;
  private bodyFall: SoundBank;
  private stopped = false;

  constructor() {
    this.whoosh = loadBank([
      '/sounds/combat/whoosh_802462.mp3',
      '/sounds/combat/whoosh_768408.mp3',
    ], 0.3);

    this.punchHit = loadBank([
      '/sounds/combat/punch_276600.mp3',
      '/sounds/combat/punch_847837.mp3',
    ], 0.8);

    this.slashHit = loadBank([
      '/sounds/combat/slash_437118.mp3',
      '/sounds/combat/slash_776646.mp3',
    ], 0.7);

    this.blockHit = loadBank([
      '/sounds/combat/slash_437118.mp3',
    ], 0.3);

    this.bodyFall = loadBank([
      '/sounds/combat/fall_504626.mp3',
    ], 0.4);
  }

  playSwing() {
    if (this.stopped) return;
    playOne(this.whoosh);
  }

  onDamageEvent(event: DamageEvent) {
    if (this.stopped) return;

    if (event.blocked) {
      playOne(this.blockHit);
      return;
    }

    if (event.hitType === 'light') {
      playOne(this.punchHit);
    } else if (event.hitType === 'heavy') {
      playOne(this.slashHit);
      this.subThump(150, 40, 0.8, 0.18);
      this.duckBGM(0.4, 180);
    } else {
      playOne(this.punchHit);
      setTimeout(() => !this.stopped && playOne(this.slashHit), 60);
      this.subThump(180, 38, 1.0, 0.28);
      this.duckBGM(0.55, 240);
    }

    if (event.killed) {
      this.subThump(200, 30, 1.0, 0.5);
      setTimeout(() => {
        if (!this.stopped) playOne(this.bodyFall);
      }, 300);
    }
  }

  playComboHit(comboCount: number) {
    if (this.stopped) return;
    const sound = this.punchHit.sounds[0];
    if (sound) {
      sound.rate(1 + comboCount * 0.06);
      sound.volume(Math.min(0.6, 0.3 + comboCount * 0.04));
      sound.play();
    }
  }

  playFootstep(volume = 0.08) {
    if (this.stopped) return;
    try {
      const ctx = this.getSharedContext();
      if (!ctx) return;
      const now = ctx.currentTime;

      const noise = ctx.createBufferSource();
      const bufferSize = ctx.sampleRate * 0.04;
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
      }
      noise.buffer = buffer;

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 200 + Math.random() * 100;

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(volume, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);

      noise.connect(filter).connect(gain).connect(ctx.destination);
      noise.start(now);
      noise.stop(now + 0.06);
    } catch {}
  }

  playComboMilestone(count: number) {
    if (this.stopped) return;
    const baseFreq = 440 + count * 40;
    this.synthNote(baseFreq, 0.12, 0.08);
    setTimeout(() => this.synthNote(baseFreq * 1.5, 0.1, 0.1), 50);
    setTimeout(() => this.synthNote(baseFreq * 2, 0.08, 0.12), 100);
  }

  // --- Crowd ambience (procedural) ---
  private crowdGain: GainNode | null = null;
  private crowdSource: AudioBufferSourceNode | null = null;
  private crowdBaseVol = 0.05;

  /** Continuous low murmur of the arena crowd — looped filtered noise. */
  startCrowdAmbience() {
    if (this.stopped || this.crowdSource) return;
    try {
      const ctx = this.getSharedContext();
      if (!ctx) return;

      const seconds = 2;
      const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      let last = 0;
      for (let i = 0; i < data.length; i++) {
        // brown-ish noise = warmer, less hiss → reads as a hum of voices
        last = (last + (Math.random() * 2 - 1) * 0.08) * 0.96;
        data[i] = last;
      }

      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 700;

      const gain = ctx.createGain();
      gain.gain.value = this.crowdBaseVol;

      src.connect(filter).connect(gain).connect(ctx.destination);
      src.start();

      this.crowdSource = src;
      this.crowdGain = gain;
    } catch {}
  }

  /** Continuously track crowd excitement (0..1) → murmur swells. */
  setCrowdEnergy(energy: number) {
    if (!this.crowdGain) return;
    const target = this.crowdBaseVol + energy * 0.12;
    this.crowdGain.gain.value += (target - this.crowdGain.gain.value) * 0.1;
  }

  /** Bright, rising swell — the crowd pops for a clean hit / KO. */
  crowdCheer(intensity = 0.6) {
    this.crowdNoiseSwell(1500, 0.9, 0.35 + intensity * 0.6, 0.18 + intensity * 0.25);
  }

  /** Lower, growling jeer — block, whiff, or the player getting hit. */
  crowdBoo(intensity = 0.5) {
    this.crowdNoiseSwell(320, 1.6, 0.45 + intensity * 0.5, 0.12 + intensity * 0.2);
  }

  private crowdNoiseSwell(centerHz: number, q: number, dur: number, vol: number) {
    if (this.stopped) return;
    try {
      const ctx = this.getSharedContext();
      if (!ctx) return;
      const now = ctx.currentTime;

      const buffer = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

      const src = ctx.createBufferSource();
      src.buffer = buffer;

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = centerHz;
      filter.Q.value = q;

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(vol, now + dur * 0.35);
      gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

      src.connect(filter).connect(gain).connect(ctx.destination);
      src.start(now);
      src.stop(now + dur);
    } catch {}
  }

  private bgmCtx: AudioContext | null = null;
  private bgmGain: GainNode | null = null;
  private bgmIntervalId: ReturnType<typeof setInterval> | null = null;

  startBGM() {
    if (this.stopped || this.bgmCtx) return;
    try {
      const ctx = new AudioContext();
      this.bgmCtx = ctx;
      const masterGain = ctx.createGain();
      masterGain.gain.value = 0.06;
      masterGain.connect(ctx.destination);
      this.bgmGain = masterGain;

      const bassNotes = [65.41, 73.42, 82.41, 73.42]; // C2, D2, E2, D2
      let noteIdx = 0;

      const playBeat = () => {
        if (this.stopped || !this.bgmCtx) return;
        const now = ctx.currentTime;
        const freq = bassNotes[noteIdx % bassNotes.length];
        noteIdx++;

        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = freq;

        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 300;

        const env = ctx.createGain();
        env.gain.setValueAtTime(0.3, now);
        env.gain.exponentialRampToValueAtTime(0.01, now + 0.4);

        osc.connect(filter).connect(env).connect(masterGain);
        osc.start(now);
        osc.stop(now + 0.45);

        // Kick drum on beats 1 and 3
        if (noteIdx % 2 === 1) {
          const kick = ctx.createOscillator();
          kick.type = 'sine';
          kick.frequency.setValueAtTime(150, now);
          kick.frequency.exponentialRampToValueAtTime(30, now + 0.1);
          const kickEnv = ctx.createGain();
          kickEnv.gain.setValueAtTime(0.6, now);
          kickEnv.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
          kick.connect(kickEnv).connect(masterGain);
          kick.start(now);
          kick.stop(now + 0.15);
        }
      };

      playBeat();
      this.bgmIntervalId = setInterval(playBeat, 500);
    } catch {}
  }

  playVictoryFanfare() {
    if (this.stopped) return;
    this.synthNote(523, 0.12, 0.15);
    setTimeout(() => this.synthNote(659, 0.12, 0.15), 100);
    setTimeout(() => this.synthNote(784, 0.12, 0.15), 200);
    setTimeout(() => this.synthNote(1047, 0.15, 0.2), 300);
  }

  playDefeatMelody() {
    if (this.stopped) return;
    this.synthNote(330, 0.15, 0.4);
    setTimeout(() => this.synthNote(220, 0.15, 0.5), 200);
  }

  private subThump(f0 = 150, f1 = 40, vol = 0.8, dur = 0.18) {
    const ctx = this.getSharedContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(f0, now);
    osc.frequency.exponentialRampToValueAtTime(f1, now + dur);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + dur);
  }

  private duckBGM(amount = 0.4, ms = 180) {
    if (!this.bgmGain) return;
    const base = 0.06;
    this.bgmGain.gain.value = base * (1 - amount);
    setTimeout(() => {
      if (this.bgmGain) this.bgmGain.gain.value = base;
    }, ms);
  }

  stopAll() {
    this.stopped = true;
    Howler.stop();
    if (this.crowdSource) {
      try { this.crowdSource.stop(); } catch {}
      this.crowdSource = null;
    }
    this.crowdGain = null;
    if (this.bgmIntervalId) {
      clearInterval(this.bgmIntervalId);
      this.bgmIntervalId = null;
    }
    if (this.bgmGain) {
      this.bgmGain.gain.value = 0;
    }
    if (this.bgmCtx) {
      this.bgmCtx.close().catch(() => {});
      this.bgmCtx = null;
    }
  }

  private sharedCtx: AudioContext | null = null;

  private getSharedContext(): AudioContext | null {
    if (this.sharedCtx && this.sharedCtx.state !== 'closed') return this.sharedCtx;
    try {
      this.sharedCtx = new AudioContext();
      return this.sharedCtx;
    } catch {
      return null;
    }
  }

  private synthNote(freq: number, volume: number, duration: number) {
    try {
      const ctx = this.getSharedContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(volume, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now);
      osc.stop(now + duration);
    } catch {}
  }
}
