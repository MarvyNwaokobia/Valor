'use client'

import { useMagicAuthContext, type ResolvedAuthStatus } from '@/components/providers/MagicAuthProvider'

export type { ResolvedAuthStatus }

// Every page reads auth through this hook — it's the one seam that decides
// what "signed in" means. Backed by MagicAuthProvider (Magic.link embedded
// wallet); swapping providers later only means changing what that provider
// puts in context.
export function useResolvedAuth() {
  const { status, address } = useMagicAuthContext()
  return { status, address }
}
