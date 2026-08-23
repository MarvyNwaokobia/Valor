'use client'

/**
 * Face-Off spectate — read-only, "anyone with the link" viewer for a live
 * match. V1 scope is deliberately narrow, same spirit as the rest of this
 * feature's V1 cuts (one fixed weapon, two hitboxes): a top-down tactical
 * view rather than the full 3D ArenaScene. ArenaScene is built around ONE
 * local player predicting their own camera and rendering the opponent from
 * server snapshots — there's no "outside" camera mode, and building one is
 * a much bigger lift than a spectator feature needs to justify today. This
 * reads the exact same `state_update`/`hit_confirm` wire messages a real
 * player's client does (via `useSpectateSocket`), just drawn as a radar
 * instead of a 3D scene — same source of truth, different renderer.
 */

import { useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { X, Eye } from 'lucide-react'
import { useSpectateSocket } from '@/hooks/useSpectateSocket'
import arenaGeometry from '@/engine/scene/faceoffArena.json'
import type { PlayerSnapshot } from '@/hooks/useArenaSocket'

// World meters -> SVG user units, 1:1 (viewBox is in the same units as the
// server's x/z), y-flipped so "up" on screen matches the arena's +z.
const VIEW = { minX: -10.5, minZ: -9.6, w: 21, h: 19.2 }
const toSvg = (x: number, z: number) => ({ sx: x, sy: -z })

const FIGHTER_COLOR = ['#22d3ee', '#f97316'] // cyan / orange — arbitrary but consistent per slot

function short(w: string) { return `${w.slice(0, 6)}…${w.slice(-4)}` }

export default function FaceOffSpectateView() {
  const router = useRouter()
  const { duelId } = useParams<{ duelId: string }>()
  const { phase, error, result, latestPlayers, drainHits } = useSpectateSocket(duelId)
  const [, forceTick] = useState(0)
  const [flashes, setFlashes] = useState<{ id: number; x: number; z: number; head: boolean }[]>([])
  const flashId = useRef(0)

  // Re-render at a modest rate to reflect the ref-held snapshots — the
  // socket writes ~20/s, painting React that often for two SVG dots would
  // be wasteful; this radar doesn't need pixel-perfect interpolation.
  useEffect(() => {
    let raf: number
    let last = 0
    const loop = (t: number) => {
      if (t - last > 80) {
        last = t
        const hits = drainHits()
        if (hits.length > 0) {
          const players = Array.from(latestPlayers.current.values())
          const newFlashes = hits.map((h) => {
            const target = players.find((p) => p.wallet === h.target)
            return { id: flashId.current++, x: target?.x ?? 0, z: target?.z ?? 0, head: h.part === 'head' }
          })
          setFlashes((prev) => [...prev, ...newFlashes].slice(-8))
          window.setTimeout(() => {
            setFlashes((prev) => prev.filter((f) => !newFlashes.some((n) => n.id === f.id)))
          }, 350)
        }
        forceTick((n) => n + 1)
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [drainHits, latestPlayers])

  const players = Array.from(latestPlayers.current.values())

  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ background: '#04030c' }}>
      <div className="flex items-center gap-3 px-5 pt-[calc(env(safe-area-inset-top,0px)+1rem)] pb-3">
        <Eye className="text-cyan-400" size={20} />
        <div className="flex-1">
          <h1 className="font-display font-black text-white text-lg">Watching Face-Off</h1>
          <p className="text-slate-500 text-xs">Read-only — nothing you do here affects the match.</p>
        </div>
        <button onClick={() => router.push('/faceoff')} className="text-slate-500 hover:text-white transition-colors" aria-label="Stop watching">
          <X size={20} />
        </button>
      </div>

      <div className="flex-1 flex items-center justify-center px-4 pb-6">
        {phase === 'connecting' && <p className="text-slate-400 text-sm">Connecting…</p>}
        {phase === 'error' && (
          <div className="flex flex-col items-center gap-2 text-center max-w-xs">
            <p className="text-white font-bold text-sm">{error ?? 'Lost connection to the match.'}</p>
            <button onClick={() => router.push('/faceoff')} className="mt-2 px-4 py-2 rounded-lg bg-valor-gold text-black font-bold text-xs">
              Back to Face-Off
            </button>
          </div>
        )}
        {phase === 'ended' && result && (
          <div className="flex flex-col items-center gap-2 text-center max-w-xs">
            <p className="text-valor-gold font-display font-black text-xl">Match over</p>
            <p className="text-slate-400 text-sm">
              {result.winnerWallet ? `${short(result.winnerWallet)} won` : 'Draw'}
              {result.reason === 'forfeit' ? ' by forfeit' : result.reason === 'disconnect_timeout' ? ' — opponent never reconnected' : ''}
            </p>
            <button onClick={() => router.push('/faceoff')} className="mt-2 px-4 py-2 rounded-lg bg-valor-gold text-black font-bold text-xs">
              Back to Face-Off
            </button>
          </div>
        )}
        {(phase === 'watching' || (phase === 'ended' && players.length > 0)) && (
          <div className="w-full max-w-md flex flex-col gap-3">
            <div className="flex justify-between gap-4">
              {players.map((p, i) => (
                <div key={p.wallet} className="flex-1 flex flex-col gap-1" style={{ alignItems: i === 0 ? 'flex-start' : 'flex-end' }}>
                  <span className="text-xs font-bold text-white">{short(p.wallet)}</span>
                  <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.12)' }}>
                    <div className="h-full transition-all" style={{ width: `${Math.max(0, Math.min(100, p.hp))}%`, background: FIGHTER_COLOR[i] }} />
                  </div>
                </div>
              ))}
            </div>

            <svg viewBox={`${VIEW.minX} ${VIEW.minZ} ${VIEW.w} ${VIEW.h}`} className="w-full rounded-xl" style={{ background: '#0a0a12', border: '1px solid rgba(42,42,58,0.8)' }}>
              {arenaGeometry.walls.map((w, i) => {
                const { sx, sy } = toSvg(w.x, w.z)
                return <rect key={`w${i}`} x={sx - w.w / 2} y={sy - w.d / 2} width={w.w} height={w.d} fill="#26263a" />
              })}
              {arenaGeometry.cover.map((c, i) => {
                const { sx, sy } = toSvg(c.x, c.z)
                return <rect key={`c${i}`} x={sx - c.w / 2} y={sy - c.d / 2} width={c.w} height={c.d} fill="#3d3520" rx={0.15} />
              })}

              {flashes.map((f) => {
                const { sx, sy } = toSvg(f.x, f.z)
                return <circle key={f.id} cx={sx} cy={sy} r={f.head ? 0.9 : 0.6} fill="none" stroke={f.head ? '#ef4444' : '#eab308'} strokeWidth={0.15} opacity={0.85} />
              })}

              {players.map((p: PlayerSnapshot, i) => {
                const { sx, sy } = toSvg(p.x, p.z)
                const facingLen = 0.7
                const fx = sx + Math.sin(p.yaw) * facingLen
                const fy = sy - Math.cos(p.yaw) * facingLen
                return (
                  <g key={p.wallet} opacity={p.hp > 0 ? 1 : 0.3}>
                    <line x1={sx} y1={sy} x2={fx} y2={fy} stroke={FIGHTER_COLOR[i]} strokeWidth={0.12} />
                    <circle cx={sx} cy={sy} r={0.35} fill={FIGHTER_COLOR[i]} stroke="#04030c" strokeWidth={0.08} />
                  </g>
                )
              })}
            </svg>
            <p className="text-center text-[10px] text-slate-600 uppercase tracking-widest">Tactical view — not the 3D scene</p>
          </div>
        )}
      </div>
    </div>
  )
}
