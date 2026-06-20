'use client'

import { Howl } from 'howler'

// ── Web Audio synthesis helpers ───────────────────────────────────────────────
// These run immediately without asset files, giving immediate sonic feedback.

let _ctx: AudioContext | null = null

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!_ctx) {
    try {
      _ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
    } catch { return null }
  }
  if (_ctx.state === 'suspended') _ctx.resume()
  return _ctx
}

function synthHit(weight: 'heavy' | 'medium' | 'light') {
  const ctx = getCtx(); if (!ctx) return
  const now = ctx.currentTime
  const freq = weight === 'heavy' ? 75 : weight === 'medium' ? 130 : 200
  const dur  = weight === 'heavy' ? 0.22 : weight === 'medium' ? 0.14 : 0.08

  const osc = ctx.createOscillator()
  const g   = ctx.createGain()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(freq, now)
  osc.frequency.exponentialRampToValueAtTime(25, now + dur)
  g.gain.setValueAtTime(0, now)
  g.gain.linearRampToValueAtTime(weight === 'heavy' ? 0.65 : weight === 'medium' ? 0.4 : 0.22, now + 0.006)
  g.gain.exponentialRampToValueAtTime(0.001, now + dur)
  osc.connect(g); g.connect(ctx.destination)
  osc.start(now); osc.stop(now + dur + 0.05)

  const bufLen = Math.floor(ctx.sampleRate * 0.04)
  const buf    = ctx.createBuffer(1, bufLen, ctx.sampleRate)
  const data   = buf.getChannelData(0)
  for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1
  const ns  = ctx.createBufferSource()
  const ng  = ctx.createGain()
  const nf  = ctx.createBiquadFilter()
  nf.type  = 'lowpass'
  nf.frequency.value = weight === 'heavy' ? 700 : 1400
  ns.buffer = buf
  ng.gain.setValueAtTime(0, now)
  ng.gain.linearRampToValueAtTime(0.28, now + 0.003)
  ng.gain.exponentialRampToValueAtTime(0.001, now + 0.055)
  ns.connect(nf); nf.connect(ng); ng.connect(ctx.destination)
  ns.start(now)
}

function synthRing(freq: number, duration: number) {
  const ctx = getCtx(); if (!ctx) return
  const now = ctx.currentTime
  const osc = ctx.createOscillator()
  const g   = ctx.createGain()
  osc.type = 'triangle'
  osc.frequency.value = freq
  g.gain.setValueAtTime(0, now)
  g.gain.linearRampToValueAtTime(0.3, now + 0.004)
  g.gain.exponentialRampToValueAtTime(0.001, now + duration)
  osc.connect(g); g.connect(ctx.destination)
  osc.start(now); osc.stop(now + duration + 0.05)
}

function synthWhoosh(freq: number) {
  const ctx = getCtx(); if (!ctx) return
  const now   = ctx.currentTime
  const bufLen = Math.floor(ctx.sampleRate * 0.08)
  const buf    = ctx.createBuffer(1, bufLen, ctx.sampleRate)
  const data   = buf.getChannelData(0)
  for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1
  const ns  = ctx.createBufferSource()
  const nf  = ctx.createBiquadFilter()
  const ng  = ctx.createGain()
  nf.type  = 'bandpass'
  nf.frequency.setValueAtTime(freq, now)
  nf.frequency.exponentialRampToValueAtTime(freq * 2, now + 0.08)
  nf.Q.value = 1.2
  ns.buffer  = buf
  ng.gain.setValueAtTime(0, now)
  ng.gain.linearRampToValueAtTime(0.22, now + 0.01)
  ng.gain.exponentialRampToValueAtTime(0.001, now + 0.08)
  ns.connect(nf); nf.connect(ng); ng.connect(ctx.destination)
  ns.start(now)
}

function synthBlock() {
  const ctx = getCtx(); if (!ctx) return
  const now = ctx.currentTime
  // Metallic clang — two detuned oscillators + noise burst
  ;[880, 1320].forEach((freq, i) => {
    const osc = ctx.createOscillator()
    const g   = ctx.createGain()
    osc.type = 'square'
    osc.frequency.setValueAtTime(freq, now)
    osc.frequency.exponentialRampToValueAtTime(freq * 0.4, now + 0.12)
    g.gain.setValueAtTime(0, now)
    g.gain.linearRampToValueAtTime(i === 0 ? 0.15 : 0.08, now + 0.002)
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.12)
    osc.connect(g); g.connect(ctx.destination)
    osc.start(now); osc.stop(now + 0.15)
  })
  const bufLen = Math.floor(ctx.sampleRate * 0.02)
  const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1
  const ns = ctx.createBufferSource()
  const nf = ctx.createBiquadFilter()
  const ng = ctx.createGain()
  nf.type = 'bandpass'; nf.frequency.value = 3000; nf.Q.value = 2
  ns.buffer = buf
  ng.gain.setValueAtTime(0.2, now)
  ng.gain.exponentialRampToValueAtTime(0.001, now + 0.04)
  ns.connect(nf); nf.connect(ng); ng.connect(ctx.destination)
  ns.start(now)
}

function synthDodge() {
  const ctx = getCtx(); if (!ctx) return
  const now = ctx.currentTime
  const bufLen = Math.floor(ctx.sampleRate * 0.15)
  const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1
  const ns = ctx.createBufferSource()
  const nf = ctx.createBiquadFilter()
  const ng = ctx.createGain()
  nf.type = 'bandpass'
  nf.frequency.setValueAtTime(600, now)
  nf.frequency.exponentialRampToValueAtTime(2500, now + 0.15)
  nf.Q.value = 0.8
  ns.buffer = buf
  ng.gain.setValueAtTime(0, now)
  ng.gain.linearRampToValueAtTime(0.18, now + 0.02)
  ng.gain.exponentialRampToValueAtTime(0.001, now + 0.15)
  ns.connect(nf); nf.connect(ng); ng.connect(ctx.destination)
  ns.start(now)
}

function synthGuardBreak() {
  const ctx = getCtx(); if (!ctx) return
  const now = ctx.currentTime
  // Glass-shatter: noise burst + descending tone
  const bufLen = Math.floor(ctx.sampleRate * 0.08)
  const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1
  const ns = ctx.createBufferSource()
  const nf = ctx.createBiquadFilter()
  const ng = ctx.createGain()
  nf.type = 'highpass'; nf.frequency.value = 4000
  ns.buffer = buf
  ng.gain.setValueAtTime(0.35, now)
  ng.gain.exponentialRampToValueAtTime(0.001, now + 0.08)
  ns.connect(nf); nf.connect(ng); ng.connect(ctx.destination)
  ns.start(now)
  // Descending boom
  const osc = ctx.createOscillator()
  const g = ctx.createGain()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(400, now)
  osc.frequency.exponentialRampToValueAtTime(60, now + 0.3)
  g.gain.setValueAtTime(0, now)
  g.gain.linearRampToValueAtTime(0.35, now + 0.01)
  g.gain.exponentialRampToValueAtTime(0.001, now + 0.3)
  osc.connect(g); g.connect(ctx.destination)
  osc.start(now); osc.stop(now + 0.35)
}

function synthComboHit(comboCount: number) {
  const ctx = getCtx(); if (!ctx) return
  const now = ctx.currentTime
  // Rising pitch per combo: base 300 + 80 per hit
  const freq = 300 + Math.min(comboCount, 10) * 80
  const osc = ctx.createOscillator()
  const g = ctx.createGain()
  osc.type = 'sawtooth'
  osc.frequency.setValueAtTime(freq, now)
  osc.frequency.exponentialRampToValueAtTime(freq * 1.5, now + 0.06)
  g.gain.setValueAtTime(0, now)
  g.gain.linearRampToValueAtTime(0.12, now + 0.003)
  g.gain.exponentialRampToValueAtTime(0.001, now + 0.08)
  osc.connect(g); g.connect(ctx.destination)
  osc.start(now); osc.stop(now + 0.1)
  synthHit(comboCount >= 5 ? 'heavy' : comboCount >= 3 ? 'medium' : 'light')
}

function synthKOImpact() {
  const ctx = getCtx(); if (!ctx) return
  const now = ctx.currentTime
  // Massive bass drop + impact
  const osc = ctx.createOscillator()
  const g = ctx.createGain()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(120, now)
  osc.frequency.exponentialRampToValueAtTime(20, now + 0.6)
  g.gain.setValueAtTime(0, now)
  g.gain.linearRampToValueAtTime(0.7, now + 0.008)
  g.gain.exponentialRampToValueAtTime(0.001, now + 0.6)
  osc.connect(g); g.connect(ctx.destination)
  osc.start(now); osc.stop(now + 0.65)
  // Sub-bass rumble
  const osc2 = ctx.createOscillator()
  const g2 = ctx.createGain()
  osc2.type = 'sine'
  osc2.frequency.setValueAtTime(40, now)
  g2.gain.setValueAtTime(0, now)
  g2.gain.linearRampToValueAtTime(0.5, now + 0.02)
  g2.gain.exponentialRampToValueAtTime(0.001, now + 0.5)
  osc2.connect(g2); g2.connect(ctx.destination)
  osc2.start(now); osc2.stop(now + 0.55)
  // High noise crack
  const bufLen = Math.floor(ctx.sampleRate * 0.03)
  const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1
  const ns = ctx.createBufferSource()
  const ng = ctx.createGain()
  ns.buffer = buf
  ng.gain.setValueAtTime(0.4, now)
  ng.gain.exponentialRampToValueAtTime(0.001, now + 0.05)
  ns.connect(ng); ng.connect(ctx.destination)
  ns.start(now)
}

let _heartbeatInterval: ReturnType<typeof setInterval> | null = null

function synthHeartbeat() {
  const ctx = getCtx(); if (!ctx) return
  const now = ctx.currentTime
  ;[0, 0.12].forEach((delay) => {
    const osc = ctx.createOscillator()
    const g = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = 50
    g.gain.setValueAtTime(0, now + delay)
    g.gain.linearRampToValueAtTime(0.25, now + delay + 0.02)
    g.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.15)
    osc.connect(g); g.connect(ctx.destination)
    osc.start(now + delay); osc.stop(now + delay + 0.2)
  })
}

function synthButtonTap() {
  const ctx = getCtx(); if (!ctx) return
  const now    = ctx.currentTime
  const bufLen = Math.floor(ctx.sampleRate * 0.012)
  const buf    = ctx.createBuffer(1, bufLen, ctx.sampleRate)
  const data   = buf.getChannelData(0)
  for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1
  const ns  = ctx.createBufferSource()
  const nf  = ctx.createBiquadFilter()
  const ng  = ctx.createGain()
  nf.type  = 'highpass'
  nf.frequency.value = 5000
  ns.buffer = buf
  ng.gain.setValueAtTime(0.12, now)
  ng.gain.exponentialRampToValueAtTime(0.001, now + 0.012)
  ns.connect(nf); nf.connect(ng); ng.connect(ctx.destination)
  ns.start(now)
}

function synthButtonConfirm() {
  const ctx = getCtx(); if (!ctx) return
  const now = ctx.currentTime
  ;[0, 0.08].forEach((delay, i) => {
    const osc = ctx.createOscillator()
    const g   = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = i === 0 ? 660 : 880
    g.gain.setValueAtTime(0, now + delay)
    g.gain.linearRampToValueAtTime(0.14, now + delay + 0.005)
    g.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.12)
    osc.connect(g); g.connect(ctx.destination)
    osc.start(now + delay); osc.stop(now + delay + 0.15)
  })
}

function synthVictory() {
  const ctx = getCtx(); if (!ctx) return
  const now   = ctx.currentTime
  const notes = [523, 659, 784, 1047]
  notes.forEach((freq, i) => {
    const osc = ctx.createOscillator()
    const g   = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = freq
    const t = now + i * 0.09
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(0.2, t + 0.01)
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.35)
    osc.connect(g); g.connect(ctx.destination)
    osc.start(t); osc.stop(t + 0.4)
  })
}

function synthDefeat() {
  const ctx = getCtx(); if (!ctx) return
  const now = ctx.currentTime
  const osc = ctx.createOscillator()
  const g   = ctx.createGain()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(330, now)
  osc.frequency.exponentialRampToValueAtTime(165, now + 0.8)
  g.gain.setValueAtTime(0, now)
  g.gain.linearRampToValueAtTime(0.22, now + 0.04)
  g.gain.exponentialRampToValueAtTime(0.001, now + 0.85)
  osc.connect(g); g.connect(ctx.destination)
  osc.start(now); osc.stop(now + 0.9)
}

// ── Sound file paths (drop .ogg files in /public/sounds/ to activate) ─────────

const SOUND_PATHS = {
  hitBerserker:     '/sounds/hit-berserker.ogg',
  hitSentinel:      '/sounds/hit-sentinel.ogg',
  hitPhantom:       '/sounds/hit-phantom.ogg',
  specialBerserker: '/sounds/special-berserker.ogg',
  specialSentinel:  '/sounds/special-sentinel.ogg',
  specialPhantom:   '/sounds/special-phantom.ogg',
  victory:          '/sounds/victory.ogg',
  defeat:           '/sounds/defeat.ogg',
  arena:            '/sounds/arena-ambient.ogg',
  buttonTap:        '/sounds/button-tap.ogg',
  buttonConfirm:    '/sounds/button-confirm.ogg',
} as const

type SoundKey = keyof typeof SOUND_PATHS

// ── AudioManager ──────────────────────────────────────────────────────────────

class AudioManager {
  private sounds = new Map<SoundKey, Howl>()
  private loaded = new Set<SoundKey>()
  muted = false

  constructor() {
    if (typeof window !== 'undefined') {
      this.init()
    }
  }

  private init() {
    ;(Object.keys(SOUND_PATHS) as SoundKey[]).forEach(key => {
      const howl = new Howl({
        src: [SOUND_PATHS[key]],
        volume: key === 'arena' ? 0.08 : 0.45,
        loop:   key === 'arena',
        html5:  key === 'arena',
        onload: () => this.loaded.add(key),
        onloaderror: () => { /* silent — fall back to synthesis */ },
      })
      this.sounds.set(key, howl)
    })
  }

  private play(key: SoundKey) {
    if (this.muted) return
    if (this.loaded.has(key)) {
      this.sounds.get(key)?.play()
    }
  }

  setMuted(v: boolean) {
    this.muted = v
    if (v) this.sounds.get('arena')?.pause()
    else if (this.loaded.has('arena')) this.sounds.get('arena')?.play()
  }

  playHit(characterClass: string, damage: number) {
    if (this.muted) return
    const weight = damage >= 16 ? 'heavy' : damage >= 9 ? 'medium' : 'light'
    const cls = characterClass.toLowerCase()
    const key: SoundKey = cls === 'berserker' ? 'hitBerserker' : cls === 'sentinel' ? 'hitSentinel' : 'hitPhantom'
    if (this.loaded.has(key)) { this.play(key); return }
    if (cls === 'sentinel') synthRing(1200, 0.15)
    else if (cls === 'phantom') synthWhoosh(3500)
    else synthHit(weight)
  }

  playSpecial(characterClass: string) {
    if (this.muted) return
    const cls = characterClass.toLowerCase()
    const key: SoundKey = cls === 'berserker' ? 'specialBerserker' : cls === 'sentinel' ? 'specialSentinel' : 'specialPhantom'
    if (this.loaded.has(key)) { this.play(key); return }
    if (cls === 'sentinel') synthRing(800, 0.25)
    else if (cls === 'phantom') synthWhoosh(2000)
    else { synthHit('heavy'); setTimeout(() => synthHit('heavy'), 60) }
  }

  playVictory() {
    if (this.muted) return
    if (this.loaded.has('victory')) { this.play('victory'); return }
    synthVictory()
  }

  playDefeat() {
    if (this.muted) return
    if (this.loaded.has('defeat')) { this.play('defeat'); return }
    synthDefeat()
  }

  playButtonTap() {
    if (this.muted) return
    if (this.loaded.has('buttonTap')) { this.play('buttonTap'); return }
    synthButtonTap()
  }

  playButtonConfirm() {
    if (this.muted) return
    if (this.loaded.has('buttonConfirm')) { this.play('buttonConfirm'); return }
    synthButtonConfirm()
  }

  playBlock() {
    if (this.muted) return
    synthBlock()
  }

  playDodge() {
    if (this.muted) return
    synthDodge()
  }

  playGuardBreak() {
    if (this.muted) return
    synthGuardBreak()
  }

  playComboHit(comboCount: number) {
    if (this.muted) return
    synthComboHit(comboCount)
  }

  playKOImpact() {
    if (this.muted) return
    synthKOImpact()
  }

  startHeartbeat() {
    if (this.muted || _heartbeatInterval) return
    synthHeartbeat()
    _heartbeatInterval = setInterval(() => {
      if (!this.muted) synthHeartbeat()
    }, 800)
  }

  stopHeartbeat() {
    if (_heartbeatInterval) {
      clearInterval(_heartbeatInterval)
      _heartbeatInterval = null
    }
  }

  startAmbient() {
    if (!this.loaded.has('arena') || this.muted) return
    this.sounds.get('arena')?.play()
  }

  stopAmbient() {
    this.sounds.get('arena')?.pause()
  }
}

// Singleton — one audio manager across the app
let _manager: AudioManager | null = null

export function getAudioManager(): AudioManager {
  if (!_manager) _manager = new AudioManager()
  return _manager
}
