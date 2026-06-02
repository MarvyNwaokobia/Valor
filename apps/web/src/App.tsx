import { Routes, Route } from 'react-router-dom'
import { Suspense, lazy } from 'react'
import Layout from '@/components/layout/Layout'
import LoadingScreen from '@/components/ui/LoadingScreen'
import { usePlayerSync } from '@/hooks/usePlayerSync'
import { useConnection } from 'wagmi'

const HomePage = lazy(() => import('@/pages/HomePage'))
const OnboardingPage = lazy(() => import('@/pages/OnboardingPage'))
const ProfilePage = lazy(() => import('@/pages/ProfilePage'))
const BattlePage = lazy(() => import('@/pages/BattlePage'))
const MarketplacePage = lazy(() => import('@/pages/MarketplacePage'))
const LeaderboardPage = lazy(() => import('@/pages/LeaderboardPage'))
const PlayerCardPage = lazy(() => import('@/pages/PlayerCardPage'))

export default function App() {
  const { address } = useConnection()
  usePlayerSync(address)

  return (
    <Suspense fallback={<LoadingScreen />}>
      <Routes>
        {/* Public shareable player card — no layout wrapper */}
        <Route path="/card/:walletAddress" element={<PlayerCardPage />} />

        <Route element={<Layout />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/onboarding" element={<OnboardingPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/battle" element={<BattlePage />} />
          <Route path="/marketplace" element={<MarketplacePage />} />
          <Route path="/leaderboard" element={<LeaderboardPage />} />
        </Route>
      </Routes>
    </Suspense>
  )
}
