'use client'

import { Suspense } from 'react'
import FriendsPage from '@/views/FriendsPage'
import LoadingScreen from '@/components/ui/LoadingScreen'

export default function Page() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <FriendsPage />
    </Suspense>
  )
}
