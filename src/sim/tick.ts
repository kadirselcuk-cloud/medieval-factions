import { summariseBuildings } from '../data/buildings';
import { unitById } from '../data/units';
import type { World } from '../data/world';
import { removeArmy } from './armies';
import { isMonthBoundary, TICKS_PER_MONTH } from './calendar';
import { advanceConstruction } from './construction';
import { advanceSieges } from './conquest';
import { pushEvent } from './events';
import { advanceArmies } from './movement';
import { recomputeIncome } from './state';
import {
  MILLI,
  nextRandom,
  RESOURCES,
  type CityState,
  type SimState,
} from './types';

/** A settlement never falls below this, however deep the debt. **[GEN]** */
export const MIN_POPULATION = 100;

/**
 * Advance the simulation by exactly one tick.
 *
 * The only entry point into the simulation. Pure with respect to the outside world: given the
 * same state it always produces the same next state, at any speed and any frame rate.
 */
export function advance(state: SimState, world: World): void {
  state.tick += 1;

  accrueIncome(state);
  advanceArmies(state, world);

  if (isMonthBoundary(state.tick)) {
    advanceConstruction(state, world);
    desertUnpaidTroops(state, world);
    growPopulation(state);
    // Last of the month, because a siege that ends this month resolves into a battle, and a
    // battle can take the settlement — after which nothing else about it is worth computing.
    advanceSieges(state, world);
    recomputeIncome(state, world);
  }
}

/**
 * What a month under siege costs a settlement — owner-specified.
 *
 * It pays its owner nothing, finishes nothing, and starves: growth is replaced outright by a
 * loss, so time is the besieger's weapon and not merely an inconvenience. The **1% a month** is
 * **[GEN]** — the owner chose starvation but not its rate. Over the year a Capitol can hold out
 * that is about a ninth of its people.
 */
export const SIEGE_STARVATION_TENTHS = -10;

/** Chance each unit deserts in a month its faction cannot pay for it. */
export const DESERTION_CHANCE = 0.1;

/**
 * Troops a faction cannot pay start walking home.
 *
 * Iteration order is fixed — cities by index then armies by id, unit ids sorted within each —
 * because the RNG is drawn per unit and the whole simulation has to stay reproducible from a
 * save. A settlement's own defenders are exempt: they cost nothing, so there is no wage to
 * miss, and a bankrupt realm should not have its walls quietly opened.
 */
function desertUnpaidTroops(state: SimState, world: World): void {
  for (const faction of state.factions) {
    if (faction.stock.gold >= 0) continue;

    for (const city of state.cities) {
      if (city.ownerIndex !== faction.index) continue;
      const where = world.cities[city.cityIndex]?.name ?? 'a settlement';
      desertFrom(state, city.garrison, faction.index, city.tileIndex, where);
    }

    for (const army of [...state.armies].sort((a, b) => a.id - b.id)) {
      if (army.ownerIndex !== faction.index) continue;
      desertFrom(state, army.units, faction.index, army.tileIndex, 'the field');
      // An army that has lost every last man is not an army.
      if (Object.keys(army.units).length === 0) removeArmy(state, army.id);
    }
  }
}

/** Roll desertion over one stack of units, in a fixed order. Returns nothing — it mutates. */
function desertFrom(
  state: SimState,
  stack: Record<string, number>,
  factionIndex: number,
  tileIndex: number,
  where: string,
): void {
  for (const id of Object.keys(stack).sort()) {
    const count = stack[id] ?? 0;
    let lost = 0;
    for (let i = 0; i < count; i++) {
      if (nextRandom(state) < DESERTION_CHANCE) lost += 1;
    }
    if (lost === 0) continue;

    const left = count - lost;
    if (left > 0) stack[id] = left;
    else delete stack[id];

    pushEvent(state, {
      kind: 'desertion',
      text: `${lost} × ${unitById(id)?.name ?? id} deserted at ${where} — the treasury is empty`,
      tileIndex,
      factionIndex,
    });
  }
}

/**
 * A settlement's monthly growth rate, in tenths of a percent.
 *
 * Exported so the city panel can show the same number the simulation uses, rather than a
 * second implementation that drifts from it.
 */
export function cityGrowthTenths(state: SimState, city: CityState): number {
  const owner = state.factions[city.ownerIndex];
  if (!owner) return 0;
  // A settlement under siege does not grow at all — it starves, whatever it has built.
  if (city.siege) return SIEGE_STARVATION_TENTHS;
  const buildings = summariseBuildings(city.buildings);
  // Housing and the hall line both contribute through `growthTenths`, which sums the standing
  // buildings rather than reading a level — the two lines give diminishing amounts per step,
  // so what matters is which buildings are up, not how high the chain has climbed.
  return (
    1 +
    wealthGrowthTenths(Math.floor(owner.stock.gold / MILLI)) +
    city.tier +
    buildings.growthTenths
  );
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
      // Gold may go negative — a realm can run into debt, and pays for it in population and
      // desertion rather than in a hard stop.
      faction.stock[resource] += gained;
    }
  }
}

/**
 * Treasury contribution to population growth, in tenths of a percent (docs/MECHANICS.md §5).
 *
 * Diminishing by design: the owner's anchors are +1% at 10k, +2% at 100k and +3% at 1M, so
 * each decade of wealth is worth the same again rather than compounding away. Capped at ±3%.
 *
 * **Symmetric.** Debt hurts exactly as much as wealth helps — a realm 10,000 gold in the red
 * bleeds 1% of its people a month, and one a million in the red bleeds 3%.
 */
export function wealthGrowthTenths(goldWhole: number): number {
  const sign = goldWhole < 0 ? -1 : 1;
  const size = Math.abs(goldWhole);

  if (size < 1_000) return 0;
  if (size < 10_000) return sign * Math.floor(size / 1_000);
  if (size < 100_000) return sign * (10 + Math.floor((size - 10_000) / 10_000));
  if (size < 1_000_000) return sign * (20 + Math.floor((size - 100_000) / 100_000));
  return sign * 30;
}

/**
 * Monthly population growth (docs/MECHANICS.md §5).
 *
 * Rate is accumulated in tenths of a percent so the whole calculation stays in integers:
 * base 1, plus the treasury bonus, plus city level, plus what the housing and hall lines add.
 *
 * Those two lines give **diminishing returns** — +1.0%, +0.5%, +0.2% for each successive
 * building — so the first house a settlement puts up is worth more than every later one
 * combined. That is the whole shape of an opening: build housing early or grow at a crawl.
 */
function growPopulation(state: SimState): void {
  for (const city of state.cities) {
    const change = Math.floor((city.populationMilli * cityGrowthTenths(state, city)) / 1000);
    // Debt can drive growth negative, but a settlement never empties out entirely — it
    // shrinks back to a hamlet and stops there. [GEN]
    city.populationMilli = Math.max(MIN_POPULATION * MILLI, city.populationMilli + change);
  }
}
