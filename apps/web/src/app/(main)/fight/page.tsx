'use client';

import dynamic from 'next/dynamic';

const GameScene = dynamic(
  () => import('@/engine/scene/GameScene').then((m) => m.GameScene),
  { ssr: false }
);

export default function FightPage() {
  return (
    <div className="fixed inset-0 bg-black">
      <GameScene
        playerClass="berserker"
        enemyClass="sentinel"
        stageId="lava_arena"
      />
    </div>
  );
}
