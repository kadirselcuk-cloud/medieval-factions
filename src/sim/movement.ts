import { TERRAIN_PROFILE } from '../data/terrain';
import { inBounds, TERRAINS, tileIndex, type Terrain, type World } from '../data/world';
import { armyAt, armyById, armySpeed, cityAt, occupy, stackSize } from './armies';
import { calendarAt, TICKS_PER_MONTH, type Season } from './calendar';
import { resolveEngagement } from './conquest';
import { pushEvent } from './events';
import { recomputeIncome } from './state';
import { MAX_ARMY_UNITS, type ArmyState, type SimState } from './types';

/**
 * Marching, pathfinding, and taking ground by standing on it.
 *
 * Movement is integer arithmetic end to end. A month is a fixed 120 ticks, one tile of open
 * ground costs `MARCH_PER_TILE` points, and an army banks `speed × season%` of them each tick.
 * Every terrain multiplier and the winter penalty land on exact integers, which is what lets a
 * march at 10× produce the same result as the same march watched at 1×.
 *
 * **Speed is held in hundredths of a tile per month** (`SPEED_SCALE`), not in whole tiles. Since
 * 0.16.0 the fastest thing in the game crosses one tile a month and the slowest takes two, so
 * whole tiles per month is no longer a unit fine enough to say anything in — and a half-tile speed
 * multiplied by a 60% winter would be the first fraction ever to reach the simulation. Data still
 * reads in tiles per month, in `data/units.json`; the loader scales it once, on the way in.
 */

/** A unit's `strategicSpeed` is stored in hundredths of a tile per month. */
export const SPEED_SCALE = 100;

/**
 * Points to cross one tile of open, unmodified ground.
 *
 * `TICKS_PER_MONTH × 100 × SPEED_SCALE`: an army banking `speed` points a tick for a whole month
 * accumulates exactly `speed / SPEED_SCALE` tiles' worth, at any game speed and with any seasonal
 * percentage applied, without a division anywhere.
 */
export const MARCH_PER_TILE = TICKS_PER_MONTH * 100 * SPEED_SCALE;

/**
 * Seasonal movement, as a percentage — docs/MECHANICS.md §5. Winter is −40%.
 *
 * Applied to the rate an army banks points, not to the cost of the ground, so a hard winter
 * slows every army by the same fraction wherever it happens to be standing.
 */
export const SEASON_MOVEMENT: Record<Season, number> = {
  winter: 60,
  spring: 100,
  summer: 100,
  autumn: 100,
};

/**
 * Armies move orthogonally.
 *
 * Diagonals would let an army cross √2 tiles of ground for the price of one, which quietly
 * makes every stated speed a lie in the corners of the map. **[GEN]** — the owner specified
 * orthogonal neighbours for starting territory but never for movement. */
const STEPS: readonly (readonly [number, number])[] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

/**
 * Ground nobody has claimed slows a march — **20%**, owner-authored.
 *
 * An army in its own country has roads it maintains, fords it knows and reeves who feed it. Off
 * the end of that it is finding its own way.
 */
export const UNCLAIMED_MARCH_PERMILLE = 1200;

/**
 * And a rival's ground slows it by **40%**, owner-authored.
 *
 * Twice the penalty of open country, because hostile ground is not merely unfamiliar: the bridges
 * are down, the villages are emptied and nobody gives directions. It is what makes a deep invasion
 * an undertaking rather than a walk, and it is why taking the border tiles first is worth doing —
 * claimed ground is fast ground, so an advance that consolidates behind itself accelerates.
 */
export const HOSTILE_MARCH_PERMILLE = 1400;

/**
 * March points for `factionIndex` to enter this tile. Infinite for anything an army cannot walk on.
 *
 * Cost depends on **who holds the ground**, so it changes during a campaign as borders move. That
 * is safe for the pathfinder: every multiplier is ≥ 1, so the A* heuristic — plain `MARCH_PER_TILE`
 * per remaining tile — still never overestimates and the route it finds is still optimal.
 *
 * Per-mille rather than a fraction so the arithmetic stays exact: the base is `TICKS_PER_MONTH ×
 * 100 × SPEED_SCALE`, which every terrain and territory multiplier in the game divides cleanly.
 */
export function tileMarchCost(
  state: SimState,
  world: World,
  index: number,
  factionIndex: number,
): number {
  const terrain = terrainOf(world, index);
  const profile = TERRAIN_PROFILE[terrain];
  if (!Number.isFinite(profile.moveCost)) return Number.POSITIVE_INFINITY;

  const owner = state.tileOwner[index] ?? -1;
  const territory =
    owner === factionIndex ? 1000 : owner === -1 ? UNCLAIMED_MARCH_PERMILLE : HOSTILE_MARCH_PERMILLE;

  return (MARCH_PER_TILE * profile.moveCost * territory) / 1000;
}

/** Terrain by flat index. `terrainAt` takes x and y; the pathfinder only ever has an index. */
export function terrainOf(world: World, index: number): Terrain {
  return TERRAINS[world.terrain[index] ?? 0] ?? 'water';
}

export type BlockReason = 'water' | 'hostile-army' | 'hostile-settlement' | 'friendly-army';

/**
 * Hostile ground stops a march, but it can still be *marched at* — it is a destination, not a
 * wall. Anything else that blocks is simply impassable and the route has to go round it.
 */
export function attackable(reason: BlockReason | null): boolean {
  return reason === 'hostile-army' || reason === 'hostile-settlement';
}

/**
 * Why an army may not enter a tile, or `null` if it may.
 *
 * Open ground is walkable whoever owns it — a realm's borders do not stop a march, only its
 * armies and its walls do. A friendly army blocks too, because one army per tile is an
 * invariant; the exception is the end of a march, where the two stacks merge instead.
 */
export function blockedBy(
  state: SimState,
  world: World,
  army: ArmyState,
  index: number,
  isDestination = false,
): BlockReason | null {
  if (terrainOf(world, index) === 'water') return 'water';

  const city = cityAt(state, index);
  if (city && city.ownerIndex !== army.ownerIndex) return 'hostile-settlement';

  const standing = armyAt(state, index);
  if (standing && standing.id !== army.id) {
    if (standing.ownerIndex !== army.ownerIndex) return 'hostile-army';
    const room = stackSize(standing.units) + stackSize(army.units) <= MAX_ARMY_UNITS;
    if (!isDestination || !room) return 'friendly-army';
  }
  return null;
}

// --------------------------------------------------------------- pathfinding

/**
 * A* from the army's tile to `destination`, returning the tiles to walk, start excluded.
 *
 * `null` means there is no route — the destination is water, walled off by hostile ground, or
 * simply unreachable. The heuristic is Manhattan distance at the cheapest possible terrain,
 * which never overestimates, so the first route found is the cheapest one.
 */
export function findPath(
  state: SimState,
  world: World,
  army: ArmyState,
  destination: number,
  /** Where to start from. Defaults to where the army stands; a queued leg starts from the
   *  end of the leg before it. */
  from: number = army.tileIndex,
): number[] | null {
  if (destination === from) return [];
  // The destination may be an enemy army or a defended settlement — marching at one is how a
  // battle is started. Anything else that blocks it means there is nowhere to go.
  const stop = blockedBy(state, world, army, destination, true);
  if (stop !== null && !attackable(stop)) return null;

  const size = world.width * world.height;
  const best = new Float64Array(size).fill(Number.POSITIVE_INFINITY);
  const cameFrom = new Int32Array(size).fill(-1);
  const closed = new Uint8Array(size);

  const goalX = destination % world.width;
  const goalY = Math.floor(destination / world.width);
  const heuristic = (index: number) =>
    (Math.abs((index % world.width) - goalX) + Math.abs(Math.floor(index / world.width) - goalY)) *
    MARCH_PER_TILE;

  const open = new Heap();
  best[from] = 0;
  open.push(from, heuristic(from));

  while (open.size > 0) {
    const current = open.pop();
    if (current === destination) return reconstruct(cameFrom, from, destination);
    if (closed[current]) continue;
    closed[current] = 1;

    const x = current % world.width;
    const y = Math.floor(current / world.width);

    for (const [dx, dy] of STEPS) {
      const nx = x + dx;
      const ny = y + dy;
      if (!inBounds(world, nx, ny)) continue;

      const next = tileIndex(world, nx, ny);
      if (closed[next]) continue;

      // A route never threads *through* hostile ground; it may only end on it.
      const blocked = blockedBy(state, world, army, next, next === destination);
      if (blocked !== null && !(next === destination && attackable(blocked))) continue;

      const cost = tileMarchCost(state, world, next, army.ownerIndex);
      if (!Number.isFinite(cost)) continue;

      const candidate = (best[current] ?? Number.POSITIVE_INFINITY) + cost;
      if (candidate >= (best[next] ?? Number.POSITIVE_INFINITY)) continue;

      best[next] = candidate;
      cameFrom[next] = current;
      open.push(next, candidate + heuristic(next));
    }
  }
  return null;
}

function reconstruct(cameFrom: Int32Array, start: number, goal: number): number[] {
  const path: number[] = [];
  let node = goal;
  while (node !== start && node >= 0) {
    path.push(node);
    node = cameFrom[node] ?? -1;
  }
  return path.reverse();
}

/**
 * Binary min-heap keyed on f-score. Small enough to be worth not pulling in a dependency.
 *
 * Exported since 0.18.0 so the sea pathfinder can share it. A second copy would be a second thing
 * to get wrong, and the two searches differ in what a tile costs, not in how the frontier is kept.
 */
export class Heap {
  private readonly items: number[] = [];
  private readonly keys: number[] = [];

  get size(): number {
    return this.items.length;
  }

  push(item: number, key: number): void {
    this.items.push(item);
    this.keys.push(key);
    let child = this.items.length - 1;
    while (child > 0) {
      const parent = (child - 1) >> 1;
      if ((this.keys[parent] ?? 0) <= (this.keys[child] ?? 0)) break;
      this.swap(parent, child);
      child = parent;
    }
  }

  pop(): number {
    const top = this.items[0] ?? -1;
    const lastItem = this.items.pop();
    const lastKey = this.keys.pop();
    if (this.items.length > 0 && lastItem !== undefined && lastKey !== undefined) {
      this.items[0] = lastItem;
      this.keys[0] = lastKey;
      let parent = 0;
      for (;;) {
        const left = parent * 2 + 1;
        const right = left + 1;
        let smallest = parent;
        if (left < this.items.length && (this.keys[left] ?? 0) < (this.keys[smallest] ?? 0)) smallest = left;
        if (right < this.items.length && (this.keys[right] ?? 0) < (this.keys[smallest] ?? 0)) smallest = right;
        if (smallest === parent) break;
        this.swap(parent, smallest);
        parent = smallest;
      }
    }
    return top;
  }

  private swap(a: number, b: number): void {
    [this.items[a], this.items[b]] = [this.items[b] ?? 0, this.items[a] ?? 0];
    [this.keys[a], this.keys[b]] = [this.keys[b] ?? 0, this.keys[a] ?? 0];
  }
}

// ------------------------------------------------------------------- orders

export type MoveResult = { ok: true; tiles: number } | { ok: false; reason: 'no-such-army' | 'no-route' };

/**
 * Order an army to march, **continuing from wherever it is already headed**.
 *
 * A second order does not throw away the first: the new leg is routed from the end of the
 * existing route and appended, so a player can lay out a journey with several clicks and have
 * the army walk the whole of it. `halt` is the way to throw a route away — that pairing is why
 * this appends rather than replaces.
 */
export function orderMove(
  state: SimState,
  world: World,
  armyId: number,
  destination: number,
): MoveResult {
  const army = armyById(state, armyId);
  if (!army) return { ok: false, reason: 'no-such-army' };

  const from = army.path[army.path.length - 1] ?? army.tileIndex;
  const leg = findPath(state, world, army, destination, from);
  if (leg === null) return { ok: false, reason: 'no-route' };

  if (army.path.length === 0) {
    // Starting from a standstill. Banked progress is discarded so an army cannot sit still
    // storing momentum and then jump a tile the moment it is pointed somewhere.
    army.march = 0;
    army.path = leg;
  } else {
    army.path = [...army.path, ...leg];
  }
  return { ok: true, tiles: army.path.length };
}

/** Cancel an army's whole route, queued legs and all. */
export function halt(state: SimState, armyId: number): void {
  const army = armyById(state, armyId);
  if (!army) return;
  army.path = [];
  army.march = 0;
}

// -------------------------------------------------------------------- ticking

/**
 * Walk every marching army on by one tick.
 *
 * An army may cross more than one tile in a tick at high speed on good ground, so this drains
 * the banked points in a loop rather than stepping once.
 */
export function advanceArmies(state: SimState, world: World): void {
  const percent = SEASON_MOVEMENT[calendarAt(state.tick).season];
  let claimed = false;

  for (const army of [...state.armies]) {
    if (army.path.length === 0) {
      army.march = 0;
      continue;
    }

    const speed = armySpeed(army);
    if (speed <= 0) continue;
    army.march += speed * percent;

    while (army.path.length > 0) {
      const next = army.path[0];
      if (next === undefined) break;

      const isLast = army.path.length === 1;
      const reason = blockedBy(state, world, army, next, isLast);

      // Hostile ground is not a wall — it is a battle, and the march has to reach it first.
      // The army pays the tile's cost to make contact whether it takes the ground or not.
      if (reason === 'hostile-army' || reason === 'hostile-settlement') {
        const toll = tileMarchCost(state, world, next, army.ownerIndex);
        if (army.march < toll) break;
        army.march -= toll;

        const { advance } = resolveEngagement(state, world, army, next);
        if (advance) occupy(state, army, next);
        // A battle changes what each realm holds and what it has to pay for, whether or not the
        // ground moved, so income is always stale afterwards.
        claimed = true;
        break;
      }

      if (reason !== null) {
        army.path = [];
        army.march = 0;
        pushEvent(state, {
          kind: 'army',
          text: 'An army halted, its road blocked',
          tileIndex: army.tileIndex,
          factionIndex: army.ownerIndex,
        });
        break;
      }

      const cost = tileMarchCost(state, world, next, army.ownerIndex);
      if (army.march < cost) break;

      army.march -= cost;
      army.path.shift();
      if (occupy(state, army, next)) claimed = true;

      // The army merged into another and no longer exists.
      if (!state.armies.includes(army)) break;
    }
  }

  // Ground changing hands changes what a realm earns, and the top bar should not wait for the
  // month to roll over to admit it.
  if (claimed) recomputeIncome(state, world);
}

/**
 * Storm a settlement now, from where the army stands.
 *
 * The other way in is to besiege it and wait; this is the impatient one, and the walls count.
 * It lives here rather than in `conquest.ts` because taking ground and walking onto it are the
 * same act, and marching already owns that pairing.
 */
export function assault(state: SimState, world: World, armyId: number, tile: number): void {
  const army = armyById(state, armyId);
  if (!army) return;

  const { advance } = resolveEngagement(state, world, army, tile);
  if (advance) occupy(state, army, tile);
  recomputeIncome(state, world);
}
