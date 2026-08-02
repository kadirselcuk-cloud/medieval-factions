import { summariseBuildings } from '../data/buildings';
import type { World } from '../data/world';
import { isMonthBoundary, TICKS_PER_MONTH } from './calendar';
import { advanceConstruction } from './construction';
import { recomputeIncome } from './state';
import { MILLI, RESOURCES, type SimState } from './types';

/**
 * Advance the simulation by exactly one tick.
 *
 * The only entry point into the simulation. Pure with respect to the outside world: given the
 * same state it always produces the same next state, at any speed and any frame rate.
 */
export function advance(state: SimState, world: World): void {
  state.tick += 1;

  accrueIncome(state);

  if (isMonthBoundary(state.tick)) {
    advanceConstruction(state);
    growPopulation(state);
    recomputeIncome(state, world);
  }
}

export function advanceBy(state: SimState, world: World, ticks: number): void {
  for (let i = 0; i < ticks; i++) advance(state, world);
}

/**
 * Spread a month's income across its 120 ticks without losing the remainder.
 *
 * Each tick adds a full month's worth to a carry, then extracts one-hundred-and-twentieth of
 * it. Over a whole month the faction receives exactly its monthly income — no more from
 * rounding up, no less from truncation, and identical whether the month was watched at 1x or
 * skipped through at 10x.
 */
function accrueIncome(state: SimState): void {
  for (const faction of state.factions) {
    for (const resource of RESOURCES) {
      const monthly = faction.monthlyIncome[resource];
      if (monthly === 0) continue;
      const carry = faction.carry[resource] + monthly * MILLI;
      const gained = Math.floor(carry / TICKS_PER_MONTH);
      faction.carry[resource] = carry - gained * TICKS_PER_MONTH;
      faction.stock[resource] += gained;
    }
  }
}

/**
 * Treasury contribution to population growth, in tenths of a percent (docs/MECHANICS.md §5).
 *
 * Diminishing by design: the owner's anchors are +1% at 10k, +2% at 100k and +3% at 1M, so
 * each decade of wealth is worth the same again rather than compounding away. Capped at +3%.
 */
export function wealthGrowthTenths(goldWhole: number): number {
  if (goldWhole < 1_000) return 0;
  if (goldWhole < 10_000) return Math.floor(goldWhole / 1_000);
  if (goldWhole < 100_000) return 10 + Math.floor((goldWhole - 10_000) / 10_000);
  if (goldWhole < 1_000_000) return 20 + Math.floor((goldWhole - 100_000) / 100_000);
  return 30;
}

/**
 * Monthly population growth (docs/MECHANICS.md §5).
 *
 * Rate is accumulated in tenths of a percent so the whole calculation stays in integers:
 * base 1, plus the treasury bonus, plus city level, plus housing level.
 *
 * Housing level equals the settlement tier: a Town *is* Stone Houses. That keeps the owner's
 * two-term formula meaningful without inventing a fourth housing building for Capitols. [GEN]
 */
function growPopulation(state: SimState): void {
  for (const city of state.cities) {
    const owner = state.factions[city.ownerIndex];
    if (!owner) continue;

    const buildings = summariseBuildings(city.buildings);
    const rateTenthsOfPercent =
      1 +
      wealthGrowthTenths(Math.floor(owner.stock.gold / MILLI)) +
      city.tier +
      buildings.housingLevel +
      buildings.growthTenths;

    city.populationMilli += Math.floor((city.populationMilli * rateTenthsOfPercent) / 1000);
  }
}
