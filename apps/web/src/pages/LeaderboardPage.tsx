import { useConnection } from 'wagmi'
import LeaderboardTable from '@/components/leaderboard/LeaderboardTable'

export default function LeaderboardPage() {
  const { address } = useConnection()

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-display font-bold text-white">Leaderboard</h1>
        <p className="text-slate-400 text-sm mt-1">Top 50 warriors ranked by tier and XP.</p>
      </div>
      <LeaderboardTable currentWallet={address} />
    </div>
  )
}
