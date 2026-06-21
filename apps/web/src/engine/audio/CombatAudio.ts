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
    ], 0.5);

    this.slashHit = loadBank([
      '/sounds/combat/slash_437118.mp3',
      '/sounds/combat/slash_776646.mp3',
    ], 0.4);

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

    // One impact sound per hit — not layered
    if (event.hitType === 'light') {
      playOne(this.punchHit);
    } else if (event.hitType === 'heavy') {
      playOne(this.slashHit);
    } else {
      playOne(this.punchHit);
      setTimeout(() => {
        if (!this.stopped) playOne(this.slashHit);
      }, 80);
    }

    if (event.killed) {
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

  stopAll() {
    this.stopped = true;
    Howler.stop();
  }

  private synthNote(freq: number, volume: number, duration: number) {
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(volume, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + duration);
      setTimeout(() => ctx.close(), (duration + 0.1) * 1000);
    } catch {}
  }
}
