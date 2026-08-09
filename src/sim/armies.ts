import { cityDefence, unitById, type UnitStack } from '../data/units';
import type { World } from '../data/world';
import { pushEvent } from './events';
import {
  MAX_ARMY_UNITS,
  type ArmyRole,
  type ArmyState,
  type CityState,
  type SimState,
} from './types';

/**
 * Field armies, and the line between a settlement's defenders and its mobile troops.
 *
 * A settlement holds two quite different things. Its **defence** is derived from its tier and
 * its buildings: free, immobile, and recomputed from the rules every time it is asked for, so
 * it can never drift out of step with them. Its **garrison** is units it actually paid to
 * recruit, and those are what an army mobilises from.
 *
 * The consequence is that no settlement on the map is ever undefended, and an army is always
 * something a faction chose to raise.
 */

export type ArmyFailure =
  | 'not-owner'
  | 'no-such-army'
  | 'no-settlement'
  | 'nothing-selected'
  | 'not-in-garrison'
  | 'army-full'
  | 'tile-occupied';

export type ArmyResult = { ok: true; armyId: number } | { ok: false; reason: ArmyFailure };

const fail = (reason: ArmyFailure): ArmyResult => ({ ok: false, reason });

// ------------------------------------------------------------------- queries

export function armyAt(state: SimState, tileIndex: number): ArmyState | undefined {
  return state.armies.find((army) => army.tileIndex === tileIndex);
}

/**
 * The settlement on a tile, in constant time.
 *
 * **A settlement never moves.** `CityState.tileIndex` is `readonly` and nothing in the simulation
 * assigns it, so the tile-to-settlement mapping is fixed for the whole campaign and can be built
 * once. Ownership, tier, garrison and siege all change freely — this hands back the live object, so
 * every caller still reads current truth.
 *
 * Worth the cache because `blockedBy` asks this **once per tile of every march, every tick**: with a
 * hundred and thirty armies on the map that is a linear scan of sixty settlements several thousand
 * times a second, and it measured as a quarter of the entire simulation's cost.
 *
 * Keyed on the array rather than the state so a deserialised save gets its own, and a projection
 * running on a structural copy does not poison the live campaign's.
 */
const cityByTile = new WeakMap<readonly CityState[], Map<number, CityState>>();

export function cityAt(state: SimState, tileIndex: number): CityState | undefined {
  let index = cityByTile.get(state.cities);
  if (!index) {
    index = new Map(state.cities.map((city) => [city.tileIndex, city]));
    cityByTile.set(state.cities, index);
  }
  return index.get(tileIndex);
}

export function armyById(state: SimState, id: number): ArmyState | undefined {
  return state.armies.find((army) => army.id === id);
}

export function armiesOf(state: SimState, factionIndex: number): readonly ArmyState[] {
  return state.armies.filter((army) => army.ownerIndex === factionIndex);
}

export function stackSize(stack: UnitStack): number {
  return Object.values(stack).reduce((total, count) => total + count, 0);
}

/** Soldiers, not units — the number that actually decides a battle. */
export function stackSoldiers(stack: UnitStack): number {
  return Object.entries(stack).reduce(
    (total, [id, count]) => total + (unitById(id)?.size ?? 0) * count,
    0,
  );
}

export function stackUpkeep(stack: UnitStack): number {
  return Object.entries(stack).reduce(
    (total, [id, count]) => total + (unitById(id)?.upkeep ?? 0) * count,
    0,
  );
}

/** An army marches at its slowest unit — docs/MECHANICS.md §3. */
export function armySpeed(army: ArmyState): number {
  const speeds = Object.keys(army.units)
    .map((id) => unitById(id)?.strategicSpeed ?? 0)
    .filter((speed) => speed > 0);
  return speeds.length === 0 ? 0 : Math.min(...speeds);
}

/**
 * What a settlement defends itself with. Free, immobile, and derived rather than stored.
 *
 * Every settlement on the map has one, including the Independents', which is what makes taking
 * a city a military problem rather than a walk.
 */
export function defenceOf(city: CityState): UnitStack {
  return cityDefence(city.tier, city.buildings);
}

// ------------------------------------------------------------------ mobilising

/**
 * Move units out of a settlement's garrison and into an army standing on its tile.
 *
 * Reinforces the army already there if there is one — "one army per tile" means a settlement
 * can only ever field one stack at a time, and the second mobilisation joins the first.
 */
/**
 * Raise an army from a settlement's garrison.
 *
 * `role` is what the stack is **for**, and it only ever matters to the rival realms — the player's
 * armies are all `field` and are commanded a click at a time. Reinforcing a stack already standing
 * on the settlement keeps that stack's existing role: a raiding column topped up from the city it
 * rode through is still a raiding column.
 */
export function mobilise(
  state: SimState,
  world: World,
  city: CityState,
  picks: UnitStack,
  role: ArmyRole = 'field',
): ArmyResult {
  const wanted = Object.entries(picks).filter(([, count]) => count > 0);
  if (wanted.length === 0) return fail('nothing-selected');

  for (const [id, count] of wanted) {
    if ((city.garrison[id] ?? 0) < count) return fail('not-in-garrison');
  }

  const existing = armyAt(state, city.tileIndex);
  if (existing && existing.ownerIndex !== city.ownerIndex) return fail('tile-occupied');

  const added = wanted.reduce((total, [, count]) => total + count, 0);
  const already = existing ? stackSize(existing.units) : 0;
  if (already + added > MAX_ARMY_UNITS) return fail('army-full');

  const army: ArmyState = existing ?? {
    id: state.nextArmyId++,
    ownerIndex: city.ownerIndex,
    tileIndex: city.tileIndex,
    units: {},
    path: [],
    march: 0,
    role,
  };

  for (const [id, count] of wanted) {
    const left = (city.garrison[id] ?? 0) - count;
    if (left > 0) city.garrison[id] = left;
    else delete city.garrison[id];
    army.units[id] = (army.units[id] ?? 0) + count;
  }

  if (!existing) state.armies.push(army);

  const name = world.cities[city.cityIndex]?.name ?? 'a settlement';
  pushEvent(state, {
    kind: 'army',
    text: `${added} unit${added === 1 ? '' : 's'} mustered at ${name}`,
    tileIndex: city.tileIndex,
    factionIndex: city.ownerIndex,
  });
  return { ok: true, armyId: army.id };
}

/**
 * Stand an army down into the settlement it is sitting on.
 *
 * The units go back into the garrison intact — dismissing an army is a redeployment, not a
 * loss. It only works on a friendly settlement, because a garrison is the thing they return to.
 */
export function standDown(state: SimState, world: World, armyId: number): ArmyResult {
  const army = armyById(state, armyId);
  if (!army) return fail('no-such-army');

  const city = state.cities.find((c) => c.tileIndex === army.tileIndex);
  if (!city) return fail('no-settlement');
  if (city.ownerIndex !== army.ownerIndex) return fail('not-owner');

  for (const [id, count] of Object.entries(army.units)) {
    city.garrison[id] = (city.garrison[id] ?? 0) + count;
  }
  removeArmy(state, armyId);

  const name = world.cities[city.cityIndex]?.name ?? 'a settlement';
  pushEvent(state, {
    kind: 'army',
    text: `An army stood down into the garrison at ${name}`,
    tileIndex: city.tileIndex,
    factionIndex: city.ownerIndex,
  });
  return { ok: true, armyId };
}

/** Disband in the field. The units are gone — there is no garrison to absorb them. */
export function disband(state: SimState, armyId: number): ArmyResult {
  const army = armyById(state, armyId);
  if (!army) return fail('no-such-army');

  pushEvent(state, {
    kind: 'army',
    text: `An army of ${stackSize(army.units)} disbanded in the field`,
    tileIndex: army.tileIndex,
    factionIndex: army.ownerIndex,
  });
  removeArmy(state, armyId);
  return { ok: true, armyId };
}

/**
 * Move an army onto a tile it has already been cleared to enter, and claim it.
 *
 * Returns true if ground changed hands. Shared by marching and by walking into a settlement
 * that has just been taken — both are the same act, and territory is claimed by presence either
 * way (docs/DESIGN.md decision 21).
 */
export function occupy(state: SimState, army: ArmyState, tileIndex: number): boolean {
  army.tileIndex = tileIndex;

  const standing = state.armies.find((other) => other.id !== army.id && other.tileIndex === tileIndex);
  if (standing) {
    // Arriving where a friendly stack is already parked folds the two together.
    merge(state, standing.id, army.id);
    return false;
  }

  if ((state.tileOwner[tileIndex] ?? -1) === army.ownerIndex) return false;
  state.tileOwner[tileIndex] = army.ownerIndex;
  return true;
}

export function removeArmy(state: SimState, armyId: number): void {
  const position = state.armies.findIndex((army) => army.id === armyId);
  if (position >= 0) state.armies.splice(position, 1);
}

/**
 * Fold one army into another standing on the same tile.
 *
 * "One army per tile" makes this the only outcome when a march ends where a friendly stack is
 * already parked, so it is the movement code's business as much as the player's.
 */
export function merge(state: SimState, intoId: number, fromId: number): ArmyResult {
  const into = armyById(state, intoId);
  const from = armyById(state, fromId);
  if (!into || !from) return fail('no-such-army');
  if (into.ownerIndex !== from.ownerIndex) return fail('not-owner');
  if (stackSize(into.units) + stackSize(from.units) > MAX_ARMY_UNITS) return fail('army-full');

  for (const [id, count] of Object.entries(from.units)) {
    into.units[id] = (into.units[id] ?? 0) + count;
  }
  removeArmy(state, fromId);
  return { ok: true, armyId: intoId };
}
