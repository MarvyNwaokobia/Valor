'use client';

import dynamic from 'next/dynamic';
import { useCallback, useState } from 'react';
import { Rajdhani } from 'next/font/google';
import { useFightRewards } from '@/hooks/useFightRewards';

// The tactical HUD face (see /dev/verb) — exposed as a CSS var for the scene.
const tactical = Rajdhani({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-tactical',
  display: 'swap',
});

// The live game is now the Valor first-person build. The previous turn-based /
// melee campaign is preserved, fully playable, at /fight-legacy (its engine code
// is untouched) in case any of it is reused.
const ValorScene = dynamic(
  () => import('@/engine/scene/ValorScene').then((m) => m.ValorScene),
  {
    ssr: false,
    loading: () => (
      <div className="fixed inset-0 bg-black flex items-center justify-center">
        <div className="text-center">
          <div className="text-2xl font-black text-white mb-2">LOADING OPERATION</div>
          <div className="text-sm text-white/40">Gearing up...</div>
          <div className="mt-4 w-48 h-1 bg-white/10 rounded-full overflow-hidden mx-auto">
            <div className="h-full bg-cyan-400 rounded-full animate-pulse w-2/3" />
          </div>
        </div>
      </div>
    ),
  },
);

export default function FightPage() {
  const { submitResult } = useFightRewards();

  // The operation is chosen OUTSIDE the game (Campaign → Operations list), which
  // routes here as /fight?op=N — so we boot straight into that operation.
  const [startMission] = useState(() => {
    if (typeof window === 'undefined') return undefined;
    const v = Number(new URLSearchParams(window.location.search).get('op'));
    return Number.isFinite(v) && v >= 0 ? v : undefined;
  });

  // Each cleared operation is a server-authoritative "fight win": the backend
  // applies the real XP → rank → G$ and advances the PvE level. If the player
  // isn't signed in, submitResult is a graceful no-op (the game still plays).
  const onOpCleared = useCallback(
    (level: number, durationSecs: number) => {
      submitResult(true, durationSecs, level).catch(() => { /* offline / signed out */ });
    },
    [submitResult],
  );

  return (
    <div className={tactical.variable} style={{ position: 'fixed', inset: 0 }}>
      <ValorScene onOpCleared={onOpCleared} startMission={startMission} />
    </div>
  );
}
