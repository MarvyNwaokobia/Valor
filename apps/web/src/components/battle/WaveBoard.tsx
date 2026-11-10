'use client';

import { useCallback, useEffect, useState } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080';

const MEDALS: Record<number, string> = { 1: '#eab308', 2: '#cbd5e1', 3: '#d97757' };

export interface WaveBoardEntry {
  rank: number;
  wallet_address: string;
  username: string | null;
  waves: number;
  est_payout_g?: number;
  group?: string | null;
}

/**
 * The wave ladder, shared by Campaign Endless and the Seasonal Campaign.
 *
 * Ranked by WAVES COMPLETED — the same number the player watches climb in the HUD —
 * with ties broken by who reached that wave first, so no two players ever share a
 * place. Omit `seasonId` for the all-time Campaign Endless board.
 */
export default function WaveBoard({
  seasonId,
  groupSlug,
  highlightWallet,
  limit = 25,
  title = 'Wave Leaderboard',
  podium = false,
}: {
  seasonId?: string;
  /** Show only this group's members (the group's own board). */
  groupSlug?: string;
  highlightWallet?: string;
  limit?: number;
  title?: string;
  /** Colour the top three ranks gold, silver and bronze. */
  podium?: boolean;
}) {
  const [entries, setEntries] = useState<WaveBoardEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams({ limit: String(limit) });
      if (seasonId) qs.set('season_id', seasonId);
      if (groupSlug && seasonId) qs.set('season_id', seasonId);
      const url = groupSlug
        ? `${API}/groups/${encodeURIComponent(groupSlug)}/board?${qs}`
        : `${API}/endless/board?${qs}`;
      const res = await fetch(url);
      if (res.ok) setEntries((await res.json()).entries ?? []);
    } catch {
      /* offline — show the empty state rather than breaking the page */
    } finally {
      setLoading(false);
    }
  }, [seasonId, groupSlug, limit]);

  useEffect(() => { load(); }, [load]);

  const top = Math.max(1, ...entries.map((e) => e.waves));

  return (
    <div className="w-full">
      <div className="flex items-end justify-between mb-4">
        <div>
          <p className="text-[10px] uppercase tracking-[0.3em] font-bold text-slate-500">{title}</p>
          {!loading && entries.length > 0 && (
            <p className="text-[11px] text-slate-600 mt-0.5">{entries.length} {entries.length === 1 ? 'player' : 'players'} ranked</p>
          )}
        </div>
        <button
          onClick={load}
          className="text-[10px] uppercase tracking-widest text-slate-500 hover:text-white px-2.5 py-1 rounded-md border border-slate-800 hover:border-slate-600 transition-colors"
        >
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="flex flex-col gap-2" aria-busy>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-14 rounded-xl animate-pulse" style={{ background: 'rgba(255,255,255,0.04)' }} />
          ))}
        </div>
      ) : entries.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-800 px-4 py-8 text-center">
          <p className="text-slate-400 text-sm font-bold">No one has cleared a wave yet</p>
          <p className="text-slate-600 text-xs mt-1">Be the first on the board.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {entries.map((e) => {
            const medal = podium ? MEDALS[e.rank] : undefined;
            const mine = e.wallet_address.toLowerCase() === (highlightWallet ?? '').toLowerCase();
            const name = e.username || `${e.wallet_address.slice(0, 6)}…${e.wallet_address.slice(-4)}`;
            const accent = mine ? '#eab308' : medal ?? '#475569';
            return (
              <div
                key={e.wallet_address}
                className="relative overflow-hidden rounded-xl"
                style={{
                  background: mine ? 'rgba(234,179,8,0.09)' : medal ? `${medal}10` : 'rgba(255,255,255,0.025)',
                  boxShadow: `inset 0 0 0 1px ${mine ? 'rgba(234,179,8,0.45)' : medal ? `${medal}40` : 'rgba(255,255,255,0.06)'}`,
                }}
              >
                {/* Progress toward the leader's wave count, drawn behind the row. */}
                <div
                  aria-hidden
                  className="absolute inset-y-0 left-0"
                  style={{ width: `${Math.max(4, (e.waves / top) * 100)}%`, background: `linear-gradient(90deg, ${accent}22, transparent)` }}
                />
                <div className="relative flex items-center gap-3 px-3 py-2.5">
                  <span
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-display font-black text-sm tabular-nums"
                    style={medal
                      ? { background: medal, color: '#0a0a0f' }
                      : { background: 'rgba(255,255,255,0.06)', color: '#94a3b8' }}
                  >
                    {e.rank}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-white text-sm font-bold leading-tight">
                      {name}
                      {mine && (
                        <span className="ml-2 align-middle text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded"
                              style={{ background: '#eab308', color: '#0a0a0f' }}>you</span>
                      )}
                    </p>
                    {e.group && (
                      <p className="text-[10px] uppercase tracking-widest text-slate-500 mt-0.5">{e.group}</p>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-white font-display font-black text-lg leading-none tabular-nums">{e.waves}</p>
                    <p className="text-[9px] uppercase tracking-widest text-slate-600 mt-0.5">waves</p>
                  </div>
                  {!!e.est_payout_g && e.est_payout_g > 0 && (
                    <div className="text-right shrink-0 pl-1 border-l border-white/10 ml-1">
                      <p className="text-amber-400 font-bold text-xs tabular-nums">{e.est_payout_g.toLocaleString()}</p>
                      <p className="text-[9px] uppercase tracking-widest text-amber-500/60">G$</p>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
