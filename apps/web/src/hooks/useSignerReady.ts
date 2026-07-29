'use client'

import { useActiveWalletClient } from './useActiveWalletClient'
import { useResolvedAuth } from './useResolvedAuth'

// Can this session actually SIGN, as opposed to merely being signed in?
//
// Those are different questions and the app used to conflate them. A session is
// "signed in" as soon as an address has been resolved, but signing needs a live
// provider behind that address — and an external wallet can lose its provider
// while the address survives. In a plain mobile browser there is no
// window.ethereum at all, and since the WalletConnect connector was removed
// (968926d) there is no in-page route to the wallet app either, so an
// external-wallet session there can never sign anything.
//
// The result was a session that looked completely live — balance, stats, every
// button enabled — and only revealed the truth as "Wallet not connected" at the
// moment the player tried to spend money. That is the worst possible place to
// find out.
//
// Derived from useActiveWalletClient rather than re-deriving the rules, so this
// can never disagree with what actually happens when a signature is requested:
// no client means no signature, whatever the reason.
export function useSignerReady(): { signedIn: boolean; canSign: boolean } {
  const { status } = useResolvedAuth()
  const walletClient = useActiveWalletClient()
  const signedIn = status === 'ready'
  return { signedIn, canSign: signedIn && !!walletClient?.account }
}
