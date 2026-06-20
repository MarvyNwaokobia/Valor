'use client'

import { motion } from 'framer-motion'
import { Lock, Check, ChevronRight, Swords } from 'lucide-react'
import { CAMPAIGN_CHAPTERS, isChapterUnlocked } from '@/lib/campaign'
import type { Chapter } from '@/lib/campaign'
import { useCampaignStore } from '@/stores/useCampaignStore'
import { CLASS_DEFINITIONS } from '@/lib/classes'

interface Props {
  onSelectChapter: (chapter: Chapter) => void
  onBack: () => void
}

export default function CampaignSelect({ onSelectChapter, onBack }: Props) {
  const { completedChapters, chapterStats } = useCampaignStore()

  return (
    <div className="flex flex-col gap-4 min-h-[calc(100vh-10rem)]">
      <motion.div
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <button onClick={onBack}
          className="text-slate-500 text-sm hover:text-white transition-colors mb-2">
          ← Back
        </button>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: 'rgba(234,179,8,0.1)', border: '1px solid rgba(234,179,8,0.25)' }}>
            <Swords size={20} style={{ color: '#eab308' }} strokeWidth={1.5} />
          </div>
          <div>
            <h1 className="font-display font-black text-white text-2xl tracking-wide">Story Campaign</h1>
            <p className="text-slate-500 text-xs mt-0.5">
              {completedChapters.length}/{CAMPAIGN_CHAPTERS.length} chapters completed
            </p>
          </div>
        </div>

        {/* Progress bar */}
        <div className="mt-3 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(42,42,58,0.5)' }}>
          <motion.div
            className="h-full rounded-full"
            style={{ background: 'linear-gradient(90deg, #eab308, #f59e0b)' }}
            animate={{ width: `${(completedChapters.length / CAMPAIGN_CHAPTERS.length) * 100}%` }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
          />
        </div>
      </motion.div>

      {/* Chapter list */}
      <div className="flex flex-col gap-3">
        {CAMPAIGN_CHAPTERS.map((chapter, i) => {
          const unlocked = isChapterUnlocked(chapter.id, completedChapters)
          const completed = completedChapters.includes(chapter.id)
          const stats = chapterStats[chapter.id]
          const bossColor = chapter.boss.accentColor
          const classDef = CLASS_DEFINITIONS[chapter.boss.characterClass]

          return (
            <motion.button
              key={chapter.id}
              onClick={() => unlocked && onSelectChapter(chapter)}
              disabled={!unlocked}
              className="group relative overflow-hidden p-5 rounded-2xl border text-left transition-all disabled:cursor-not-allowed"
              style={{
                background: completed
                  ? 'rgba(8,8,14,0.7)'
                  : unlocked
                    ? 'rgba(8,8,14,0.9)'
                    : 'rgba(4,3,8,0.6)',
                borderColor: completed
                  ? `${bossColor}30`
                  : unlocked
                    ? 'rgba(42,42,58,0.8)'
                    : 'rgba(42,42,58,0.3)',
                opacity: unlocked ? 1 : 0.5,
              }}
              whileHover={unlocked ? { scale: 1.01 } : {}}
              whileTap={unlocked ? { scale: 0.99 } : {}}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: unlocked ? 1 : 0.5, x: 0 }}
              transition={{ delay: i * 0.08 }}
            >
              {/* Accent gradient on hover */}
              {unlocked && (
                <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{ background: `radial-gradient(ellipse 80% 80% at 10% 50%, ${bossColor}08, transparent)` }} />
              )}
              {unlocked && (
                <div className="absolute inset-y-0 left-0 w-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{ background: bossColor }} />
              )}

              <div className="flex items-center gap-4 relative z-10">
                {/* Chapter number / status */}
                <div className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0"
                  style={{
                    background: completed
                      ? `${bossColor}18`
                      : unlocked
                        ? 'rgba(42,42,58,0.5)'
                        : 'rgba(42,42,58,0.2)',
                    border: `1px solid ${completed ? `${bossColor}40` : 'rgba(42,42,58,0.5)'}`,
                  }}>
                  {completed ? (
                    <Check size={20} style={{ color: bossColor }} strokeWidth={2.5} />
                  ) : unlocked ? (
                    <span className="font-display font-black text-white text-lg">{chapter.number}</span>
                  ) : (
                    <Lock size={18} className="text-slate-600" strokeWidth={1.5} />
                  )}
                </div>

                {/* Chapter info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className={`font-display font-black text-lg ${unlocked ? 'text-white group-hover:text-amber-400' : 'text-slate-600'} transition-colors`}>
                      {chapter.title}
                    </p>
                    {completed && (
                      <span className="text-[7px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded"
                        style={{ background: `${bossColor}18`, color: bossColor }}>
                        CLEARED
                      </span>
                    )}
                  </div>
                  <p className="text-slate-500 text-xs mt-0.5 truncate">{chapter.description}</p>

                  {/* Boss info */}
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className="text-[8px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded"
                      style={{ background: `${bossColor}12`, color: `${bossColor}90` }}>
                      {chapter.boss.name} — {chapter.boss.title}
                    </span>
                    <span className="text-[7px] font-bold px-1 py-0.5 rounded"
                      style={{ background: `${classDef.accentColor}12`, color: `${classDef.accentColor}80` }}>
                      {chapter.boss.characterClass}
                    </span>
                  </div>

                  {/* Best stats if completed */}
                  {stats && (
                    <div className="flex gap-3 mt-1.5">
                      <span className="text-[8px] text-slate-600">
                        Hits: <span className="text-slate-400 font-bold">{stats.hitsLanded}</span>
                      </span>
                      <span className="text-[8px] text-slate-600">
                        Combo: <span className="text-amber-400 font-bold">{stats.maxCombo}x</span>
                      </span>
                      <span className="text-[8px] text-slate-600">
                        Time: <span className="text-slate-400 font-bold">{Math.ceil(stats.timeMs / 1000)}s</span>
                      </span>
                    </div>
                  )}
                </div>

                {/* Arrow */}
                {unlocked && (
                  <ChevronRight size={16} className="text-slate-700 group-hover:text-white transition-colors shrink-0" />
                )}
              </div>
            </motion.button>
          )
        })}
      </div>
    </div>
  )
}
