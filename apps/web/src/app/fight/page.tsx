'use client';

import { useMemo } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { usePlayerStore } from '@/stores/usePlayerStore';
import type { StageId } from '@/engine/scene/ArenaStage';

const GameScene = dynamic(
  () => import('@/engine/scene/GameScene').then((m) => m.GameScene),
  {
    ssr: false,
    loading: () => (
      <div className="fixed inset-0 bg-black flex items-center justify-center">
        <div className="text-center">
          <div className="text-2xl font-black text-white mb-2">LOADING ARENA</div>
          <div className="text-sm text-white/40">Preparing combat...</div>
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
  const router = useRouter();

  const { playerClass, enemyClass, enemyName, stageId } = useMemo(() => {
    const pc = CLASS_MAP[player?.character_class ?? 'Berserker'] ?? 'berserker';
    const availableEnemies = ENEMY_CLASSES.filter((c) => c !== pc);
    const ec = availableEnemies[Math.floor(Math.random() * availableEnemies.length)];
    const names = ENEMY_NAMES[ec];
    const name = names[Math.floor(Math.random() * names.length)];
    const stage = CLASS_STAGES[ec];
    return { playerClass: pc, enemyClass: ec, enemyName: name, stageId: stage };
  }, [player?.character_class]);

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
      <div className="fixed top-4 right-4 z-50 text-[10px] font-mono text-white/30 pointer-events-none select-none">
        {process.env.NEXT_PUBLIC_BUILD_SHA} · {process.env.NEXT_PUBLIC_BUILD_TIME}
      </div>

      <GameScene
        playerClass={playerClass}
        enemyClass={enemyClass}
        enemyName={enemyName}
        stageId={stageId}
      />
    </div>
  );
}
