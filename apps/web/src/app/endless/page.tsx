'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { usePlayerStore } from '@/stores/usePlayerStore';
import { useResolvedAuth } from '@/hooks/useResolvedAuth';
import { useEndlessRun } from '@/hooks/useEndlessRun';
import { equippedGunId } from '@/lib/guns';
import { endlessLevel } from '@/engine/campaign/levels';
import { retryImport } from '@/lib/retryImport';
import Leaderboard from '@/components/battle/Leaderboard';

const GameScene = dynamic(
  () => retryImport(() => import('@/engine/scene/GameScene')).then((m) => m.GameScene),
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
  const { startRun, reportWave, endRun, banked } = useEndlessRun(address);

  const [wave, setWave] = useState(1);
  const [dead, setDead] = useState(false);
  const [toast, setToast] = useState<{ key: number; g: number } | null>(null); // +G$ per wave

  const playerClass = CLASS_MAP[player?.character_class ?? 'Berserker'] ?? 'berserker';
  const playerGun = useMemo(() => equippedGunId(inventory), [inventory]);
  const lvl = useMemo(() => endlessLevel(wave), [wave]);

  // Open a server-authoritative run when the page mounts.
  useEffect(() => { startRun(); }, [startRun]);

  // Auto-dismiss the +G$ toast a beat after it appears.
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 1400);
    return () => clearTimeout(id);
  }, [toast]);

  const onBattleEnd = useCallback(
    async (winner: 'player' | 'enemy') => {
      if (winner === 'player') {
        const result = await reportWave(); // server credits the wave + pays G$
        if (result && result.gAwarded > 0) setToast({ key: Date.now(), g: result.gAwarded });
        setWave((w) => w + 1);
      } else {
        await endRun(); // server writes the leaderboard score from its own count
        setDead(true);
      }
    },
    [reportWave, endRun]
  );

  const runAgain = useCallback(() => {
    setWave(1);
    setDead(false);
    startRun();
  }, [startRun]);

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
        <p className="text-slate-400 text-sm mb-4">waves survived</p>

        {banked > 0 && (
          <div className="mb-8 px-5 py-2.5 rounded-xl border flex items-center gap-2"
            style={{ background: 'rgba(234,179,8,0.08)', borderColor: 'rgba(234,179,8,0.3)' }}>
            <span className="font-display font-black text-amber-400 text-xl">+{banked.toLocaleString()} G$</span>
            <span className="text-[10px] uppercase tracking-widest text-amber-500/70 font-bold">banked this run</span>
          </div>
        )}

        <div className="mb-8">
          <Leaderboard highlightWallet={address} />
        </div>

        <div className="flex gap-3">
          <button
            onClick={runAgain}
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
      <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-0.5 pointer-events-none select-none">
        <span className="font-display font-black text-amber-400 text-lg">WAVE {wave}</span>
        {banked > 0 && (
          <span className="text-[11px] font-bold text-amber-500/80 tabular-nums">{banked.toLocaleString()} G$ banked</span>
        )}
      </div>

      {/* +G$ banked toast — fires once per paying wave, then auto-dismisses */}
      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast.key}
            className="fixed top-20 left-1/2 -translate-x-1/2 z-50 pointer-events-none select-none"
            initial={{ opacity: 0, y: 10, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -16 }}
            transition={{ duration: 0.35 }}
          >
            <span className="font-display font-black text-2xl px-4 py-1.5 rounded-full"
              style={{ color: '#04030c', background: '#eab308', boxShadow: '0 0 24px rgba(234,179,8,0.5)' }}>
              +{toast.g.toLocaleString()} G$
            </span>
          </motion.div>
        )}
      </AnimatePresence>

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
