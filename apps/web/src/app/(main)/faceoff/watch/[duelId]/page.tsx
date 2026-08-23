'use client'

import { Suspense } from 'react'
import FaceOffSpectateView from '@/views/FaceOffSpectateView'
import LoadingScreen from '@/components/ui/LoadingScreen'

export default function Page() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <FaceOffSpectateView />
    </Suspense>
  )
}
