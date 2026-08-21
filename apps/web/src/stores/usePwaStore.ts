import { create } from 'zustand'
import type { BeforeInstallPromptEvent } from '@/lib/pwaInstall'

// Chrome/Edge/Brave fire `beforeinstallprompt` once, early, to whichever listeners
// happen to be attached at that moment — InstallPrompt (mounted globally in
// layout.tsx) captures it. Anything mounted later, like the Profile notification
// toggle, can't attach its own listener in time to catch the same event, so the
// captured prompt is shared here instead of re-listening everywhere it's needed.
interface PwaState {
  deferred: BeforeInstallPromptEvent | null
  standalone: boolean
  setDeferred: (e: BeforeInstallPromptEvent | null) => void
  setStandalone: (v: boolean) => void
}

export const usePwaStore = create<PwaState>((set) => ({
  deferred: null,
  standalone: false,
  setDeferred: (deferred) => set({ deferred }),
  setStandalone: (standalone) => set({ standalone }),
}))
