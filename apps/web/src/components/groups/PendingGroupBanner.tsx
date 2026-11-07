'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { useResolvedAuth } from '@/hooks/useResolvedAuth'
import { usePlayerStore } from '@/stores/usePlayerStore'
import { useGroup, useMyGroup, getPendingGroup, clearPendingGroup } from '@/hooks/useGroups'

/**
 * Offers a saved group invite once the player has a profile. Someone who followed a
 * join link, signed in and went through onboarding would otherwise land on the home
 * page with no trace of the invite. It is a button, not an auto-join, so the
 * signature prompt that joining needs arrives with a clear reason.
 */
export default function PendingGroupBanner() {
  const pathname = usePathname()
  const { address } = useResolvedAuth()
  const player = usePlayerStore((s) => s.player)
  const mine = useMyGroup(address)
  const [slug, setSlug] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => { setSlug(getPendingGroup()) }, [pathname])
  const group = useGroup(slug ?? undefined)

  // Already in a group: the invite is moot, drop it.
  useEffect(() => {
    if (mine.group) { clearPendingGroup(); setSlug(null) }
  }, [mine.group])

  if (!slug || !player || mine.loading || mine.group || !group.data) return null
  if (pathname.startsWith('/join/')) return null

  async function join() {
    setBusy(true)
    try { await mine.join(slug!); clearPendingGroup(); setSlug(null) } catch { /* the join page shows the reason */ } finally { setBusy(false) }
  }

  return (
    <div className="mx-auto max-w-md mt-3 px-4 py-3 rounded-xl flex items-center gap-3"
         style={{ background: 'rgba(234,179,8,0.08)', border: '1px solid rgba(234,179,8,0.4)' }}>
      <span className="flex-1 text-sm text-white">Join <b>{group.data.name}</b> and play for them?</span>
      <button onClick={join} disabled={busy} className="px-3 py-1.5 rounded-lg text-xs font-black text-black disabled:opacity-40" style={{ background: '#eab308' }}>
        {busy ? '…' : 'Join'}
      </button>
      <button onClick={() => { clearPendingGroup(); setSlug(null) }} className="text-xs text-slate-500">Dismiss</button>
    </div>
  )
}
