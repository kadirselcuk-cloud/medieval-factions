import { hasWarship, type UnitStack } from '../data/units';
import { inBounds, tileIndex, type World } from '../data/world';
import { stackSize } from './armies';
import { fightBattle, recordBattle, type BattleContingent } from './battle';
import { calendarAt } from './calendar';
import { pushEvent } from './events';
import {
  drownExcessCargo,
  fleetAt,
  fleetById,
  fleetSpeed,
  isWater,
  mergeFleets,
  orthogonalNeighbours,
  removeFleet,
} from './fleets';
import { Heap, MARCH_PER_TILE, SEASON_MOVEMENT } from './movement';
import { recomputeIncome } from './state';
import { MAX_FLEET_SHIPS, type FleetState, type SimState } from './types';

/**
 * Sailing, blockade and battle at sea — docs/MECHANICS.md §10.
 *
 * The land equivalent is `movement.ts` and the arithmetic is deliberately identical: integer march
 * points, `MARCH_PER_TILE` to cross a tile, the same seasonal percentage. Two things are simpler at
 * sea and one is harder.
 *
 * Simpler: **open water has no terrain cost and no owner**, so a sea tile always costs exactly one
 * tile's worth. There is no unclaimed-ground penalty and no hostile-ground penalty because nobody
 * holds the ocean, which is why the whole `tileMarchCost` apparatus has no counterpart here.
 *
 * Harder: **a warship intercepts within one tile** (decision 125). On land a battle happens when an
 * army walks into one; at sea it happens when two fleets end a tick beside each other, neither
 * having moved onto the other. That is what closes a strait, and it is the only place in the
 * simulation where combat is triggered by adjacency rather than by an order.
 */

/** Winter is the only modifier that survives at sea. Storms and short days, same as mud. */
export function seaSpeedPercent(state: SimState): number {
  return SEASON_MOVEMENT[calendarAt(state.tick).season];
}

/** Fleets move orthogonally, as armies do. Diagonals would make every stated speed a lie. */
const STEPS: readonly (readonly [number, number])[] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

export type SeaBlockReason = 'land' | 'hostile-fleet' | 'friendly-fleet';

/**
 * Why a fleet may not enter a sea tile, or `null` if it may.
 *
 * Mirrors `blockedBy` on land. A hostile fleet is a destination rather than a wall — sailing at one
 * is one of the two ways to start a battle — and a friendly one blocks unless this is the end of
 * the route, where the two merge.
 */
export function seaBlockedBy(
  state: SimState,
  world: World,
  fleet: FleetState,
  index: number,
  isDestination = false,
): SeaBlockReason | null {
  if (!isWater(world, index)) return 'land';

  const standing = fleetAt(state, index);
  if (standing && standing.id !== fleet.id) {
    if (standing.ownerIndex !== fleet.ownerIndex) return 'hostile-fleet';
    const room = stackSize(standing.ships) + stackSize(fleet.ships) <= MAX_FLEET_SHIPS;
    if (!isDestination || !room) return 'friendly-fleet';
  }
  return null;
}

/**
 * A* over water from the fleet's tile to `destination`, start excluded. `null` if there is no route.
 *
 * Every sea tile costs the same, so this is a breadth-first search wearing an A*'s clothes — but it
 * is written as A* anyway, because a route that has to end on a hostile fleet is not uniform and
 * because the two pathfinders staying the same shape is worth more than the few lines saved.
 */
export function findSeaPath(
  state: SimState,
  world: World,
  fleet: FleetState,
  destination: number,
  from: number = fleet.tileIndex,
): number[] | null {
  if (destination === from) return [];
  const stop = seaBlockedBy(state, world, fleet, destination, true);
  if (stop !== null && stop !== 'hostile-fleet') return null;

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

      // A route never threads *through* a hostile fleet; it may only end on one.
      const blocked = seaBlockedBy(state, world, fleet, next, next === destination);
      if (blocked !== null && !(next === destination && blocked === 'hostile-fleet')) continue;

      const candidate = (best[current] ?? Number.POSITIVE_INFINITY) + MARCH_PER_TILE;
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

// -------------------------------------------------------------------- orders

export type SailResult = { ok: true; tiles: number } | { ok: false; reason: 'no-such-fleet' | 'no-route' };

/** Order a fleet to sail, appending to whatever route it is already on. Mirrors `orderMove`. */
export function orderSail(
  state: SimState,
  world: World,
  fleetId: number,
  destination: number,
): SailResult {
  const fleet = fleetById(state, fleetId);
  if (!fleet) return { ok: false, reason: 'no-such-fleet' };

  const from = fleet.path[fleet.path.length - 1] ?? fleet.tileIndex;
  const leg = findSeaPath(state, world, fleet, destination, from);
  if (leg === null) return { ok: false, reason: 'no-route' };

  if (fleet.path.length === 0) {
    fleet.sail = 0;
    fleet.path = leg;
  } else {
    fleet.path = [...fleet.path, ...leg];
  }
  return { ok: true, tiles: fleet.path.length };
}

/** Cancel a fleet's whole route. */
export function haltFleet(state: SimState, fleetId: number): void {
  const fleet = fleetById(state, fleetId);
  if (!fleet) return;
  fleet.path = [];
  fleet.sail = 0;
}

// ------------------------------------------------------------------- ticking

/**
 * Sail every moving fleet on by one tick, then let the warships close.
 *
 * Movement first and interception second, in two separate passes over all fleets — not interleaved.
 * A fleet that has already moved this tick must not be able to dodge a blockade simply because it
 * was earlier in the array, and a fleet that has not moved yet must not be intercepted at a tile it
 * is about to leave. Both passes run in id order.
 */
export function advanceFleets(state: SimState, world: World): void {
  // Most campaigns have no fleet at all for their first decades, and this runs 120 times a month
  // for the whole of one. Leaving before the copy, the sort and the calendar lookup keeps a
  // land-only century costing exactly one comparison a tick.
  if (state.fleets.length === 0) return;

  const percent = seaSpeedPercent(state);
  /** Fleets that changed tile this tick. Interception is a rule about something *moving*. */
  const moved = new Set<number>();

  for (const fleet of [...state.fleets].sort((a, b) => a.id - b.id)) {
    if (!state.fleets.includes(fleet)) continue;
    if (fleet.path.length === 0) {
      fleet.sail = 0;
      continue;
    }

    const speed = fleetSpeed(fleet);
    if (speed <= 0) continue;
    fleet.sail += speed * percent;

    while (fleet.path.length > 0) {
      const next = fleet.path[0];
      if (next === undefined) break;

      const isLast = fleet.path.length === 1;
      const reason = seaBlockedBy(state, world, fleet, next, isLast);

      if (reason === 'hostile-fleet') {
        if (fleet.sail < MARCH_PER_TILE) break;
        fleet.sail -= MARCH_PER_TILE;
        fleet.path = [];
        const defender = fleetAt(state, next);
        if (defender) fightAtSea(state, world, fleet, defender, next);
        break;
      }

      if (reason !== null) {
        fleet.path = [];
        fleet.sail = 0;
        pushEvent(state, {
          kind: 'ship',
          text: 'A fleet put about, its passage blocked',
          tileIndex: fleet.tileIndex,
          factionIndex: fleet.ownerIndex,
        });
        break;
      }

      if (fleet.sail < MARCH_PER_TILE) break;
      fleet.sail -= MARCH_PER_TILE;
      fleet.path.shift();
      fleet.tileIndex = next;
      moved.add(fleet.id);

      const standing = state.fleets.find((o) => o.id !== fleet.id && o.tileIndex === next);
      if (standing) {
        mergeFleets(state, standing.id, fleet.id);
        break;
      }
    }
  }

  interceptAdjacent(state, world, moved);
}

/**
 * Warships pull in anything hostile that ends the tick beside them — decision 125.
 *
 * The rule that makes a blockade mean something on a map of narrow straits: without it a transport
 * slides past a Light Ship sitting in the Channel whenever the timing falls right, and controlling
 * the sea is worth nothing.
 *
 * Only a fleet carrying a **warship** can force it. Two unescorted convoys pass untouched — neither
 * has anything to fight with, and a battle between them would be two merchantmen staring.
 *
 * **One of the two must have moved this tick.** An interception is a rule about catching something
 * that is going somewhere, and without this clause two fleets that fought to the 48-turn stalemate
 * and both survived would sit beside each other re-fighting a hundred and twenty times a month —
 * grinding each other down a tick at a time, filling the battle log and burning the RNG. Requiring
 * movement makes a standoff a standoff: neither can force the other, and either can end it by
 * ordering a course onto the enemy's tile, which is the *other* way a sea battle starts.
 *
 * It costs the blockade nothing, because the thing a blockade catches is by definition sailing.
 *
 * Order is fixed and the reason matters: pairs are visited in ascending id, and where both sides
 * carry warships the **lower id is the attacker**. A tie broken by anything less arbitrary — who is
 * stronger, who moved last — would be a rule about initiative that nobody has written.
 */
function interceptAdjacent(state: SimState, world: World, moved: ReadonlySet<number>): void {
  if (moved.size === 0) return;

  for (const fleet of [...state.fleets].sort((a, b) => a.id - b.id)) {
    if (!state.fleets.includes(fleet)) continue;
    if (!hasWarship(fleet.ships)) continue;

    for (const tile of orthogonalNeighbours(world, fleet.tileIndex).sort((a, b) => a - b)) {
      const other = fleetAt(state, tile);
      if (!other || other.ownerIndex === fleet.ownerIndex) continue;
      if (!moved.has(fleet.id) && !moved.has(other.id)) continue;
      // Both escorted: the lower id is the attacker, so the pair is fought once, not twice.
      if (hasWarship(other.ships) && other.id < fleet.id) continue;

      fightAtSea(state, world, fleet, other, other.tileIndex);
      if (!state.fleets.includes(fleet)) break;
    }
  }
}

/**
 * Fight two fleets, using the **shipped auto-resolve unchanged**.
 *
 * There is no naval resolver and there was never going to be one. A ship's crew is its `size` and
 * its HP and damage are per crewman (decision 121), so a fleet musters into `fightBattle` as
 * formations exactly as an army does — same 50-tile field, same activation order, same damage
 * formula, same 3× rout rule.
 *
 * The one thing the sea does not have is **ground**: `defenderAdvantage` returns terrain, city,
 * fortification and winter for a water tile, and water carries none of the first three. Winter
 * still applies, which is a small oddity — it reads as the weather favouring whoever is being
 * closed on, and it is the same weather both fleets are in.
 *
 * Afterwards, **cargo is lost with the ship** (decision 126): capacity is recomputed from the
 * Transports that survived and anything above it drowns, on both sides.
 */
export function fightAtSea(
  state: SimState,
  world: World,
  attacker: FleetState,
  defender: FleetState,
  tile: number,
): void {
  const attackerId = attacker.id;
  const defenderId = defender.id;

  const setup = {
    tileIndex: tile,
    cityIndex: -1,
    attackerIndex: attacker.ownerIndex,
    defenderIndex: defender.ownerIndex,
    attacker: [{ source: 'army', stack: { ...attacker.ships }, armyId: attacker.id }] as BattleContingent[],
    defender: [{ source: 'army', stack: { ...defender.ships }, armyId: defender.id }] as BattleContingent[],
  };

  const { report, survivors } = fightBattle(state, world, setup);
  recordBattle(state, report);

  writeBackShips(state, attackerId, survivors[0].armies[0]?.units ?? {}, 'in the fighting');
  writeBackShips(state, defenderId, survivors[1].armies[0]?.units ?? {}, 'in the fighting');

  const sunk = report.losses[0] + report.losses[1];
  pushEvent(state, {
    kind: 'battle',
    text: `A battle at sea — ${report.winner === 'attacker' ? 'the attacker carried it' : report.winner === 'defender' ? 'the attack was beaten off' : 'both fleets broke off'}, ${sunk} lost`,
    tileIndex: tile,
    factionIndex: attacker.ownerIndex,
    battleId: report.id,
  });

  // A battle changes what each realm has to pay wages for, whether or not anything changed hands.
  recomputeIncome(state, world);
}

/** Survivors back onto a fleet, drowning whatever the remaining Transports cannot carry. */
function writeBackShips(
  state: SimState,
  fleetId: number,
  ships: UnitStack,
  how: string,
): void {
  const fleet = fleetById(state, fleetId);
  if (!fleet) return;

  fleet.ships = { ...ships };
  if (stackSize(fleet.ships) === 0) {
    // Every hull gone: everyone aboard goes with them. There is nothing left to write back to.
    const lost = stackSize(fleet.cargo);
    if (lost > 0) {
      pushEvent(state, {
        kind: 'desertion',
        text: `${lost} unit${lost === 1 ? '' : 's'} went down with the fleet`,
        tileIndex: fleet.tileIndex,
        factionIndex: fleet.ownerIndex,
      });
    }
    removeFleet(state, fleetId);
    return;
  }

  fleet.path = [];
  fleet.sail = 0;
  drownExcessCargo(state, fleet, how);
}
