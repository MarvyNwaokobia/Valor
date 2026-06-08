import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Player, InventoryItem } from '@/types'

interface PlayerState {
  player: Player | null
  inventory: InventoryItem[]
  isVerified: boolean
  playerSynced: boolean
  syncFailed: boolean
  setPlayer: (player: Player) => void
  updatePlayer: (updates: Partial<Player>) => void
  setInventory: (inventory: InventoryItem[]) => void
  addInventoryItem: (item: InventoryItem) => void
  removeInventoryItem: (itemId: string) => void
  toggleEquip: (itemId: string) => void
  setVerified: (verified: boolean) => void
  setPlayerSynced: (synced: boolean) => void
  setSyncFailed: (failed: boolean) => void
  clearPlayer: () => void
}

export const usePlayerStore = create<PlayerState>()(
  persist(
    (set) => ({
      player: null,
      inventory: [],
      isVerified: false,
      playerSynced: false,
      syncFailed: false,

      setPlayer: (player) => set({ player }),
      updatePlayer: (updates) =>
        set((state) => ({
          player: state.player ? { ...state.player, ...updates } : null,
        })),
      setInventory: (inventory) => set({ inventory }),
      addInventoryItem: (item) =>
        set((state) => ({ inventory: [...state.inventory, item] })),
      removeInventoryItem: (itemId) =>
        set((state) => ({ inventory: state.inventory.filter((i) => i.item_id !== itemId) })),
      toggleEquip: (itemId) =>
        set((state) => ({
          inventory: state.inventory.map((i) =>
            i.item_id === itemId ? { ...i, equipped: !i.equipped } : i,
          ),
        })),
      setVerified: (isVerified) => set({ isVerified }),
      setPlayerSynced: (playerSynced) => set({ playerSynced }),
      setSyncFailed: (syncFailed) => set({ syncFailed }),
      clearPlayer: () => set({ player: null, inventory: [], isVerified: false, playerSynced: false, syncFailed: false }),
    }),
    {
      name: 'valor-player',
      partialize: (state) => ({
        isVerified: state.isVerified,
        player:     state.player,
        inventory:  state.inventory,
      }),
    },
  ),
)
