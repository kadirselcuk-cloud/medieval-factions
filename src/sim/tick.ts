import { summariseBuildings } from '../data/buildings';
import { unitById } from '../data/units';
import type { World } from '../data/world';
import { runAi } from './ai';
import { removeArmy } from './armies';
import { calendarAt, isMonthBoundary, TICKS_PER_MONTH } from './calendar';
import { advanceConstruction } from './construction';
import { advanceSieges } from './conquest';
import { pushEvent } from './events';
import { advanceArmies } from './movement';
import { recomputeIncome } from './state';
import { rememberGround } from './vision';
import {
  MILLI,
  MIN_POPULATION,
  nextRandom,
  RESOURCES,
  type CityState,
  type SettlementTier,
  type SimState,
} from './types';

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
  // After the armies have moved, so ground an army walked over this tick is remembered before it
  // can walk off it again. Purely a record for the player's map — see vision.ts. Nothing below
  // reads it, so where it sits in the tick cannot change an outcome.
  rememberGround(state, world);

  if (isMonthBoundary(state.tick)) {
    advanceConstruction(state, world);
    desertUnpaidTroops(state, world);
    winterAttrition(state);
    growPopulation(state);
    // Last of the month, because a siege that ends this month resolves into a battle, and a
    // battle can take the settlement — after which nothing else about it is worth computing.
    advanceSieges(state, world);
    // The rivals decide after everything else has settled, so they act on this month's true
    // world rather than on a half-updated one — and their orders play out over the next month.
    runAi(state, world);
    recomputeIncome(state, world);
  }
}

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

/** Chance each unit is lost in a winter month spent standing on a rival's ground. */
export const WINTER_ATTRITION_CHANCE = 0.1;

/**
 * Winter kills armies that stay in enemy country — docs/MECHANICS.md §5.
 *
 * **One roll per unit per winter month, and a lost unit is lost whole.** Not casualties: a
 * formation that spends February in a hostile province with no billets, no stores and nobody
 * willing to sell it grain does not come back at reduced strength, it stops existing. Losing
 * entire units rather than men is owner-specified, and it is the harsher reading on purpose —
 * ten units in enemy territory expect to lose one a month.
 *
 * **Only a rival's ground.** Unclaimed country is unfriendly but empty; it costs a march 20% and
 * nothing else. What kills is a province whose people have every reason to see you starve.
 *
 * This is what makes a winter campaign a decision. An invasion launched in autumn either takes
 * what it came for before the snow or spends the winter dissolving, and with 0.16.0's speeds —
 * foot crossing a hostile tile in three months — that is a real gamble rather than a formality.
 *
 * Iteration is fixed: armies by id, unit ids sorted within each, because the RNG is drawn per
 * unit and the whole simulation has to stay reproducible from a save.
 */
function winterAttrition(state: SimState): void {
  if (calendarAt(state.tick).season !== 'winter') return;

  for (const army of [...state.armies].sort((a, b) => a.id - b.id)) {
    const ground = state.tileOwner[army.tileIndex] ?? -1;
    if (ground < 0 || ground === army.ownerIndex) continue;

    for (const id of Object.keys(army.units).sort()) {
      const count = army.units[id] ?? 0;
      let lost = 0;
      for (let i = 0; i < count; i++) {
        if (nextRandom(state) < WINTER_ATTRITION_CHANCE) lost += 1;
      }
      if (lost === 0) continue;

      const left = count - lost;
      if (left > 0) army.units[id] = left;
      else delete army.units[id];

      pushEvent(state, {
        kind: 'desertion',
        text: `${lost} × ${unitById(id)?.name ?? id} lost to the winter in hostile country`,
        tileIndex: army.tileIndex,
        factionIndex: army.ownerIndex,
      });
    }

    // An army the winter has finished off is not an army.
    if (Object.keys(army.units).length === 0) removeArmy(state, army.id);
  }
}

/**
 * People a settlement gains next month — docs/MECHANICS.md §5.
 *
 * Flat, never a percentage. `pop × (1 + r)` with any `r` above zero is unbounded however hard
 * the rate is tapered, which is what turned a village into half a trillion people over a
 * century. A sum of flat terms cannot run away: population is bounded by time × rate, and
 * "+10 people a month" on a building card is directly comparable to "+10 gold a month" on the
 * card beside it.
 *
 * The exponential in this game is meant to come from **conquest** — each city taken adds its
 * own trickle — not from one settlement compounding.
 *
 * Exported so the city panel can show the same number the simulation uses, rather than a
 * second implementation that drifts from it.
 */
export function cityGrowth(state: SimState, city: CityState): number {
  const owner = state.factions[city.ownerIndex];
  if (!owner) return 0;
  // A settlement under siege does not grow at all — it starves, whatever it has built.
  if (city.siege) return -SIEGE_STARVATION[city.tier];

  return (
    BASE_GROWTH +
    GROWTH_PER_TIER * city.tier +
    summariseBuildings(city.buildings).growthPeople +
    wealthGrowth(Math.floor(owner.stock.gold / MILLI))
  );
}

/** Every settlement gains this much simply for existing. */
export const BASE_GROWTH = 2;

/** And this much again per tier, so a Capitol grows four times as fast as a Village. */
export const GROWTH_PER_TIER = 3;

/**
 * What a month under siege costs a settlement, by tier — owner-specified that it starves, and
 * **[GEN]** by how much.
 *
 * Growth is replaced outright by a loss rather than merely stopped, so time is the besieger's
 * weapon and not an inconvenience. The figures are roughly what a well-built settlement of that
 * size gains, so a siege undoes a generation of building.
 */
export const SIEGE_STARVATION: Record<SettlementTier, number> = {
  1: 10,
  2: 25,
  3: 50,
  4: 100,
};

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
 * Treasury contribution to population growth, in **people per month** (docs/MECHANICS.md §5).
 *
 * Diminishing by design: each decade of wealth is worth the same again rather than compounding
 * away, so a fortune helps a settlement fill without deciding the game on its own. Capped.
 *
 * **Symmetric.** Debt costs exactly what wealth gains — a realm 10,000 gold in the red loses
 * five people a month from every settlement it holds, and one a million in the red loses fifteen.
 */
export function wealthGrowth(goldWhole: number): number {
  const sign = goldWhole < 0 ? -1 : 1;
  const size = Math.abs(goldWhole);

  if (size < 10_000) return 0;
  if (size < 100_000) return sign * 5;
  if (size < 1_000_000) return sign * 10;
  return sign * 15;
}

/**
 * Monthly population growth (docs/MECHANICS.md §5).
 *
 * A plain integer addition, which is the entire point: no rate, no compounding, no fraction of
 * a person to carry between months.
 */
function growPopulation(state: SimState): void {
  for (const city of state.cities) {
    // Debt and sieges can drive growth negative, but a settlement never empties out entirely —
    // it shrinks back to a hamlet and stops there. [GEN]
    city.population = Math.max(MIN_POPULATION, city.population + cityGrowth(state, city));
  }
}
