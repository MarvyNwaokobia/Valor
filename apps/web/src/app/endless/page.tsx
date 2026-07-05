'use client';

import { useCallback, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { usePlayerStore } from '@/stores/usePlayerStore';
import { useResolvedAuth } from '@/hooks/useResolvedAuth';
import { useFightRewards } from '@/hooks/useFightRewards';
import { equippedGunId } from '@/lib/guns';
import { endlessLevel } from '@/engine/campaign/levels';
import { submitEndlessScore } from '@/hooks/useLeaderboard';
import Leaderboard from '@/components/battle/Leaderboard';

const GameScene = dynamic(
  () => import('@/engine/scene/GameScene').then((m) => m.GameScene),
  {
    ssr: false,
    loading: () => (
      <div className="fixed inset-0 bg-black flex items-center justify-center">
        <div className="text-2xl font-black text-white">LOADING ENDLESS…</div>
      </div>
    ),
  }
);

type ClassId = 'berserker' | 'sentinel' | 'phantom';
const CLASS_MAP: Record<string, ClassId> = { Berserker: 'berserker', Sentinel: 'sentinel', Phantom: 'phantom' };

export default function EndlessPage() {
  const player = usePlayerStore((s) => s.player);
  const inventory = usePlayerStore((s) => s.inventory);
  const { address } = useResolvedAuth();
  const router = useRouter();
  const { submitResult } = useFightRewards();

  const [wave, setWave] = useState(1);
  const [dead, setDead] = useState(false);

  const playerClass = CLASS_MAP[player?.character_class ?? 'Berserker'] ?? 'berserker';
  const playerGun = useMemo(() => equippedGunId(inventory), [inventory]);
  const lvl = useMemo(() => endlessLevel(wave), [wave]);

  const onBattleEnd = useCallback(
    (winner: 'player' | 'enemy', durationSecs: number) => {
      if (winner === 'player') {
        submitResult(true, durationSecs); // flat XP per wave (no Campaign level)
        setWave((w) => w + 1);
      } else {
        const wavesCleared = wave - 1;
        if (address) submitEndlessScore(address, wavesCleared);
        setDead(true);
      }
    },
    [wave, address, submitResult]
  );

  if (!player) {
    router.replace('/');
    return null;
  }

  if (dead) {
    const wavesCleared = wave - 1;
    return (
      <div className="fixed inset-0 z-50 overflow-y-auto flex flex-col items-center px-6 py-10" style={{ background: '#04030c' }}>
        <p className="text-[10px] uppercase tracking-[0.3em] font-bold text-red-400 mb-1">Endless Over</p>
        <h1 className="font-display font-black text-white" style={{ fontSize: 'clamp(3rem, 12vw, 5rem)' }}>
          {wavesCleared}
        </h1>
        <p className="text-slate-400 text-sm mb-8">waves survived</p>

        <div className="mb-8">
          <Leaderboard highlightWallet={address} />
        </div>

        <div className="flex gap-3">
          <button
            onClick={() => { setWave(1); setDead(false); }}
            className="px-6 py-3 rounded-xl font-display font-black text-black"
            style={{ background: '#eab308' }}
          >
            Run Again
          </button>
          <button
            onClick={() => router.push('/')}
            className="px-6 py-3 rounded-xl font-display font-black text-white border border-valor-border"
          >
            Exit
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black z-40">
      <button
        onClick={() => router.push('/')}
        className="fixed top-4 left-4 z-50 px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white/60 text-sm rounded-lg pointer-events-auto"
      >
        Exit
      </button>
      <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 font-display font-black text-amber-400 text-lg pointer-events-none select-none">
        WAVE {wave}
      </div>

      <GameScene
        key={wave}
        playerClass={playerClass}
        enemyClass={lvl.enemyClass}
        enemyName={lvl.name}
        stageId={lvl.stageId}
        playerGun={playerGun}
        enemyGun={lvl.enemyGun}
        enemyHpMult={lvl.enemyHpMult}
        difficulty={lvl.difficulty}
        onBattleEnd={onBattleEnd}
      />
    </div>
  );
}
