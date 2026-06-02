import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Player, InventoryItem } from '@/types'

interface PlayerState {
  player: Player | null
  inventory: InventoryItem[]
  isVerified: boolean
  setPlayer: (player: Player) => void
  updatePlayer: (updates: Partial<Player>) => void
  setInventory: (inventory: InventoryItem[]) => void
  addInventoryItem: (item: InventoryItem) => void
  toggleEquip: (itemId: string) => void
  setVerified: (verified: boolean) => void
  clearPlayer: () => void
}

export const usePlayerStore = create<PlayerState>()(
  persist(
    (set) => ({
      player: null,
      inventory: [],
      isVerified: false,

      setPlayer: (player) => set({ player }),
      updatePlayer: (updates) =>
        set((state) => ({
          player: state.player ? { ...state.player, ...updates } : null,
        })),
      setInventory: (inventory) => set({ inventory }),
      addInventoryItem: (item) =>
        set((state) => ({ inventory: [...state.inventory, item] })),
      toggleEquip: (itemId) =>
        set((state) => ({
          inventory: state.inventory.map((i) =>
            i.item_id === itemId ? { ...i, equipped: !i.equipped } : i,
          ),
        })),
      setVerified: (isVerified) => set({ isVerified }),
      clearPlayer: () => set({ player: null, inventory: [], isVerified: false }),
    }),
    {
      name: 'valor-player',
      partialize: (state) => ({ isVerified: state.isVerified }),
    },
  ),
)
