import { describe, it, expect } from 'vitest';
import { xpForKill, rankForXp, rankIndexForXp, xpIntoRank, rankUpsBetween, gReward, XP_REWARD, XP_PER_RANK } from '../xp';

describe('earn loop: XP per kill', () => {
  it('a body kill is worth the base, a headshot kill more', () => {
    expect(xpForKill('torso')).toBe(XP_REWARD.KILL);
    expect(xpForKill('leg')).toBe(XP_REWARD.KILL);
    expect(xpForKill('arm')).toBe(XP_REWARD.KILL);
    expect(xpForKill('head')).toBe(XP_REWARD.KILL + XP_REWARD.HEADSHOT_BONUS);
    expect(xpForKill('head')).toBeGreaterThan(xpForKill('torso'));
  });

  it('the kills in a level sum to the level XP (Marvy\'s spec)', () => {
    const kills: Array<Parameters<typeof xpForKill>[0]> = ['torso', 'head', 'leg', 'torso', 'head'];
    const total = kills.reduce((sum, p) => sum + xpForKill(p), 0);
    expect(total).toBe(3 * XP_REWARD.KILL + 2 * (XP_REWARD.KILL + XP_REWARD.HEADSHOT_BONUS));
  });
});

describe('earn loop: rank from XP', () => {
  it('starts at Bronze and ranks up every 1000 XP', () => {
    expect(rankForXp(0)).toBe('Bronze');
    expect(rankForXp(999)).toBe('Bronze');
    expect(rankForXp(1000)).toBe('Silver');
    expect(rankForXp(2000)).toBe('Gold');
    expect(rankForXp(3000)).toBe('Platinum');
    expect(rankForXp(4000)).toBe('Diamond');
  });

  it('caps at the top rank instead of overflowing', () => {
    expect(rankForXp(99999)).toBe('Diamond');
    expect(rankIndexForXp(99999)).toBe(4);
  });

  it('reports progress into the current rank', () => {
    expect(xpIntoRank(0)).toBe(0);
    expect(xpIntoRank(340)).toBe(340);
    expect(xpIntoRank(1340)).toBe(340);
    expect(xpIntoRank(50000)).toBe(XP_PER_RANK); // maxed reads as full
  });

  it('detects crossing 1000 and names the rank reached', () => {
    expect(rankUpsBetween(980, 1005)).toEqual(['Silver']);
    expect(rankUpsBetween(0, 999)).toEqual([]);
    expect(rankUpsBetween(1999, 2000)).toEqual(['Gold']);
  });

  it('announces every rank crossed by one big XP drop', () => {
    expect(rankUpsBetween(900, 2100)).toEqual(['Silver', 'Gold']);
  });

  it('pays the live game G$ amounts per rank', () => {
    expect(gReward('Silver')).toBe(20);
    expect(gReward('Diamond')).toBe(150);
    expect(gReward('Diamond')).toBeGreaterThan(gReward('Bronze'));
  });
});
