import { Howl } from 'howler';
import type { DamageEvent } from '../combat/DamageSystem';

interface SoundBank {
  sounds: Howl[];
  volume: number;
}

function loadBank(paths: string[], volume = 1): SoundBank {
  return {
    sounds: paths.map(
      (src) =>
        new Howl({
          src: [src],
          preload: true,
          volume,
        })
    ),
    volume,
  };
}

function playRandom(bank: SoundBank, pitchVariation = 0.1): number | undefined {
  if (bank.sounds.length === 0) return;
  const sound = bank.sounds[Math.floor(Math.random() * bank.sounds.length)];
  const rate = 1 + (Math.random() - 0.5) * pitchVariation * 2;
  sound.rate(rate);
  sound.volume(bank.volume);
  return sound.play();
}

export class CombatAudio {
  private whoosh: SoundBank;
  private punchImpact: SoundBank;
  private slashImpact: SoundBank;
  private blockImpact: SoundBank;
  private magicImpact: SoundBank;
  private explosion: SoundBank;
  private bodyFall: SoundBank;
  private crowd: SoundBank;

  private bassDrop: Howl | null = null;
  private ctx: AudioContext | null = null;

  constructor() {
    this.whoosh = loadBank([
      '/sounds/combat/whoosh_802462.mp3',
      '/sounds/combat/whoosh_768408.mp3',
      '/sounds/combat/whoosh_425852.mp3',
      '/sounds/combat/whoosh_425853.mp3',
      '/sounds/combat/whoosh_178832.mp3',
    ], 0.4);

    this.punchImpact = loadBank([
      '/sounds/combat/punch_276600.mp3',
      '/sounds/combat/punch_847837.mp3',
      '/sounds/combat/punch_853588.mp3',
      '/sounds/combat/punch_835703.mp3',
      '/sounds/combat/punch_232358.mp3',
    ], 0.6);

    this.slashImpact = loadBank([
      '/sounds/combat/slash_437118.mp3',
      '/sounds/combat/slash_776646.mp3',
      '/sounds/combat/slash_655774.mp3',
      '/sounds/combat/slash_803609.mp3',
    ], 0.5);

    this.blockImpact = loadBank([
      '/sounds/combat/slash_437118.mp3',
    ], 0.4);

    this.magicImpact = loadBank([
      '/sounds/combat/magic_855439.mp3',
      '/sounds/combat/magic_855440.mp3',
      '/sounds/combat/magic_855441.mp3',
      '/sounds/combat/magic_855442.mp3',
      '/sounds/combat/magic_855443.mp3',
    ], 0.5);

    this.explosion = loadBank([
      '/sounds/combat/explosion_607253.mp3',
      '/sounds/combat/explosion_617037.mp3',
      '/sounds/combat/explosion_617043.mp3',
      '/sounds/combat/explosion_802965.mp3',
      '/sounds/combat/explosion_802966.mp3',
    ], 0.4);

    this.bodyFall = loadBank([
      '/sounds/combat/fall_504626.mp3',
      '/sounds/combat/fall_734629.mp3',
      '/sounds/combat/fall_792414.mp3',
      '/sounds/combat/fall_810885.mp3',
    ], 0.5);

    this.crowd = loadBank([
      '/sounds/combat/crowd_629884.mp3',
      '/sounds/combat/crowd_645337.mp3',
      '/sounds/combat/crowd_702099.mp3',
      '/sounds/combat/crowd_706732.mp3',
    ], 0.15);
  }

  playSwing(classId: string) {
    playRandom(this.whoosh, 0.15);
  }

  onDamageEvent(event: DamageEvent) {
    if (event.blocked) {
      this.playBlock();
      return;
    }

    if (event.killed) {
      this.playKill(event);
      return;
    }

    switch (event.hitType) {
      case 'light':
        this.playLightHit();
        break;
      case 'heavy':
        this.playHeavyHit();
        break;
      case 'special':
        this.playSpecialHit();
        break;
    }

    if (event.critical) {
      setTimeout(() => playRandom(this.slashImpact, 0.05), 30);
    }
  }

  private playLightHit() {
    playRandom(this.punchImpact, 0.12);
    this.synthBass(60, 0.08, 0.15);
  }

  private playHeavyHit() {
    playRandom(this.punchImpact, 0.08);
    setTimeout(() => playRandom(this.slashImpact, 0.1), 20);
    this.synthBass(45, 0.15, 0.25);
  }

  private playSpecialHit() {
    playRandom(this.magicImpact, 0.1);
    setTimeout(() => playRandom(this.explosion, 0.05), 40);
    this.synthBass(35, 0.25, 0.4);
  }

  private playBlock() {
    playRandom(this.blockImpact, 0.15);
    this.synthRing(800, 0.08, 0.1);
  }

  private playKill(event: DamageEvent) {
    playRandom(this.explosion, 0.05);
    setTimeout(() => playRandom(this.punchImpact, 0.05), 50);
    setTimeout(() => playRandom(this.bodyFall, 0.1), 300);
    setTimeout(() => playRandom(this.crowd, 0), 800);

    this.synthBass(25, 0.4, 0.8);
    setTimeout(() => this.synthBass(20, 0.2, 0.5), 100);
  }

  playComboHit(comboCount: number) {
    const pitchScale = 1 + comboCount * 0.08;
    const sound = this.punchImpact.sounds[
      Math.floor(Math.random() * this.punchImpact.sounds.length)
    ];
    if (sound) {
      sound.rate(pitchScale);
      sound.volume(Math.min(0.8, 0.4 + comboCount * 0.05));
      sound.play();
    }

    this.synthRing(400 + comboCount * 80, 0.06, 0.08);
  }

  playVictoryFanfare() {
    const notes = [523, 659, 784, 1047];
    notes.forEach((freq, i) => {
      setTimeout(() => this.synthNote(freq, 0.15, 0.2), i * 120);
    });
  }

  playDefeatMelody() {
    this.synthSlide(330, 165, 0.2, 0.8);
  }

  private synthBass(freq: number, volume: number, duration: number) {
    const ctx = this.getAudioContext();
    if (!ctx) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain).connect(ctx.destination);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration);
  }

  private synthRing(freq: number, volume: number, duration: number) {
    const ctx = this.getAudioContext();
    if (!ctx) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain).connect(ctx.destination);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration);
  }

  private synthNote(freq: number, volume: number, duration: number) {
    const ctx = this.getAudioContext();
    if (!ctx) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(volume * 0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain).connect(ctx.destination);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration);
  }

  private synthSlide(startFreq: number, endFreq: number, volume: number, duration: number) {
    const ctx = this.getAudioContext();
    if (!ctx) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(startFreq, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(endFreq, ctx.currentTime + duration);
    gain.gain.setValueAtTime(volume * 0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain).connect(ctx.destination);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration);
  }

  private getAudioContext(): AudioContext | null {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
      } catch {
        return null;
      }
    }
    return this.ctx;
  }
}
