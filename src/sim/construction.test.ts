import { beforeEach, describe, expect, it } from 'vitest';
import { loadFactions } from '../data/factions';
import { loadEurope1350 } from '../data/maps';
import { TICKS_PER_MONTH } from './calendar';
import {
  buildOptions,
  cancelOrder,
  improvementAt,
  improvementCap,
  queueBuilding,
  queueImprovement,
  queueSettlementUpgrade,
} from './construction';
import { deserialise, serialise } from './save';
import { createInitialState } from './state';
import { advanceBy } from './tick';
import { MILLI, whole, type CityState, type SimState } from './types';

const world = loadEurope1350();
const roster = loadFactions();
const FRANKS = roster.findIndex((f) => f.id === 'franks');

let state: SimState;
let paris: CityState;

beforeEach(() => {
  state = createInitialState(world, roster, 'franks', 7);
  paris = state.cities.find((c) => c.ownerIndex === FRANKS)!;
});

/** Give the player enough of everything to test rules rather than affordability. */
function enrich(target = 100_000): void {
  const faction = state.factions[FRANKS]!;
  for (const resource of ['gold', 'wood', 'iron', 'stone'] as const) {
    faction.stock[resource] = target * MILLI;
  }
}

describe('opening position', () => {
  it('starts with nothing built', () => {
    expect(paris.buildings).toEqual([]);
    expect(paris.queue).toEqual([]);
    expect(paris.tier).toBe(1);
  });

  it('offers only Village-tier buildings, one per chain', () => {
    const options = buildOptions(world, paris).map((b) => b.id);
    expect(options).toContain('wooden_houses');
    expect(options).toContain('wooden_palisade');
    expect(options).toContain('cottage_shops');
    // Higher tiers and later chain levels stay hidden.
    expect(options).not.toContain('stone_houses');
    expect(options).not.toContain('barracks');
  });

  it('can afford exactly one or two openers with 250 gold', () => {
    const affordable = buildOptions(world, paris).filter((b) => b.cost.gold <= 250);
    expect(affordable.length).toBeGreaterThan(0);
    expect(buildOptions(world, paris).every((b) => b.cost.wood === 0)).toBe(true);
  });
});

describe('building construction', () => {
  it('pays up front and completes after its stated months', () => {
    const faction = state.factions[FRANKS]!;
    const before = whole(faction.stock.gold);

    expect(queueBuilding(state, world, paris, 'wooden_houses')).toEqual({ ok: true });
    expect(whole(faction.stock.gold)).toBe(before - 120);

    advanceBy(state, world, TICKS_PER_MONTH * 11);
    expect(paris.buildings).toEqual([]);
    expect(paris.queue[0]?.monthsRemaining).toBe(1);

    advanceBy(state, world, TICKS_PER_MONTH);
    expect(paris.buildings).toEqual(['wooden_houses']);
    expect(paris.queue).toEqual([]);
  });

  it('refuses what the treasury cannot cover', () => {
    expect(queueBuilding(state, world, paris, 'cottage_shops')).toEqual({ ok: true });
    // 250 - 150 = 100 gold left; Wooden Houses costs 120.
    expect(queueBuilding(state, world, paris, 'wooden_houses')).toEqual({
      ok: false,
      reason: 'insufficient-resources',
    });
  });

  it('refunds in full when an order is cancelled', () => {
    const faction = state.factions[FRANKS]!;
    queueBuilding(state, world, paris, 'wooden_houses');
    advanceBy(state, world, TICKS_PER_MONTH * 3);

    // Income accrues while the work is under way, so assert the refund itself, not the total.
    const beforeCancel = faction.stock.gold;
    cancelOrder(state, paris, 0);
    expect(faction.stock.gold - beforeCancel).toBe(120 * MILLI);
    expect(paris.queue).toEqual([]);
  });

  it('only progresses the head of the queue', () => {
    enrich();
    queueBuilding(state, world, paris, 'wooden_houses');
    queueBuilding(state, world, paris, 'cottage_shops');
    advanceBy(state, world, TICKS_PER_MONTH);
    expect(paris.queue[0]?.monthsRemaining).toBe(11);
    expect(paris.queue[1]?.monthsRemaining).toBe(12);
  });

  it('raises the settlement tier when an upgrade finishes', () => {
    enrich();
    expect(queueSettlementUpgrade(state, paris)).toEqual({ ok: true });
    advanceBy(state, world, TICKS_PER_MONTH * 24);
    expect(paris.tier).toBe(2);
    expect(buildOptions(world, paris).map((b) => b.id)).toContain('barracks');
  });
});

describe('tile improvements', () => {
  it('is capped by the realm\'s best settlement', () => {
    expect(improvementCap(state, FRANKS)).toBe(1);
    paris.tier = 3;
    expect(improvementCap(state, FRANKS)).toBe(3);
  });

  it('builds on an owned tile and yields once complete', () => {
    enrich();
    const location = world.cities[paris.cityIndex]!;
    const x = location.x;
    const y = location.y + 1; // a claimed orthogonal neighbour

    expect(queueImprovement(state, world, FRANKS, x, y, 'farm')).toEqual({ ok: true });
    const index = y * world.width + x;
    expect(improvementAt(state, index)).toBe('farm');
    expect(state.improvementLevel[index]).toBe(0);

    advanceBy(state, world, TICKS_PER_MONTH * 12);
    expect(state.improvementLevel[index]).toBe(1);
    expect(state.improvementMonths[index]).toBe(0);
  });

  it('refuses a tile the faction does not own', () => {
    enrich();
    expect(queueImprovement(state, world, FRANKS, 0, 0, 'farm')).toEqual({
      ok: false,
      reason: 'not-owner',
    });
  });

  it('refuses a second improvement kind on the same tile', () => {
    enrich();
    const location = world.cities[paris.cityIndex]!;
    queueImprovement(state, world, FRANKS, location.x, location.y, 'farm');
    advanceBy(state, world, TICKS_PER_MONTH * 12);
    expect(queueImprovement(state, world, FRANKS, location.x, location.y, 'mine')).toEqual({
      ok: false,
      reason: 'wrong-improvement',
    });
  });

  it('refuses to exceed the settlement cap', () => {
    enrich();
    const location = world.cities[paris.cityIndex]!;
    queueImprovement(state, world, FRANKS, location.x, location.y, 'farm');
    advanceBy(state, world, TICKS_PER_MONTH * 12);
    // Still a Village, so level 2 is out of reach.
    expect(queueImprovement(state, world, FRANKS, location.x, location.y, 'farm')).toEqual({
      ok: false,
      reason: 'max-level',
    });
  });
});

describe('saves', () => {
  it('round-trips exactly', () => {
    enrich();
    queueBuilding(state, world, paris, 'wooden_houses');
    const location = world.cities[paris.cityIndex]!;
    queueImprovement(state, world, FRANKS, location.x, location.y, 'mine');
    advanceBy(state, world, TICKS_PER_MONTH * 30 + 17);

    const restored = deserialise(serialise(state));

    expect(restored.tick).toBe(state.tick);
    expect(restored.rng).toBe(state.rng);
    expect(restored.cities).toEqual(state.cities);
    expect(restored.factions).toEqual(state.factions);
    expect([...restored.tileOwner]).toEqual([...state.tileOwner]);
    expect([...restored.improvementLevel]).toEqual([...state.improvementLevel]);
  });

  it('continues identically after a reload', () => {
    enrich();
    const restored = deserialise(serialise(state));
    advanceBy(state, world, 500);
    advanceBy(restored, world, 500);

    expect(restored.cities).toEqual(state.cities);
    expect(restored.factions).toEqual(state.factions);
  });
});
