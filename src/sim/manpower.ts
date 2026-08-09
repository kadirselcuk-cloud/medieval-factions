import { unitById } from '../data/units';
import type { SimState } from './types';

/**
 * Manpower — how many men a realm has under arms.
 *
 * **There is no longer a ceiling on it** — owner-specified in 0.19.0 (docs/DESIGN.md decision 165):
 * "I don't want any navy or army limits, I want the limits to be decided by current condition of
 * treasury." From 0.14.0 to 0.18.10 a realm could keep a fifth of its people under arms and not one
 * man more, and `MANPOWER_SHARE_PERMILLE` was that fifth. Both are gone.
 *
 * What replaced it is not nothing, and it is not the treasury *balance* either. Three costs remain,
 * and together they bind harder than the wall did:
 *
 * - **A unit still costs its whole `size` in people**, taken from the settlement that raises it and
 *   never given back (`availableManpower` in construction.ts). That is the local limit, and it is
 *   the honest one: a Village of 1,000 can raise ten Light Infantry and be a hamlet afterwards.
 * - **Wages come off net income**, and since 0.19.0 net income is what population growth is
 *   measured from (`prosperityGrowth`). Every unit recruited therefore slows the growth of *every*
 *   settlement the realm holds. Recruit far enough past your means and the realm shrinks.
 * - **Unpaid troops desert**, at 10% a month, which is the floor under the whole arrangement.
 *
 * So the limit is a cost that rises smoothly rather than a wall that is hit, which is the shape the
 * owner asked for. A rich realm can field an enormous army; it simply stops growing while it does.
 *
 * Nothing here is stored. Population is in the save and units are in the save; manpower is
 * arithmetic over the two, so there is no third number that can fall out of step with them.
 */

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
 *
 * **Ships do count, since 0.18.0** (docs/DESIGN.md decision 127). A crew is men, and a Flagship's
 * two hundred of them are two Light Infantry the realm cannot also have. Moored hulls, hulls at
 * sea, hulls **still on the slipway** and any army aboard all count — the slipway on the same
 * reasoning that counts a unit in training, that the men were taken when the order went out.
 *
 * `unitById` resolves ships as well as land units, so `sizeOf` needs no naval branch: a ship id
 * simply answers with its crew.
 */
export function manpowerUnderArms(state: SimState, factionIndex: number): number {
  const sizeOf = (id: string, count: number): number => (unitById(id)?.size ?? 0) * count;

  let men = 0;
  for (const city of state.cities) {
    if (city.ownerIndex !== factionIndex) continue;
    for (const [id, count] of Object.entries(city.garrison)) men += sizeOf(id, count);
    for (const order of city.recruitQueue) men += sizeOf(order.id, 1);
    for (const [id, count] of Object.entries(city.fleet)) men += sizeOf(id, count);
    for (const order of city.shipQueue) men += sizeOf(order.id, 1);
  }
  for (const army of state.armies) {
    if (army.ownerIndex !== factionIndex) continue;
    for (const [id, count] of Object.entries(army.units)) men += sizeOf(id, count);
  }
  for (const fleet of state.fleets) {
    if (fleet.ownerIndex !== factionIndex) continue;
    for (const [id, count] of Object.entries(fleet.ships)) men += sizeOf(id, count);
    for (const [id, count] of Object.entries(fleet.cargo)) men += sizeOf(id, count);
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
 * What share of its people the realm currently has under arms, in per-mille.
 *
 * Nothing in the simulation reads this — it is no longer a limit and gates nothing. It survives
 * because it is the single most useful number for judging whether the treasury is in fact limiting
 * anything: the old rule held every realm at 200, and where this settles now is the measurement
 * that says whether removing the ceiling changed how large armies get. Read by the top bar and the
 * balance panel.
 */
export function armedSharePermille(state: SimState, factionIndex: number): number {
  const people = realmPeople(state, factionIndex);
  if (people === 0) return 0;
  return Math.floor((manpowerUnderArms(state, factionIndex) * 1000) / people);
}
