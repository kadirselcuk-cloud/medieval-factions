import { beforeEach, describe, expect, it } from 'vitest';
import { loadFactions } from '../data/factions';
import { loadEurope1350 } from '../data/maps';
import { growthBreakdown, incomeBreakdown, monthsToAfford, monthsToNextTier, project } from './balance';
import { TICKS_PER_MONTH } from './calendar';
import { queueImprovement } from './construction';
import { createInitialState, recomputeIncome, taxedGold } from './state';
import { advanceBy, cityGrowth } from './tick';
import { MILLI, type SimState } from './types';

const world = loadEurope1350();
const roster = loadFactions();
const FRANKS = roster.findIndex((f) => f.id === 'franks');

let state: SimState;

beforeEach(() => {
  state = createInitialState(world, roster, 'franks', 31);
});

/**
 * The breakdown restates the income calculation in separable parts, which means there are now
 * two implementations of it. These are the tests that stop them drifting.
 */
describe('income breakdown', () => {
  it('sums to exactly what the simulation pays, for every faction', () => {
    for (const faction of state.factions) {
      const breakdown = incomeBreakdown(state, world, faction.index);
      expect(breakdown.net, roster[faction.index]?.name).toBe(faction.monthlyIncome.gold);
      expect(breakdown.wood).toBe(faction.monthlyIncome.wood);
      expect(breakdown.iron).toBe(faction.monthlyIncome.iron);
      expect(breakdown.stone).toBe(faction.monthlyIncome.stone);
    }
  });

  it('still agrees once buildings, improvements and armies are in play', () => {
    const paris = state.cities.find((c) => c.ownerIndex === FRANKS)!;
    const faction = state.factions[FRANKS]!;
    faction.stock.gold = 100_000 * MILLI;
    paris.buildings.push('wooden_houses', 'cottage_shops');
    paris.garrison['light_infantry'] = 3;

    const location = world.cities[paris.cityIndex]!;
    queueImprovement(state, world, FRANKS, location.x, location.y + 1, 'farm');
    advanceBy(state, world, TICKS_PER_MONTH * 12);
    recomputeIncome(state, world);

    const breakdown = incomeBreakdown(state, world, FRANKS);
    expect(breakdown.net).toBe(faction.monthlyIncome.gold);
    expect(breakdown.commerce).toBe(taxedGold(10)); // Cottage Shops, after tax
    expect(breakdown.improvements).toBeGreaterThan(0);
    expect(breakdown.upkeep).toBeLessThan(0);
  });

  it('separates bare land from what has been built on it', () => {
    const before = incomeBreakdown(state, world, FRANKS);
    expect(before.improvements).toBe(0);
    expect(before.land).toBeGreaterThan(0);
  });
});

describe('growth breakdown', () => {
  it('sums to the figure the simulation actually uses', () => {
    const paris = state.cities.find((c) => c.ownerIndex === FRANKS)!;
    state.factions[FRANKS]!.stock.gold = 100_000 * MILLI;
    paris.buildings.push('wooden_houses', 'town_hall');
    paris.tier = 2;

    const growth = growthBreakdown(state, paris);
    expect(growth.base + growth.treasury + growth.tier + growth.buildings).toBe(growth.total);
    expect(growth.total).toBe(cityGrowth(state, paris));
    // 2 base + 6 for a Town + 10 houses + 8 hall + 10 for a hundred thousand banked.
    expect(growth.total).toBe(36);
  });

  it('replaces every term with a loss while the settlement is besieged', () => {
    const paris = state.cities.find((c) => c.ownerIndex === FRANKS)!;
    paris.buildings.push('wooden_houses');
    paris.siege = { byIndex: 0, monthsRemaining: 1, monthsHeld: 0 };

    const growth = growthBreakdown(state, paris);
    expect(growth.besieged).toBe(true);
    expect(growth.total).toBeLessThan(0);
    expect(growth.total).toBe(cityGrowth(state, paris));
  });
});

describe('forecasts', () => {
  it('counts the months to the next population gate', () => {
    const paris = state.cities.find((c) => c.ownerIndex === FRANKS)!;
    expect(monthsToNextTier(state, paris)).toBeGreaterThan(0);

    paris.population = 2_000; // already past the Town gate
    expect(monthsToNextTier(state, paris)).toBe(0);
  });

  it('reports never when income cannot cover the cost', () => {
    const faction = state.factions[FRANKS]!;
    faction.monthlyIncome.gold = 0;
    faction.stock.gold = 0;
    expect(monthsToAfford(state, FRANKS, 1_000)).toBeNull();
    expect(monthsToAfford(state, FRANKS, 0)).toBe(0);
  });
});

describe('projection', () => {
  // The whole point of projecting on a copy: the campaign being inspected must not move.
  it('never touches the live campaign', () => {
    const before = JSON.stringify({
      tick: state.tick,
      rng: state.rng,
      gold: state.factions[FRANKS]!.stock.gold,
      people: state.cities.map((c) => c.population),
    });

    // Three years, not ten: since 0.12.0 the rivals play, and a realm that does absolutely
    // nothing for a decade is liable to be conquered inside the projection — which is correct,
    // and the projection reporting it is the point, but it leaves nothing here to assert on.
    const result = project(state, world, FRANKS, 3);

    expect(JSON.stringify({
      tick: state.tick,
      rng: state.rng,
      gold: state.factions[FRANKS]!.stock.gold,
      people: state.cities.map((c) => c.population),
    })).toBe(before);

    expect(result.years).toBe(3);
    expect(result.cities).toBe(1);
    expect(result.population).toBeGreaterThan(1_000);
  });

  it('agrees with advancing the campaign for real', () => {
    const projected = project(state, world, FRANKS, 5);
    advanceBy(state, world, TICKS_PER_MONTH * 12 * 5);

    const paris = state.cities.find((c) => c.ownerIndex === FRANKS)!;
    expect(projected.population).toBe(paris.population);
  });
});
