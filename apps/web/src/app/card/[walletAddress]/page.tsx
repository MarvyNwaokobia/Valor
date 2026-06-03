'use client'

import { Suspense } from 'react'
import PlayerCardPage from '@/views/PlayerCardPage'
import LoadingScreen from '@/components/ui/LoadingScreen'

export default function Page() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <PlayerCardPage />
    </Suspense>
  )
}
