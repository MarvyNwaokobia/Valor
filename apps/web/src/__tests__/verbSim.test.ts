import { describe, it, expect, vi, afterEach } from 'vitest';
import { VerbSim, type VerbEvent } from '@/engine/verb';

/**
 * Slice 1 (CLONE_PLAN.md): the Rift Edge state machine and the melee string,
 * driven headlessly the same way the scene drives them.
 */

const DT = 1 / 60;

function run(sim: VerbSim, seconds: number) {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) sim.step(DT);
}

function collect(sim: VerbSim): VerbEvent[] {
  const events: VerbEvent[] = [];
  sim.onEvent((e) => events.push(e));
  return events;
}

afterEach(() => vi.restoreAllMocks());

describe('RiftEdge throw', () => {
  it('embeds in a world block crossing its path', () => {
    const sim = new VerbSim({
      dummies: [],
      heroPos: [0, 8],
      blocks: [{ min: [-1, 0, 2], max: [1, 2, 2.6] }],
    });
    const events = collect(sim);

    sim.setCameraYaw(0); // forward = -z
    sim.setAiming(true);
    sim.pressAttack(); // aimed attack = throw
    run(sim, 1.0);

    const embed = events.find((e) => e.type === 'embed');
    expect(embed).toBeDefined();
    expect(embed!.type === 'embed' && embed!.target.kind).toBe('world');
    expect(sim.edgeState).toBe('embedded');
    expect(sim.armed).toBe(false);
  });

  it('embeds in a dummy on the way and applies throw damage', () => {
    const sim = new VerbSim({ dummies: [{ pos: [0, -4] }], heroPos: [0, 8] });
    const events = collect(sim);

    sim.setCameraYaw(0);
    sim.setAiming(true);
    sim.pressAttack();
    run(sim, 1.0);

    const embed = events.find((e) => e.type === 'embed');
    expect(embed!.type === 'embed' && embed!.target.kind).toBe('enemy');
    expect(sim.getDummies()[0].hp).toBe(60 - 22);
  });

  it('throws instantly on pressThrow, no aim-hold needed', () => {
    const sim = new VerbSim({ dummies: [{ pos: [0, -4] }], heroPos: [0, 8] });
    const events = collect(sim);

    sim.setCameraYaw(0); // camera facing the dummy; assist cone does the rest
    sim.pressThrow();
    run(sim, 1.0);

    const embed = events.find((e) => e.type === 'embed');
    expect(embed).toBeDefined();
    expect(embed!.type === 'embed' && embed!.target.kind).toBe('enemy');
  });

  it('pitches into the ground at max range when nothing is hit', () => {
    const sim = new VerbSim({ dummies: [], heroPos: [0, 8] });
    const events = collect(sim);

    sim.setCameraYaw(0);
    sim.setAiming(true);
    sim.pressAttack();
    run(sim, 2.0);

    const embed = events.find((e) => e.type === 'embed');
    expect(embed!.type === 'embed' && embed!.target.kind).toBe('ground');
  });
});

describe('RiftEdge recall', () => {
  it('returns along the arc to a MOVING hero and fires catch', () => {
    const sim = new VerbSim({ dummies: [], heroPos: [0, 8] });
    const events = collect(sim);

    sim.setCameraYaw(0);
    sim.setAiming(true);
    sim.pressAttack();
    run(sim, 2.0);
    expect(sim.edgeState).toBe('embedded');

    sim.setAiming(false);
    sim.setMove(1, 0); // strafe while the blade returns
    sim.pressRecall();
    run(sim, 2.5);

    expect(events.some((e) => e.type === 'recallStart')).toBe(true);
    expect(events.some((e) => e.type === 'catch')).toBe(true);
    expect(sim.edgeState).toBe('held');
    // Caught in the hand wherever the hero ended up, not at the old spot.
    expect(sim.edge.pos.distanceTo(sim.handPos())).toBeLessThan(0.01);
  });

  it('can be recalled mid-flight', () => {
    const sim = new VerbSim({ dummies: [], heroPos: [0, 8] });
    const events = collect(sim);

    sim.setCameraYaw(0);
    sim.setAiming(true);
    sim.pressAttack();
    run(sim, 0.15); // still flying
    expect(sim.edgeState).toBe('thrown');

    sim.pressRecall();
    run(sim, 2.0);
    expect(events.some((e) => e.type === 'catch')).toBe(true);
    expect(sim.edgeState).toBe('held');
  });

  it('sweeps a dummy standing along the return arc', () => {
    // Pin the arc's side so the mid-arc bulge is deterministic (-x).
    vi.spyOn(Math, 'random').mockReturnValue(0.9);

    const sim = new VerbSim({
      // Close to the hero, outside the 12° aim-assist cone and off the throw
      // line, but in the lane the return arc sweeps through on its way home.
      dummies: [{ pos: [-1.8, 3] }],
      heroPos: [0, 8],
    });
    const events = collect(sim);

    sim.setCameraYaw(0);
    sim.setAiming(true);
    sim.pressAttack();
    run(sim, 2.0); // ground embed far down -z
    expect(sim.getDummies()[0].hp).toBe(60); // untouched by the throw

    sim.setAiming(false);
    sim.pressRecall();
    run(sim, 2.5);

    expect(events.some((e) => e.type === 'recallHit')).toBe(true);
    expect(sim.getDummies()[0].hp).toBe(60 - 12);
  });
});

describe('melee string', () => {
  it('chains three strikes with buffered input, third hits hardest', () => {
    const sim = new VerbSim({ dummies: [{ pos: [0, 9.5] }], heroPos: [0, 8] });
    const events = collect(sim);

    // Mash roughly like a human: press, then re-press mid-swing.
    sim.pressAttack();
    run(sim, 0.15);
    sim.pressAttack();
    run(sim, 0.15);
    sim.pressAttack();
    run(sim, 0.15);
    sim.pressAttack();
    run(sim, 1.0);

    const hits = events.filter((e) => e.type === 'meleeHit');
    expect(hits.length).toBeGreaterThanOrEqual(3);
    const stages = hits.map((h) => h.type === 'meleeHit' && h.stage);
    expect(stages).toContain(1);
    expect(stages).toContain(2);
    expect(stages).toContain(3);
    const third = hits.find((h) => h.type === 'meleeHit' && h.stage === 3)!;
    expect(third.type === 'meleeHit' && third.damage).toBe(14);
  });

  it('whiffs against empty air', () => {
    const sim = new VerbSim({ dummies: [], heroPos: [0, 8] });
    const events = collect(sim);
    sim.pressAttack();
    run(sim, 0.5);
    expect(events.some((e) => e.type === 'meleeWhiff')).toBe(true);
    expect(events.some((e) => e.type === 'meleeHit')).toBe(false);
  });

  it('catch follow-up window buffs the next strike', () => {
    const sim = new VerbSim({ dummies: [{ pos: [0, 6.5] }], heroPos: [0, 8] });
    const events = collect(sim);

    sim.setCameraYaw(0);
    sim.setAiming(true);
    sim.pressAttack(); // throw (embeds in the dummy ahead)
    run(sim, 1.0);
    sim.setAiming(false);
    sim.pressRecall();

    // Step until the catch, then attack inside the follow-up window.
    let caught = false;
    const unsub = sim.onEvent((e) => { if (e.type === 'catch') caught = true; });
    for (let i = 0; i < 300 && !caught; i++) sim.step(DT);
    unsub();
    expect(caught).toBe(true);

    sim.pressAttack();
    run(sim, 0.3);

    const buffedHit = events.find((e) => e.type === 'meleeHit' && e.buffed);
    expect(buffedHit).toBeDefined();
    expect(buffedHit!.type === 'meleeHit' && buffedHit!.damage).toBe(12); // 8 × 1.5
  });
});

describe('solid bodies', () => {
  it('hero cannot ghost through a dummy', () => {
    const sim = new VerbSim({ dummies: [{ pos: [0, 4] }], heroPos: [0, 8] });
    sim.setCameraYaw(0); // forward = -z, straight at the dummy
    sim.setMove(0, 1);
    run(sim, 3.0); // way more than enough time to walk 4m

    const d = sim.getDummies()[0];
    const flatDist = Math.hypot(sim.heroPos.x - d.pos.x, sim.heroPos.z - d.pos.z);
    expect(flatDist).toBeGreaterThanOrEqual(0.84); // HERO_RADIUS + DUMMY_RADIUS − ε
  });
});

describe('round structure', () => {
  it('dead dummies stay down when respawn is off; resetRound revives them', () => {
    const sim = new VerbSim({ dummies: [{ pos: [0, 4] }, { pos: [2, 4] }], heroPos: [0, 8] });
    sim.respawnEnabled = false;

    sim.debugKillAll();
    expect(sim.allDown).toBe(true);
    run(sim, 5.0); // way past the respawn timer
    expect(sim.allDown).toBe(true);

    sim.resetRound();
    expect(sim.allDown).toBe(false);
    expect(sim.getDummies().every((d) => d.hp === d.maxHp)).toBe(true);
  });

  it('resetRound returns a loose edge to the hand', () => {
    const sim = new VerbSim({ dummies: [], heroPos: [0, 8] });
    sim.setCameraYaw(0);
    sim.pressThrow();
    run(sim, 2.0);
    expect(sim.edgeState).toBe('embedded');

    sim.resetRound();
    expect(sim.edgeState).toBe('held');
    expect(sim.edge.pos.distanceTo(sim.handPos())).toBeLessThan(0.01);
  });
});

describe('dummies', () => {
  it('die, fall, and respawn', () => {
    const sim = new VerbSim({ dummies: [{ pos: [0, 9.5] }], heroPos: [0, 8] });
    const events = collect(sim);

    // 60 HP: keep swinging until the death event.
    for (let i = 0; i < 30 && !events.some((e) => e.type === 'dummyDeath'); i++) {
      sim.pressAttack();
      run(sim, 0.3);
    }
    expect(events.some((e) => e.type === 'dummyDeath')).toBe(true);
    expect(sim.getDummies()[0].dead).toBe(true);

    run(sim, 3.0);
    expect(sim.getDummies()[0].dead).toBe(false);
    expect(sim.getDummies()[0].hp).toBe(60);
  });
});
