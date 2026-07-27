import { ImageResponse } from 'next/og'
import { RANK_DEFINITIONS } from '@/lib/ranks'
import type { Rank } from '@/types/database'

/**
 * Social preview for a player card.
 *
 * A card link is only worth sharing if it arrives as a picture of the player's
 * warrior. Pasted into WhatsApp or X without this, /card/0x… rendered as the
 * generic site title and nothing else — which is the difference between a link
 * that gets opened and one that gets ignored.
 *
 * Rendered on the server per request, so it always reflects the player's CURRENT
 * rank and record rather than a snapshot baked at build time.
 */
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'
export const alt = 'Valor player card'

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080'

interface CardPlayer {
  character_name: string
  username: string | null
  rank: Rank
  character_class: string | null
  wins: number
  losses: number
  prestige_level?: number
}

export default async function Image({
  params,
}: {
  params: Promise<{ walletAddress: string }>
}) {
  const { walletAddress } = await params

  // Never let a dead API produce a broken image — a card with placeholder text
  // still previews, a 500 leaves the link bare, which is the thing we are fixing.
  let player: CardPlayer | null = null
  try {
    const res = await fetch(`${API}/players/${walletAddress.toLowerCase()}`, {
      cache: 'no-store',
    })
    if (res.ok) player = (await res.json()) as CardPlayer
  } catch {
    player = null
  }

  const rank: Rank = player?.rank && RANK_DEFINITIONS[player.rank] ? player.rank : 'Iron'
  const def = RANK_DEFINITIONS[rank]
  const name = player?.username || player?.character_name || 'Unclaimed Warrior'
  const wins = player?.wins ?? 0
  const losses = player?.losses ?? 0
  const prestige = player?.prestige_level ?? 0
  const rankLabel = prestige > 0 ? `${def.label} ${'I'.repeat(Math.min(prestige, 3))}` : def.label

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: '#04030c',
          // The rank colour is the card's whole identity, so the preview leads
          // with it rather than a neutral frame.
          backgroundImage: `radial-gradient(ellipse 90% 70% at 50% 0%, ${def.color}22 0%, transparent 65%)`,
          padding: 64,
          fontFamily: 'sans-serif',
        }}
      >
        {/* Top rule in the rank colour */}
        <div style={{ display: 'flex', width: '100%', height: 10, background: def.color }} />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div
            style={{
              display: 'flex',
              fontSize: 26,
              letterSpacing: 10,
              color: '#eab308',
              fontWeight: 800,
            }}
          >
            VALOR
          </div>

          <div style={{ display: 'flex', fontSize: 82, color: '#ffffff', fontWeight: 800 }}>
            {name}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            <div
              style={{
                display: 'flex',
                padding: '10px 24px',
                borderRadius: 10,
                background: def.badgeBg,
                color: def.color,
                fontSize: 30,
                fontWeight: 800,
                letterSpacing: 3,
              }}
            >
              {rankLabel}
            </div>
            {player?.character_class && (
              <div style={{ display: 'flex', fontSize: 30, color: '#94a3b8' }}>
                {player.character_class}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', fontSize: 32, color: '#cbd5e1', gap: 28 }}>
            <div style={{ display: 'flex' }}>{wins}W</div>
            <div style={{ display: 'flex', color: '#475569' }}>/</div>
            <div style={{ display: 'flex' }}>{losses}L</div>
          </div>
        </div>

        <div style={{ display: 'flex', fontSize: 24, color: '#64748b' }}>
          One human. One fighter. Earn real G$ on Celo.
        </div>
      </div>
    ),
    size,
  )
}
