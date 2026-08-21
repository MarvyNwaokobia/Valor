'use client'

import { Suspense } from 'react'
import ChatThreadPage from '@/views/ChatThreadPage'
import LoadingScreen from '@/components/ui/LoadingScreen'

export default function Page() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <ChatThreadPage />
    </Suspense>
  )
}
