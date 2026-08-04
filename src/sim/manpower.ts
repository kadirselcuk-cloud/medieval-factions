import { unitById } from '../data/units';
import type { SimState } from './types';

/**
 * Manpower — how many men a realm can keep under arms at once.
 *
 * Gold buys a unit; **people are what it is made of**, and a realm only has so many. Before this
 * the only brake on an army was the treasury and a settlement's own floor, so a rich realm could
 * field thirty stacks of the cheapest thing it could train and win by weight of numbers. The cap
 * replaces that with a different question — not "can I afford another unit" but "is this the unit
 * I want my people to be" — which is what makes an expensive, powerful unit worth buying.
 *
 * The rule, owner-authored (docs/MECHANICS.md §5): **a realm may keep a fifth of its people under
 * arms.** All of its people, soldiers included. A recruit does not vanish from the realm when he
 * is levied, he changes what he does with his day: he comes off a settlement's population and goes
 * into `underArms`, and the total the fifth is taken of does not move.
 *
 * That is the whole reason this is comprehensible. The cap is a property of **how many people the
 * realm has**, so it moves for exactly two reasons — people are born, and land changes hands — and
 * never as a side effect of recruiting. Conquest is the only fast way to raise it, which is
 * precisely the pressure the game is meant to apply.
 *
 * Nothing here is stored. Population is in the save and units are in the save; manpower is
 * arithmetic over the two, so there is no third number that can fall out of step with them and
 * nothing to migrate when the share is retuned.
 */

/**
 * The share of a realm's people it may keep under arms, in per-mille. **Owner-authored: 20%.**
 *
 * Per-mille rather than a fraction because the whole simulation is integers — see types.ts.
 *
 * Worth knowing before this is retuned: a unit is 40–100 men and a starting Village is 1,000
 * people, so 20% supports **two Light Infantry and no more** until the realm takes its first city.
 * The owner has seen that figure and chosen to judge it by playing. It is one constant in one
 * file, and no code depends on its value.
 */
export const MANPOWER_SHARE_PERMILLE = 200;

/**
 * Men currently under arms.
 *
 * Garrisons, field armies **and units still in training**. The queue counts because the men were
 * levied when the order went out, not when it finished: they are already out of the fields and
 * already off the settlement's population. Leaving them out would let a realm queue twenty units
 * against one unit's worth of room and go over the cap the month they all completed.
 *
 * A settlement's own derived defence is not manpower. It costs nothing, is not recruited, and
 * cannot leave the walls — it is part of the settlement rather than troops the realm raised.
 * Ships draw nobody: crew size has never been specified, and inventing one would invent a rule.
 */
export function manpowerUnderArms(state: SimState, factionIndex: number): number {
  const sizeOf = (id: string, count: number): number => (unitById(id)?.size ?? 0) * count;

  let men = 0;
  for (const city of state.cities) {
    if (city.ownerIndex !== factionIndex) continue;
    for (const [id, count] of Object.entries(city.garrison)) men += sizeOf(id, count);
    for (const order of city.recruitQueue) men += sizeOf(order.id, 1);
  }
  for (const army of state.armies) {
    if (army.ownerIndex !== factionIndex) continue;
    for (const [id, count] of Object.entries(army.units)) men += sizeOf(id, count);
  }
  return men;
}

/**
 * Every soul the realm has — the people in its settlements **plus** the men it has under arms.
 *
 * Soldiers are counted because they are still the realm's people; they are simply not at home.
 * Counting only the civilians left behind would make every man raised shrink the very number his
 * own limit is taken from, and the realm would settle at a sixth of its people rather than the
 * fifth the rule says.
 */
export function realmPeople(state: SimState, factionIndex: number): number {
  let people = manpowerUnderArms(state, factionIndex);
  for (const city of state.cities) {
    if (city.ownerIndex === factionIndex) people += city.population;
  }
  return people;
}

/**
 * The most men this realm may have under arms, given the people it has **now**.
 *
 * Recomputed rather than remembered, so a city taken raises it the same month and a city lost
 * lowers it the same month.
 */
export function manpowerCap(state: SimState, factionIndex: number): number {
  return Math.floor((realmPeople(state, factionIndex) * MANPOWER_SHARE_PERMILLE) / 1000);
}

/**
 * Men the realm could still raise — men, not units.
 *
 * Plain subtraction, and it can be plain precisely because recruiting does not move the cap.
 *
 * It can read **negative in principle** and is clamped at zero: losing half a realm to conquest,
 * or starving under siege, drops the cap below the men already standing. Nothing is disbanded when
 * that happens — the cap gates recruitment, it does not conscript backwards, and a rule that
 * dissolved an army the month a city fell would be a rule nobody has written down. Logged in
 * docs/OPEN-QUESTIONS.md.
 */
export function freeManpower(state: SimState, factionIndex: number): number {
  return Math.max(0, manpowerCap(state, factionIndex) - manpowerUnderArms(state, factionIndex));
}

/**
 * Whether the realm can put another unit of this many men in the field.
 *
 * The one gate every caller goes through — the player's recruit panel, the AI, and `queueUnit`
 * itself — so there is no path that can quietly exceed the cap.
 */
export function canRaise(state: SimState, factionIndex: number, men: number): boolean {
  return men <= freeManpower(state, factionIndex);
}
