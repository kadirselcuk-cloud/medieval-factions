import { summariseBuildings, settlementUpgradeTo } from '../data/buildings';
import { tileOutput } from '../data/improvements';
import { shipById } from '../data/units';
import { adjacentWaterCount, featureAt, terrainAt, type World } from '../data/world';
import { defenceOf, stackUpkeep } from './armies';
import { TICKS_PER_MONTH } from './calendar';
import { improvementAt } from './construction';
import { deserialise, serialise } from './save';
import { taxedGold } from './state';
import { advanceBy, BASE_GROWTH, cityGrowth, GROWTH_PER_TIER, wealthGrowth } from './tick';
import { whole, type CityState, type SimState } from './types';

/**
 * Numbers for balancing, split into the terms that produce them.
 *
 * The simulation itself only ever needs totals, so this is the one place that says *where* a
 * total came from. It is a read-only view over the same state and never mutates anything —
 * the projections work on a serialised copy, which is exact by construction because the save
 * round trip already has to be.
 *
 * Everything here is derived. If a rule changes, these numbers change with it, and the test
 * that asserts the breakdown sums to the simulation's own total is what keeps that honest.
 */

export interface IncomeBreakdown {
  /** 1 gold per 100 people, across every settlement held. */
  population: number;
  /** Commerce line. */
  commerce: number;
  /** Naval line, per adjacent water tile. */
  fishing: number;
  /** Base terrain yield of every held tile, before improvements. */
  land: number;
  /** Farms, mines, sawmills and resource nodes. */
  improvements: number;
  /** Units and ships on the payroll. Negative. */
  upkeep: number;
  /** Sums to the faction's `monthlyIncome.gold`. */
  net: number;
  wood: number;
  iron: number;
  stone: number;
}

export function incomeBreakdown(
  state: SimState,
  world: World,
  factionIndex: number,
): IncomeBreakdown {
  const result: IncomeBreakdown = {
    population: 0,
    commerce: 0,
    fishing: 0,
    land: 0,
    improvements: 0,
    upkeep: 0,
    net: 0,
    wood: 0,
    iron: 0,
    stone: 0,
  };

  for (const city of state.cities) {
    if (city.ownerIndex !== factionIndex) continue;
    const buildings = summariseBuildings(city.buildings);
    const location = world.cities[city.cityIndex];

    result.population += Math.floor(city.population / 100);
    result.commerce += buildings.goldPerMonth;
    if (buildings.goldPerWaterTile > 0 && location) {
      result.fishing += buildings.goldPerWaterTile * adjacentWaterCount(world, location.x, location.y);
    }
    result.upkeep -= stackUpkeep(city.garrison);
    for (const [id, count] of Object.entries(city.fleet)) {
      result.upkeep -= (shipById(id)?.upkeep ?? 0) * count;
    }
  }

  for (const army of state.armies) {
    if (army.ownerIndex !== factionIndex) continue;
    result.upkeep -= stackUpkeep(army.units);
  }

  for (let index = 0; index < state.tileOwner.length; index++) {
    if ((state.tileOwner[index] ?? -1) !== factionIndex) continue;
    const x = index % world.width;
    const y = Math.floor(index / world.width);
    const terrain = terrainAt(world, x, y);
    const feature = featureAt(world, x, y);
    const node = feature?.kind === 'resource' ? feature.resource : null;

    // Bare ground versus what has been built on it, so the two are separable.
    const bare = tileOutput({ terrain, improvement: null, level: 0, node: null });
    const full = tileOutput({
      terrain,
      improvement: improvementAt(state, index),
      level: state.improvementLevel[index] ?? 0,
      node,
    });

    result.land += bare.gold;
    result.improvements += full.gold - bare.gold;
    result.wood += full.wood;
    result.iron += full.iron;
    result.stone += full.stone;
  }

  // **Every gold term above is gross — what the land produces — and only half of it is
  // collected.** Taxing each term rather than the sum keeps the panel's arithmetic addable: a
  // reader who sums the rows must get the net, and flooring once at the end would leave the
  // columns off by a coin or two against the simulation. Upkeep is a wage, not a yield, so it is
  // paid in full out of what the tax leaves.
  result.population = taxedGold(result.population);
  result.commerce = taxedGold(result.commerce);
  result.fishing = taxedGold(result.fishing);
  result.land = taxedGold(result.land);
  result.improvements = taxedGold(result.improvements);

  result.net =
    result.population + result.commerce + result.fishing + result.land + result.improvements + result.upkeep;
  return result;
}

// ------------------------------------------------------------------- growth

export interface GrowthBreakdown {
  /** All in tenths of a percent per month. */
  base: number;
  treasury: number;
  tier: number;
  buildings: number;
  /** People added next month — the sum of the terms above. */
  total: number;
  /** Set while the settlement is invested, when nothing above it applies. */
  besieged: boolean;
}

/**
 * The growth figure, split into the terms that produce it.
 *
 * Every term is **whole people per month**, so they simply add up — which is the point of
 * having moved off percentages. A siege replaces the lot with a loss.
 */
export function growthBreakdown(state: SimState, city: CityState): GrowthBreakdown {
  const owner = state.factions[city.ownerIndex];
  const treasury = owner ? wealthGrowth(whole(owner.stock.gold)) : 0;
  const buildings = summariseBuildings(city.buildings).growthPeople;
  const tier = GROWTH_PER_TIER * city.tier;

  if (city.siege) {
    return { base: 0, treasury: 0, tier: 0, buildings: 0, total: cityGrowth(state, city), besieged: true };
  }
  return {
    base: BASE_GROWTH,
    treasury,
    tier,
    buildings,
    total: BASE_GROWTH + treasury + tier + buildings,
    besieged: false,
  };
}

/**
 * Months until this settlement can expand, at its current growth rate.
 *
 * Flat growth makes this exact division rather than the compounding loop it used to need —
 * although it still assumes the rate holds, and the rate changes the moment anything is built.
 * `null` means it is shrinking, or has nowhere left to grow.
 */
export function monthsToNextTier(state: SimState, city: CityState): number | null {
  const upgrade = settlementUpgradeTo(city.tier + 1);
  if (!upgrade) return null;
  if (city.population >= upgrade.minPopulation) return 0;

  const perMonth = growthBreakdown(state, city).total;
  if (perMonth <= 0) return null;
  return Math.ceil((upgrade.minPopulation - city.population) / perMonth);
}

/** Months to save up for a cost, at the faction's current net income. `null` if never. */
export function monthsToAfford(state: SimState, factionIndex: number, gold: number): number | null {
  const faction = state.factions[factionIndex];
  if (!faction) return null;
  const have = whole(faction.stock.gold);
  if (have >= gold) return 0;

  const perMonth = faction.monthlyIncome.gold;
  if (perMonth <= 0) return null;
  return Math.ceil((gold - have) / perMonth);
}

// --------------------------------------------------------------- projection

export interface Projection {
  years: number;
  gold: number;
  population: number;
  cities: number;
  bestTier: number;
}

/**
 * Run a **copy** of the campaign forward and report where a faction ends up.
 *
 * This is the honest way to answer "what happens if nothing changes", because it is the real
 * simulation rather than a second model of it. The copy comes from the save round trip, so it
 * is exact, and the live state is never touched.
 */
export function project(
  state: SimState,
  world: World,
  factionIndex: number,
  years: number,
): Projection {
  const copy = deserialise(serialise(state));
  advanceBy(copy, world, TICKS_PER_MONTH * 12 * years);

  const owned = copy.cities.filter((city) => city.ownerIndex === factionIndex);
  return {
    years,
    gold: whole(copy.factions[factionIndex]?.stock.gold ?? 0),
    population: owned.reduce((total, city) => total + city.population, 0),
    cities: owned.length,
    bestTier: owned.reduce((best, city) => Math.max(best, city.tier), 0),
  };
}

/** Total free defenders a faction fields across every settlement it holds. */
export function totalDefenders(state: SimState, factionIndex: number): number {
  let count = 0;
  for (const city of state.cities) {
    if (city.ownerIndex !== factionIndex) continue;
    for (const n of Object.values(defenceOf(city))) count += n;
  }
  return count;
}
