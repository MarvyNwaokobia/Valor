'use client'

import { Suspense } from 'react'
import FaceOffPage from '@/views/FaceOffPage'
import LoadingScreen from '@/components/ui/LoadingScreen'

export default function Page() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <FaceOffPage />
    </Suspense>
  )
}
