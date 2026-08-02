import { TERRAIN_PROFILE } from '../data/terrain';
import { inBounds, TERRAINS, tileIndex, type Terrain, type World } from '../data/world';
import { armyAt, armyById, armySpeed, merge, stackSize } from './armies';
import { calendarAt, TICKS_PER_MONTH, type Season } from './calendar';
import { pushEvent } from './events';
import { recomputeIncome } from './state';
import { MAX_ARMY_UNITS, type ArmyState, type SimState } from './types';

/**
 * Marching, pathfinding, and taking ground by standing on it.
 *
 * Movement is integer arithmetic end to end. A unit's strategic speed is tiles per month, and
 * a month is a fixed 120 ticks, so one tile of plains costs `MARCH_PER_TILE` points and an
 * army banks `speed × 100` of them each tick. Every terrain multiplier and the winter penalty
 * land on exact integers, which is what lets a march at 10× produce the same result as the
 * same march watched at 1×.
 */

/** Points to cross one tile of open, unmodified ground. */
export const MARCH_PER_TILE = TICKS_PER_MONTH * 100;

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

/** March points to enter this tile. Infinite for anything an army cannot walk on. */
export function tileMarchCost(world: World, index: number): number {
  const terrain = terrainOf(world, index);
  const profile = TERRAIN_PROFILE[terrain];
  if (!Number.isFinite(profile.moveCost)) return Number.POSITIVE_INFINITY;
  return MARCH_PER_TILE * profile.moveCost;
}

/** Terrain by flat index. `terrainAt` takes x and y; the pathfinder only ever has an index. */
function terrainOf(world: World, index: number): Terrain {
  return TERRAINS[world.terrain[index] ?? 0] ?? 'water';
}

export type BlockReason = 'water' | 'hostile-army' | 'hostile-settlement' | 'friendly-army';

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

  const city = state.cities.find((c) => c.tileIndex === index);
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
  if (blockedBy(state, world, army, destination, true) !== null) return null;

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
      if (blockedBy(state, world, army, next, next === destination) !== null) continue;

      const cost = tileMarchCost(world, next);
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

/** Binary min-heap keyed on f-score. Small enough to be worth not pulling in a dependency. */
class Heap {
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
      if (reason !== null) {
        army.path = [];
        army.march = 0;
        pushEvent(state, {
          kind: 'army',
          text:
            reason === 'hostile-settlement'
              ? 'An army halted at a defended settlement — it cannot be taken until battles exist'
              : 'An army halted, its road blocked',
          tileIndex: army.tileIndex,
          factionIndex: army.ownerIndex,
        });
        break;
      }

      const cost = tileMarchCost(world, next);
      if (army.march < cost) break;

      army.march -= cost;
      army.path.shift();
      if (enter(state, army, next)) claimed = true;

      // The army merged into another and no longer exists.
      if (!state.armies.includes(army)) break;
    }
  }

  // Ground changing hands changes what a realm earns, and the top bar should not wait for the
  // month to roll over to admit it.
  if (claimed) recomputeIncome(state, world);
}

/** Move an army onto a tile it has already been cleared to enter. Returns true if ground changed hands. */
function enter(state: SimState, army: ArmyState, index: number): boolean {
  army.tileIndex = index;

  const standing = state.armies.find((other) => other.id !== army.id && other.tileIndex === index);
  if (standing) {
    // Arriving where a friendly stack is already parked folds the two together.
    merge(state, standing.id, army.id);
    return false;
  }

  // Territory is claimed by presence — docs/DESIGN.md decision 21.
  if ((state.tileOwner[index] ?? -1) === army.ownerIndex) return false;
  state.tileOwner[index] = army.ownerIndex;
  return true;
}
