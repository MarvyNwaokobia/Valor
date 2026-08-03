import { create } from 'zustand'
import { useQuery } from '@tanstack/react-query'
import { createPublicClient, http, erc20Abi, formatUnits } from 'viem'
import { avalanche } from 'viem/chains'
import { CELO_CHAIN_ID } from '@/lib/constants'
import { AVALANCHE_EDITION } from '@/editions/avalanche/config'
import type { Item } from '@/types/database'

/**
 * Which currency the shop is spending in.
 *
 * The Bank asks "how do you want to be PAID". This asks "how do you want to
 * PAY". Same idea, same reason: the chain is a property of a transaction, not of
 * a person, so one player can spend either without being forked into a separate
 * edition or a separate player base.
 */
export const AVALANCHE_CHAIN_ID = AVALANCHE_EDITION.chain.id

interface ShopCurrencyState {
  chainId: number
  setChainId: (id: number) => void
}

/**
 * Defaults to Celo, always. A player who has never heard of Scrip sees exactly
 * the shop they saw yesterday, priced in the currency they already earn.
 */
export const useShopCurrencyStore = create<ShopCurrencyState>((set) => ({
  chainId: CELO_CHAIN_ID,
  setChainId: (id) => set({ chainId: id }),
}))

/**
 * The player's SPENDABLE Scrip: the ERC-20 balance actually in their wallet.
 *
 * Deliberately not the accrued balance from `/claimable`. Accrued Scrip is a
 * number in our database that no contract has heard of — offering to spend it
 * would produce a permit for tokens the buyer does not hold, and a revert.
 * They have to claim it in the Bank first, which is the whole point of the
 * claim step.
 *
 * Read with a plain HTTP client rather than the session's wallet client: this is
 * a read, and the wallet client is unreliable on mobile Safari where ITP can
 * evict its storage.
 */
export function useScripBalance(walletAddress: string | undefined) {
  return useQuery({
    queryKey: ['scrip-balance', walletAddress],
    queryFn: async (): Promise<number> => {
      const token = AVALANCHE_EDITION.currency.address
      if (!token || !walletAddress) return 0
      const client = createPublicClient({
        chain: avalanche,
        transport: http(AVALANCHE_EDITION.chain.rpcUrl),
      })
      const raw = await client.readContract({
        address: token,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [walletAddress as `0x${string}`],
      })
      return Number(formatUnits(raw, AVALANCHE_EDITION.currency.decimals))
    },
    enabled: !!walletAddress && !!AVALANCHE_EDITION.currency.address,
    staleTime: 30_000,
    // A read failure must not look like a zero balance forever; retry quietly.
    retry: 1,
  })
}

/**
 * What this item costs on a given chain, or `null` if it is not sold there.
 *
 * `null` is the important case and callers MUST disable buying on it rather than
 * falling back to the other chain's number. The same rifle is 1,200 G$ and 6,000
 * SCRP; substituting one for the other produces a permit signature that
 * disagrees with the on-chain listing, and `permit()` rejects it — after the
 * player has already approved. A greyed-out button is a far better outcome than
 * a mystery revert.
 */
export function itemPriceOn(item: Item, chainId: number): number | null {
  if (chainId === CELO_CHAIN_ID) return item.price_g
  const p = item.chain_prices?.[String(chainId)]
  return typeof p === 'number' ? p : null
}

/** Ticker for the shop's active currency. */
export function currencySymbolFor(chainId: number): string {
  return chainId === CELO_CHAIN_ID ? 'G$' : AVALANCHE_EDITION.currency.symbol
}
