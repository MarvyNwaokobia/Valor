'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter, useSearchParams } from 'next/navigation';
import { AnimatePresence } from 'framer-motion';
import { usePlayerStore } from '@/stores/usePlayerStore';
import { useFightRewards } from '@/hooks/useFightRewards';
import { equippedGunId } from '@/lib/guns';
import { getLevel, CAMPAIGN_LENGTH } from '@/engine/campaign/levels';
import { getMission } from '@/engine/campaign/missions';
import { retryImport } from '@/lib/retryImport';
import { AIDifficulty } from '@/engine/combat';
import type { StageId } from '@/engine/scene/ArenaStage';
import { StoryPanel } from '@/engine/story/StoryPanel';
import { ChapterIntro } from '@/engine/story/ChapterIntro';
import {
  STORY,
  ZONE_META,
  zoneFor,
  isZoneOpener,
  type ClassId,
} from '@/engine/story/storyContent';

const GameScene = dynamic(
  () => retryImport(() => import('@/engine/scene/GameScene')).then((m) => m.GameScene),
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

// Flow: zone_intro → pre_dialogue → fighting → post_dialogue → result
// zone_intro and pre_dialogue only appear on first clear of a level.
// post_dialogue only appears on a first-clear win that has after-lines.
// Retries and replays go straight to fighting.
type FlowStage = 'zone_intro' | 'pre_dialogue' | 'fighting' | 'post_dialogue' | 'result';

const CLASS_MAP: Record<string, ClassId> = {
  Berserker: 'berserker',
  Sentinel:  'sentinel',
  Phantom:   'phantom',
};

const ENEMY_CLASSES: ClassId[] = ['berserker', 'sentinel', 'phantom'];

const ENEMY_NAMES: Record<ClassId, string[]> = {
  berserker: ['Rogue Berserker', 'Fire Marauder', 'Forge Breaker'],
  sentinel:  ['Iron Guardian',   'Shield Warden',  'Holy Knight'],
  phantom:   ['Void Stalker',    'Shadow Dancer',  'Rift Walker'],
};

const CLASS_STAGES: Record<ClassId, StageId> = {
  berserker: 'lava_arena',
  sentinel:  'battle_arena',
  phantom:   'scifi_stage',
};

export default function FightPage() {
  const player    = usePlayerStore((s) => s.player);
  const inventory = usePlayerStore((s) => s.inventory);
  const router    = useRouter();
  const searchParams = useSearchParams();
  const { startFight, submitResult, reward, pending } = useFightRewards();

  // ?level=N → PvE Campaign fight; absent → quick random bot fight.
  const levelParam = searchParams.get('level');
  const level      = levelParam ? parseInt(levelParam, 10) : undefined;

  // Open the server-authoritative fight session for a Campaign fight (the token that
  // fixes wallet + level + start time server-side). Runs once the level is known;
  // pre-fight dialogue time only makes the server-measured duration safely longer.
  useEffect(() => {
    if (level) startFight(level).catch(() => { /* offline / signed out */ });
  }, [level, startFight]);

  // Player's class in lowercase ClassId form.
  const playerClass: ClassId =
    CLASS_MAP[player?.character_class ?? 'Berserker'] ?? 'berserker';

  // First clear: this is the first time the player is attempting this level.
  // pve_level tracks the highest level already cleared (0 = none cleared yet).
  const firstClear = !!level && level > (player?.pve_level ?? 0);

  // Story content for this level + class (undefined for quick fights or replays).
  const levelStory = useMemo(() => {
    if (!level || !firstClear) return undefined;
    return STORY[playerClass]?.[level];
  }, [level, firstClear, playerClass]);

  // Zone metadata for the zone-intro card (shown only at zone openers on first clear).
  const zoneMeta = useMemo(() => {
    if (!level || !firstClear || !isZoneOpener(level)) return undefined;
    const zone = zoneFor(level);
    return ZONE_META[playerClass]?.[zone];
  }, [level, firstClear, playerClass]);

  // Determine the initial flow stage.
  const initialStage = useMemo((): FlowStage => {
    if (!level || !firstClear) return 'fighting';
    if (zoneMeta)              return 'zone_intro';
    if (levelStory?.before.length) return 'pre_dialogue';
    return 'fighting';
  }, [level, firstClear, zoneMeta, levelStory]);

  const [flowStage, setFlowStage] = useState<FlowStage>(initialStage);

  // Track the fight result so we can decide whether to show post-dialogue.
  const [fightWinner, setFightWinner] = useState<'player' | 'enemy' | null>(null);

  const playerGun = useMemo(() => equippedGunId(inventory), [inventory]);

  // Build the fight config from the campaign level or fall back to a quick fight.
  const fight = useMemo(() => {
    const pc = playerClass;
    const lvl = level ? getLevel(level) : undefined;

    if (lvl) {
      return {
        playerClass: pc,
        enemyClass:  lvl.enemyClass,
        enemyName:   lvl.name,
        stageId:     lvl.stageId,
        enemyGun:    lvl.enemyGun,
        enemyHpMult: lvl.enemyHpMult,
        difficulty:  lvl.difficulty,
      };
    }

    const availableEnemies = ENEMY_CLASSES.filter((c) => c !== pc);
    const ec    = availableEnemies[Math.floor(Math.random() * availableEnemies.length)];
    const names = ENEMY_NAMES[ec];
    return {
      playerClass: pc,
      enemyClass:  ec,
      enemyName:   names[Math.floor(Math.random() * names.length)],
      stageId:     CLASS_STAGES[ec],
      enemyGun:    'sidearm' as const,
      enemyHpMult: 1,
      difficulty:  AIDifficulty.Medium,
    };
  }, [playerClass, level]);

  const handleBattleEnd = useCallback(
    (winner: 'player' | 'enemy') => {
      setFightWinner(winner);
      submitResult(winner === 'player');

      const hasPostLines = (levelStory?.after?.length ?? 0) > 0;
      if (winner === 'player' && firstClear && hasPostLines) {
        setFlowStage('post_dialogue');
      } else {
        setFlowStage('result');
      }
    },
    [submitResult, level, levelStory, firstClear]
  );

  // Post-fight action buttons — only visible once any post-dialogue is done.
  const postFightActions =
    flowStage === 'result' ? (
      <div className="mt-8 flex flex-col gap-3 w-full max-w-xs">
        <button
          onClick={() => window.location.reload()}
          className="w-full py-3 font-black text-sm uppercase tracking-wider rounded-xl transition-colors bg-white/10 hover:bg-white/20 text-white"
        >
          {level ? `Retry Level ${level}` : 'Retry'}
        </button>

        {level && fightWinner === 'player' && level < CAMPAIGN_LENGTH && (
          <button
            onClick={() => router.push(`/fight-legacy?level=${level + 1}`)}
            className="w-full py-3 font-black text-sm uppercase tracking-wider rounded-xl text-black transition-colors"
            style={{ background: 'linear-gradient(135deg, #fde047, #eab308)' }}
          >
            Next Level →
          </button>
        )}

        {level && fightWinner === 'player' && level >= CAMPAIGN_LENGTH && (
          <div className="text-center text-amber-400 text-sm font-bold py-2">
            Campaign Complete — Endless Mode Unlocked
          </div>
        )}

        <button
          onClick={() => router.push('/battle')}
          className="w-full py-3 font-bold text-sm uppercase tracking-wider rounded-xl border transition-colors text-slate-400 hover:text-white"
          style={{ borderColor: 'rgba(42,42,58,0.6)', background: 'transparent' }}
        >
          Return Home
        </button>
      </div>
    ) : null;

  return (
    <div className="fixed inset-0 bg-black z-40">
      <button
        onClick={() => router.push('/battle')}
        className="fixed top-3 right-3 z-50 px-3.5 py-1.5 bg-black/50 hover:bg-black/70 text-white/70 hover:text-white text-xs font-bold uppercase tracking-wider rounded-lg backdrop-blur-sm transition-colors pointer-events-auto"
        style={{ paddingTop: 'max(6px, env(safe-area-inset-top, 6px))' }}
      >
        Exit
      </button>

      {/* ── Zone intro card (first level of each zone, first clear only) ── */}
      <AnimatePresence>
        {flowStage === 'zone_intro' && zoneMeta && (
          <ChapterIntro
            key="zone-intro"
            zoneNumber={zoneMeta.number}
            zoneName={zoneMeta.name}
            tagline={zoneMeta.tagline}
            onComplete={() =>
              levelStory?.before.length
                ? setFlowStage('pre_dialogue')
                : setFlowStage('fighting')
            }
          />
        )}
      </AnimatePresence>

      {/* ── Pre-battle dialogue (first clear only) ── */}
      <AnimatePresence>
        {flowStage === 'pre_dialogue' && levelStory && (
          <StoryPanel
            key="pre-dialogue"
            scene={{ id: `pre-${level}-${playerClass}`, lines: levelStory.before }}
            onComplete={() => setFlowStage('fighting')}
          />
        )}
      </AnimatePresence>

      {/* ── The actual fight (always present once fighting starts) ── */}
      {(flowStage === 'fighting' || flowStage === 'post_dialogue' || flowStage === 'result') && (
        <GameScene
          playerClass={fight.playerClass}
          enemyClass={fight.enemyClass}
          enemyName={fight.enemyName}
          stageId={fight.stageId}
          playerGun={playerGun}
          enemyGun={fight.enemyGun}
          enemyHpMult={fight.enemyHpMult}
          difficulty={fight.difficulty}
          // Walk-to-find mission staging for campaign levels that have one;
          // retries/replays spawn closer so repeat attempts skip the hike.
          mission={level ? getMission(level) : undefined}
          missionRetry={!firstClear}
          onBattleEnd={handleBattleEnd}
          reward={reward}
          rewardPending={pending}
          postFightActions={postFightActions}
        />
      )}

      {/* ── Post-battle dialogue overlay on win (first clear only) ── */}
      <AnimatePresence>
        {flowStage === 'post_dialogue' && levelStory?.after && (
          <StoryPanel
            key="post-dialogue"
            scene={{ id: `post-${level}-${playerClass}`, lines: levelStory.after }}
            onComplete={() => setFlowStage('result')}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
