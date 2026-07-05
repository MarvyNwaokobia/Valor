'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getMagic } from '@/lib/magic'

export default function AuthCallbackPage() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const magic = getMagic()
    if (!magic) return
    magic.oauth2
      .getRedirectResult()
      .then(() => router.replace('/'))
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Sign-in failed — please try again.')
      })
  }, [router])

  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center" style={{ background: '#04030c' }}>
      {error ? (
        <>
          <p className="font-display font-black text-white text-xl">Sign-in failed</p>
          <p className="text-slate-400 text-sm max-w-xs">{error}</p>
          <button
            onClick={() => router.replace('/')}
            className="mt-2 px-6 py-3 rounded-xl font-bold text-sm text-black"
            style={{ background: '#eab308' }}
          >
            Back to Valor
          </button>
        </>
      ) : (
        <p className="font-display font-black text-white text-lg">Signing you in…</p>
      )}
    </div>
  )
}
