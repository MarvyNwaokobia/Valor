import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface CampaignState {
  completedChapters: string[]
  /** Best stats per chapter */
  chapterStats: Record<string, { hitsLanded: number; maxCombo: number; timeMs: number }>
  completeChapter: (chapterId: string, stats: { hitsLanded: number; maxCombo: number; timeMs: number }) => void
  isCompleted: (chapterId: string) => boolean
  resetCampaign: () => void
}

export const useCampaignStore = create<CampaignState>()(
  persist(
    (set, get) => ({
      completedChapters: [],
      chapterStats: {},

      completeChapter: (chapterId, stats) => {
        const current = get()
        const existing = current.chapterStats[chapterId]
        const best = existing
          ? {
              hitsLanded: Math.max(existing.hitsLanded, stats.hitsLanded),
              maxCombo: Math.max(existing.maxCombo, stats.maxCombo),
              timeMs: Math.min(existing.timeMs, stats.timeMs),
            }
          : stats

        set({
          completedChapters: current.completedChapters.includes(chapterId)
            ? current.completedChapters
            : [...current.completedChapters, chapterId],
          chapterStats: { ...current.chapterStats, [chapterId]: best },
        })
      },

      isCompleted: (chapterId) => get().completedChapters.includes(chapterId),

      resetCampaign: () => set({ completedChapters: [], chapterStats: {} }),
    }),
    { name: 'valor-campaign' },
  ),
)
