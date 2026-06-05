'use client'

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'

interface Props {
  onAvatarCreated: (avatarUrl: string) => void
  onClose: () => void
}

// Derive a 2D portrait URL from the GLB URL Ready Player Me returns.
// The transparent fullbody-portrait gives a clean character cutout on any background.
export function rpmPortraitUrl(glbUrl: string): string {
  return glbUrl.replace('.glb', '.png') + '?scene=fullbody-portrait-v1-transparent'
}

export default function RPMAvatarCreator({ onAvatarCreated, onClose }: Props) {
  const [loading, setLoading] = useState(true)

  // RPM subdomain — set NEXT_PUBLIC_RPM_SUBDOMAIN in Vercel env vars.
  // Falls back to 'demo' so onboarding works without configuration.
  const subdomain = process.env.NEXT_PUBLIC_RPM_SUBDOMAIN ?? 'demo'
  const src = `https://${subdomain}.readyplayer.me/avatar?frameApi&clearCache=1&bodyType=fullbody&language=en`

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      // RPM only posts from its own origin — skip anything else
      if (!event.origin.includes('readyplayer.me')) return

      try {
        const parsed = typeof event.data === 'string' ? JSON.parse(event.data) : event.data
        if (parsed?.source !== 'readyplayerme') return
        if (parsed?.eventName === 'v1.avatar.exported') {
          onAvatarCreated(parsed.data.url as string)
        }
      } catch {
        // ignore non-JSON messages
      }
    }

    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [onAvatarCreated])

  return (
    <motion.div
      className="fixed inset-0 z-[9999] flex flex-col"
      style={{ background: '#04030c' }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-5 py-3 shrink-0"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
      >
        <div>
          <p className="text-[9px] text-slate-600 uppercase tracking-[0.22em] font-bold">Valor</p>
          <p className="text-white font-display font-black text-sm tracking-wide">Build Your Fighter</p>
        </div>
        <button
          onClick={onClose}
          className="text-slate-500 hover:text-white text-[10px] uppercase tracking-widest font-bold transition-colors px-3 py-1.5 rounded-lg border border-white/5"
        >
          Cancel
        </button>
      </div>

      {/* Loading state */}
      {loading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 pointer-events-none">
          <motion.div
            className="w-8 h-8 rounded-full border-2 border-yellow-500/30 border-t-yellow-500"
            animate={{ rotate: 360 }}
            transition={{ duration: 0.9, repeat: Infinity, ease: 'linear' }}
          />
          <p className="text-slate-500 text-xs tracking-wider uppercase">Loading creator...</p>
        </div>
      )}

      {/* RPM iframe */}
      <iframe
        src={src}
        className="flex-1 w-full border-none"
        onLoad={() => setLoading(false)}
        allow="camera *; microphone *"
        title="Ready Player Me Avatar Creator"
      />
    </motion.div>
  )
}
