'use client';

import { useCallback, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { useRouter, useSearchParams } from 'next/navigation';
import { usePlayerStore } from '@/stores/usePlayerStore';
import { useFightRewards } from '@/hooks/useFightRewards';
import { equippedGunId } from '@/lib/guns';
import { getLevel } from '@/engine/campaign/levels';
import { AIDifficulty } from '@/engine/combat';
import type { StageId } from '@/engine/scene/ArenaStage';

const GameScene = dynamic(
  () => import('@/engine/scene/GameScene').then((m) => m.GameScene),
  {
    ssr: false,
    loading: () => (
      <div className="fixed inset-0 bg-black flex items-center justify-center">
        <div className="text-center">
          <div className="text-2xl font-black text-white mb-2">LOADING ARENA</div>
          <div className="text-sm text-white/40">Locking in...</div>
          <div className="mt-4 w-48 h-1 bg-white/10 rounded-full overflow-hidden mx-auto">
            <div className="h-full bg-red-500 rounded-full animate-pulse w-2/3" />
          </div>
        </div>
      </div>
    ),
  }
);

type ClassId = 'berserker' | 'sentinel' | 'phantom';

const CLASS_MAP: Record<string, ClassId> = {
  Berserker: 'berserker',
  Sentinel: 'sentinel',
  Phantom: 'phantom',
};

const ENEMY_CLASSES: ClassId[] = ['berserker', 'sentinel', 'phantom'];

const ENEMY_NAMES: Record<ClassId, string[]> = {
  berserker: ['Rogue Berserker', 'Fire Marauder', 'Forge Breaker'],
  sentinel: ['Iron Guardian', 'Shield Warden', 'Holy Knight'],
  phantom: ['Void Stalker', 'Shadow Dancer', 'Rift Walker'],
};

const CLASS_STAGES: Record<ClassId, StageId> = {
  berserker: 'lava_arena',
  sentinel: 'battle_arena',
  phantom: 'scifi_stage',
};

export default function FightPage() {
  const player = usePlayerStore((s) => s.player);
  const inventory = usePlayerStore((s) => s.inventory);
  const router = useRouter();
  const searchParams = useSearchParams();
  const { submitResult, reward, pending } = useFightRewards();

  // ?level=N → a PvE Campaign fight; absent → a quick random bot fight.
  const levelParam = searchParams.get('level');
  const level = levelParam ? parseInt(levelParam, 10) : undefined;

  // The player fights with their equipped gun (or the starter sidearm).
  const playerGun = useMemo(() => equippedGunId(inventory), [inventory]);

  const handleBattleEnd = useCallback(
    (winner: 'player' | 'enemy', durationSecs: number) => {
      submitResult(winner === 'player', durationSecs, level);
    },
    [submitResult, level]
  );

  const fight = useMemo(() => {
    const pc = CLASS_MAP[player?.character_class ?? 'Berserker'] ?? 'berserker';

    // Campaign fight: the level defines the enemy class, gun, HP and difficulty.
    const lvl = level ? getLevel(level) : undefined;
    if (lvl) {
      return {
        playerClass: pc,
        enemyClass: lvl.enemyClass,
        enemyName: lvl.name,
        stageId: lvl.stageId,
        enemyGun: lvl.enemyGun,
        enemyHpMult: lvl.enemyHpMult,
        difficulty: lvl.difficulty,
      };
    }

    // Quick fight: random enemy with the starter gun.
    const availableEnemies = ENEMY_CLASSES.filter((c) => c !== pc);
    const ec = availableEnemies[Math.floor(Math.random() * availableEnemies.length)];
    const names = ENEMY_NAMES[ec];
    return {
      playerClass: pc,
      enemyClass: ec,
      enemyName: names[Math.floor(Math.random() * names.length)],
      stageId: CLASS_STAGES[ec],
      enemyGun: 'sidearm' as const,
      enemyHpMult: 1,
      difficulty: AIDifficulty.Medium,
    };
  }, [player?.character_class, level]);

  return (
    <div className="fixed inset-0 bg-black z-40">
      {/* Back button */}
      <button
        onClick={() => router.push('/')}
        className="fixed top-4 left-4 z-50 px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white/60 text-sm rounded-lg transition-colors pointer-events-auto"
      >
        Exit
      </button>

      {/* Build marker — confirms which deployed build this device is running */}
      <div className="fixed top-14 left-1/2 -translate-x-1/2 z-50 text-[10px] font-mono text-white/40 bg-black/40 px-2 py-0.5 rounded pointer-events-none select-none">
        build {process.env.NEXT_PUBLIC_BUILD_SHA} · {process.env.NEXT_PUBLIC_BUILD_TIME}
      </div>

      <GameScene
        playerClass={fight.playerClass}
        enemyClass={fight.enemyClass}
        enemyName={fight.enemyName}
        stageId={fight.stageId}
        playerGun={playerGun}
        enemyGun={fight.enemyGun}
        enemyHpMult={fight.enemyHpMult}
        difficulty={fight.difficulty}
        onBattleEnd={handleBattleEnd}
        reward={reward}
        rewardPending={pending}
      />
    </div>
  );
}
