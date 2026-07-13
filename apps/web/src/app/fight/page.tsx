'use client';

import dynamic from 'next/dynamic';
import { Suspense, useCallback, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { Rajdhani } from 'next/font/google';
import { useFightRewards } from '@/hooks/useFightRewards';
import { usePlayerStore } from '@/stores/usePlayerStore';
import { equippedGunId } from '@/lib/guns';

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
    // The game boots into a black scene anyway — keep the transition minimal
    // (a subtle spinner), not a full branded loading page.
    loading: () => (
      <div className="fixed inset-0 bg-black flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-white/15 border-t-cyan-400 animate-spin" />
      </div>
    ),
  },
);

function FightInner() {
  const { submitResult } = useFightRewards();
  const walletAddress = usePlayerStore((s) => s.player?.wallet_address);
  // C1: the real account rank + XP so the in-game HUD reflects true server standing.
  const accountRank = usePlayerStore((s) => s.player?.rank);
  const accountXp = usePlayerStore((s) => s.player?.xp);
  // The server-authoritative campaign progress — used to RESUME at the right op when
  // no specific op was chosen, even after a sign-out cleared local storage.
  const pveLevel = usePlayerStore((s) => s.player?.pve_level);

  // A: the gun the player bought + equipped in the marketplace. The scene carries it
  // as the op primary whenever it out-tiers the op's issued weapon, so buying a
  // better gun actually shows up in the fight.
  const inventory = usePlayerStore((s) => s.inventory);
  const equippedGun = useMemo(() => equippedGunId(inventory), [inventory]);

  // The operation is chosen OUTSIDE the game (Campaign → Operations list), which
  // routes here as /fight?op=N. Read it via useSearchParams (NOT window.location,
  // which reads stale on client-side navigation — that made a clicked op boot op 1).
  const searchParams = useSearchParams();
  const opParam = searchParams.get('op');
  const startMission =
    opParam !== null && opParam !== '' && Number.isFinite(Number(opParam)) && Number(opParam) >= 0
      ? Number(opParam)
      : undefined;

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
      <ValorScene
        onOpCleared={onOpCleared}
        startMission={startMission}
        resumeLevel={pveLevel}
        walletAddress={walletAddress}
        accountRank={accountRank}
        accountXp={accountXp}
        equippedGun={equippedGun}
      />
    </div>
  );
}

export default function FightPage() {
  // useSearchParams needs a Suspense boundary.
  return (
    <Suspense fallback={<div className="fixed inset-0 bg-black" />}>
      <FightInner />
    </Suspense>
  );
}
