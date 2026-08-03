import { beforeEach, describe, expect, it } from 'vitest';
import { settlementUpgradeTo } from '../data/buildings';
import { loadFactions } from '../data/factions';
import { loadEurope1350 } from '../data/maps';
import { buildableShips, recruitableUnits } from '../data/units';
import { adjacentWaterCount } from '../data/world';
import { TICKS_PER_MONTH } from './calendar';
import {
  buildOptions,
  cancelOrder,
  cancelProduction,
  improvementAt,
  improvementCap,
  queueBuilding,
  queueImprovement,
  queueSettlementUpgrade,
  queueShip,
  queueUnit,
  settlementUpgradeBlock,
  totalUpkeep,
} from './construction';
import { deserialise, serialise } from './save';
import { createInitialState, recomputeIncome } from './state';
import { advanceBy, cityGrowth } from './tick';
import { MILLI, MIN_POPULATION, whole, type CityState, type SimState } from './types';

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
    paris.population = 2_000; // a Town needs 2,000 people
    expect(queueSettlementUpgrade(state, paris)).toEqual({ ok: true });
    advanceBy(state, world, TICKS_PER_MONTH * 24);
    expect(paris.tier).toBe(2);
    expect(buildOptions(world, paris).map((b) => b.id)).toContain('barracks');
  });
});

describe('expanding a settlement', () => {
  it('refuses until the settlement holds enough people', () => {
    enrich();
    expect(settlementUpgradeBlock(state, paris)).toBe('too-few-people');
    expect(queueSettlementUpgrade(state, paris)).toEqual({
      ok: false,
      reason: 'too-few-people',
    });

    paris.population = 1_999;
    expect(settlementUpgradeBlock(state, paris)).toBe('too-few-people');

    paris.population = 2_000;
    expect(settlementUpgradeBlock(state, paris)).toBeNull();
  });

  // The population gate is the same idea at every tier, and it rises much faster than a
  // settlement grows — expanding is meant to be the work of decades.
  it('gates each tier on its own population', () => {
    enrich();
    const gate = (tier: 2 | 3 | 4) => settlementUpgradeTo(tier)?.minPopulation;
    expect(gate(2)).toBe(2_000);
    expect(gate(3)).toBe(5_000);
    expect(gate(4)).toBe(10_000);
  });

  it('allows only one Capitol per realm', () => {
    enrich(1_000_000);
    paris.tier = 3;
    paris.population = 10_000;

    // A second City of the same realm, already on its way to Capitol.
    const other = state.cities.find((c) => c !== paris && c.ownerIndex !== FRANKS)!;
    other.ownerIndex = FRANKS;
    other.tier = 4;

    expect(settlementUpgradeBlock(state, paris)).toBe('already-have-one');

    other.tier = 1;
    expect(settlementUpgradeBlock(state, paris)).toBeNull();
  });

  it('counts a Capitol that is merely under construction', () => {
    enrich(1_000_000);
    paris.tier = 3;
    paris.population = 10_000;

    const other = state.cities.find((c) => c !== paris && c.ownerIndex !== FRANKS)!;
    other.ownerIndex = FRANKS;
    other.tier = 3;
    other.queue.push({ kind: 'settlement', targetTier: 4, monthsRemaining: 48 });

    expect(settlementUpgradeBlock(state, paris)).toBe('already-have-one');
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

describe('fishery', () => {
  /** Constantinople sits on the Bosphorus, so it has water on several sides. */
  function coastalCity() {
    const index = world.cities.findIndex((c) => c.name === 'Constantinople');
    const location = world.cities[index]!;
    const city = state.cities.find((c) => c.cityIndex === index)!;
    city.ownerIndex = FRANKS;
    state.tileOwner[location.index] = FRANKS;
    return { city, location };
  }

  it('is offered at Village tier, but only to a coastal settlement', () => {
    const { city } = coastalCity();
    expect(buildOptions(world, city).map((b) => b.id)).toContain('fishery');
    // Paris is inland.
    expect(buildOptions(world, paris).map((b) => b.id)).not.toContain('fishery');
  });

  it('pays per adjacent water tile', () => {
    const { city, location } = coastalCity();
    const water = adjacentWaterCount(world, location.x, location.y);
    expect(water).toBeGreaterThan(0);

    const faction = state.factions[FRANKS]!;
    recomputeIncome(state, world);
    const before = faction.monthlyIncome.gold;

    city.buildings.push('fishery');
    recomputeIncome(state, world);
    expect(faction.monthlyIncome.gold - before).toBe(10 * water);
  });

  it('replaces rather than stacks as the naval line upgrades', () => {
    const { city, location } = coastalCity();
    const water = adjacentWaterCount(world, location.x, location.y);
    const faction = state.factions[FRANKS]!;

    recomputeIncome(state, world);
    const bare = faction.monthlyIncome.gold;

    city.buildings.push('fishery', 'dock');
    recomputeIncome(state, world);
    expect(faction.monthlyIncome.gold - bare).toBe(20 * water);
  });
});

describe('recruitment and shipyards', () => {
  it('offers only what the tier and standing buildings allow', () => {
    expect(recruitableUnits(paris.tier, paris.buildings).map((u) => u.id)).toEqual([
      'light_infantry',
    ]);

    paris.tier = 2;
    paris.buildings.push('stables');
    const town = recruitableUnits(paris.tier, paris.buildings).map((u) => u.id);
    expect(town).toContain('light_cavalry');
    expect(town).toContain('skirmisher');
    // Heavy cavalry needs Barracks as well, and City tier.
    expect(town).not.toContain('heavy_cavalry');
  });

  it('trains a unit into the garrison and announces it', () => {
    enrich();
    expect(queueUnit(state, paris, 'light_infantry')).toEqual({ ok: true });
    advanceBy(state, world, TICKS_PER_MONTH * 4);

    // Two: the unit just trained, plus the one every faction opens the campaign with.
    expect(paris.garrison['light_infantry']).toBe(2);
    expect(paris.recruitQueue).toEqual([]);
    expect(state.events.some((e) => e.kind === 'unit' && e.text.includes('Paris'))).toBe(true);
  });

  it('draws the unit out of the settlement, the month the order is placed', () => {
    enrich();
    const before = paris.population;
    expect(queueUnit(state, paris, 'light_infantry')).toEqual({ ok: true });

    // Levied up front like every other cost — the men leave their fields when the order goes
    // out, not when the unit is ready.
    expect(paris.population).toBe(before - 100);
    advanceBy(state, world, TICKS_PER_MONTH * 4);
    expect(paris.garrison['light_infantry']).toBe(2);
  });

  it('gives the people back if the order is cancelled', () => {
    enrich();
    const before = paris.population;
    queueUnit(state, paris, 'light_infantry');
    cancelProduction(state, paris, 'recruit', 0);

    // Cancelling wastes the months already spent, not the people — the same bargain the
    // treasury gets.
    expect(paris.population).toBe(before);
    expect(paris.recruitQueue).toEqual([]);
  });

  it('refuses to raise more men than the settlement can spare', () => {
    enrich();
    paris.population = MIN_POPULATION + 99;
    expect(queueUnit(state, paris, 'light_infantry')).toEqual({
      ok: false,
      reason: 'too-few-people',
    });

    // One more villager and the hundredth man can be found.
    paris.population = MIN_POPULATION + 100;
    expect(queueUnit(state, paris, 'light_infantry')).toEqual({ ok: true });
    expect(paris.population).toBe(MIN_POPULATION);
  });

  it('never lets recruitment empty a settlement, however rich the realm', () => {
    enrich(10_000_000);
    for (let i = 0; i < 40; i++) queueUnit(state, paris, 'light_infantry');
    expect(paris.population).toBeGreaterThanOrEqual(MIN_POPULATION);
  });

  it('costs a bare village twenty months of growth for one unit', () => {
    // Deliberately not enriched: a Light Infantry is 50 gold and the realm opens with 250, so
    // this is the opening position exactly — a Village with nothing built and 250 in the bank.
    expect(cityGrowth(state, paris)).toBe(5);
    expect(queueUnit(state, paris, 'light_infantry')).toEqual({ ok: true });

    // Flat growth never earns the manpower back, which is the whole weight of the decision.
    expect(Math.ceil(100 / 5)).toBe(20);
    expect(paris.population).toBe(900);
  });

  it('runs building and recruitment queues in parallel', () => {
    enrich();
    queueBuilding(state, world, paris, 'wooden_houses'); // 12 months
    queueUnit(state, paris, 'light_infantry'); // 4 months

    advanceBy(state, world, TICKS_PER_MONTH * 4);
    expect(paris.garrison['light_infantry']).toBe(2); // trained, plus the starting unit
    expect(paris.queue[0]?.monthsRemaining).toBe(8);
  });

  it('only offers ships once the naval line is standing', () => {
    expect(buildableShips(paris.buildings)).toEqual([]);
    expect(buildableShips(['fishery'])).toEqual([]);
    expect(buildableShips(['dock']).map((s) => s.id)).toEqual(['transport', 'light_ship']);
    expect(buildableShips(['shipyard'])).toHaveLength(4);
  });

  it('launches a ship into the fleet', () => {
    enrich();
    paris.buildings.push('dock');
    expect(queueShip(state, paris, 'transport')).toEqual({ ok: true });
    advanceBy(state, world, TICKS_PER_MONTH * 6);
    expect(paris.fleet['transport']).toBe(1);
  });

  it('charges upkeep against monthly income', () => {
    enrich();
    paris.garrison = {}; // clear the starting unit, so the sum below is only what this test adds
    recomputeIncome(state, world);
    const before = state.factions[FRANKS]!.monthlyIncome.gold;
    expect(totalUpkeep(state, FRANKS)).toBe(0);

    paris.garrison['light_infantry'] = 3; // 10 gold each
    recomputeIncome(state, world);
    expect(state.factions[FRANKS]!.monthlyIncome.gold).toBe(before - 30);
    expect(totalUpkeep(state, FRANKS)).toBe(30);
  });

  it('lets a treasury fall into debt', () => {
    const faction = state.factions[FRANKS]!;
    faction.stock.gold = 0;
    paris.garrison['heavy_cavalry'] = 20; // 1,000 gold a month against a bare treasury
    recomputeIncome(state, world);
    advanceBy(state, world, TICKS_PER_MONTH);
    expect(faction.stock.gold).toBeLessThan(0);
  });

  it('deserts unpaid troops and says so', () => {
    const faction = state.factions[FRANKS]!;
    faction.stock.gold = -50_000 * MILLI;
    paris.garrison['light_infantry'] = 40;
    recomputeIncome(state, world);

    advanceBy(state, world, TICKS_PER_MONTH * 3);

    expect(paris.garrison['light_infantry'] ?? 0).toBeLessThan(40);
    expect(state.events.some((e) => e.kind === 'desertion')).toBe(true);
  });

  it('keeps troops while the treasury holds', () => {
    enrich();
    paris.garrison['light_infantry'] = 40;
    recomputeIncome(state, world);
    advanceBy(state, world, TICKS_PER_MONTH * 6);
    expect(paris.garrison['light_infantry']).toBe(40);
  });

  it('shrinks a settlement that is deep in debt, but never below the floor', () => {
    // The rivals are stood down for this one. Thirty-three years is long enough for one of them
    // to march on a realm that is bankrupt, undefended and doing nothing, and a Paris that has
    // changed hands is no longer testing what debt does to a population.
    for (const rival of state.factions) rival.ai = null;

    const faction = state.factions[FRANKS]!;
    faction.stock.gold = -2_000_000 * MILLI;
    const before = paris.population;

    // Debt at the deepest band costs 15 people a month against the 5 a bare Village gains.
    advanceBy(state, world, TICKS_PER_MONTH);
    expect(paris.population).toBeLessThan(before);

    advanceBy(state, world, TICKS_PER_MONTH * 400);
    expect(paris.population).toBe(MIN_POPULATION);
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
