import { hasWarship, transportsIn, type UnitStack } from '../data/units';
import { inBounds, tileIndex, type World } from '../data/world';
import { removeArmy, stackSize } from './armies';
import {
  defenderAdvantage,
  fightBattle,
  recordBattle,
  type BattleContingent,
} from './battle';
import { calendarAt, isMonthBoundary } from './calendar';
import { pushEvent } from './events';
import {
  drownExcessCargo,
  fleetAt,
  fleetById,
  fleetSpeed,
  isWater,
  mergeFleets,
  seaNeighbours,
  removeFleet,
} from './fleets';
import { Heap, MARCH_PER_TILE, SEASON_MOVEMENT } from './movement';
import { recomputeIncome } from './state';
import {
  MAX_FLEET_SHIPS,
  MAX_FLEET_TRANSPORTS,
  type FleetState,
  type SimState,
} from './types';

/**
 * Sailing, blockade and battle at sea — docs/MECHANICS.md §10.
 *
 * The land equivalent is `movement.ts` and the arithmetic is deliberately identical: integer march
 * points, `MARCH_PER_TILE` to cross a tile, the same seasonal percentage. Two things are simpler at
 * sea and one is harder.
 *
 * Simpler: **open water has no terrain cost and no owner.** There is no unclaimed-ground penalty and
 * no hostile-ground penalty because nobody holds the ocean, which is why the whole `tileMarchCost`
 * apparatus has no counterpart here — a sea tile costs a tile, and the only thing that varies is
 * whether the step was straight or diagonal.
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

/**
 * Fleets move in **eight** directions — owner-specified in 0.18.3. Armies still move in four.
 *
 * The difference is geography, not a change of mind about diagonals. This map's water is a set of
 * basins joined at single tiles and several of those joins are diagonal: with four-way movement the
 * **Black Sea cannot reach the Mediterranean at all**, so a realm on it could build any navy it
 * liked and never leave home. Eight-way makes the whole sea one body of water.
 *
 * Listed clockwise from north, and the order is fixed because it decides tie-breaks in the
 * pathfinder and a route has to replay identically from a save.
 */
const STEPS: readonly (readonly [number, number])[] = [
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
];

/**
 * What a diagonal costs, per-mille of a straight tile. **√2, to three places.**
 *
 * The reason armies have no diagonals is that one would let a stack cross √2 tiles of ground for
 * the price of one, making every stated speed a lie in the corners of the map. Giving ships
 * diagonals does not make that argument wrong — it makes it something to **pay for**. A diagonal
 * costs what a diagonal is, so "three tiles a month" stays true in every direction.
 *
 * Exact in integers: `MARCH_PER_TILE` is 1,200,000, so a diagonal is 1,696,800 with no remainder.
 */
export const DIAGONAL_PERMILLE = 1414;

/** March points to enter `to` from `from`, both sea tiles one step apart. */
function seaStepCost(world: World, from: number, to: number): number {
  const dx = Math.abs((to % world.width) - (from % world.width));
  const dy = Math.abs(Math.floor(to / world.width) - Math.floor(from / world.width));
  return dx === 1 && dy === 1
    ? Math.floor((MARCH_PER_TILE * DIAGONAL_PERMILLE) / 1000)
    : MARCH_PER_TILE;
}

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
    // Room means hulls **and** transports: four to a fleet, so two half-loaded convoys cannot
    // merge into one that carries two armies.
    const room =
      stackSize(standing.ships) + stackSize(fleet.ships) <= MAX_FLEET_SHIPS &&
      transportsIn(standing.ships) + transportsIn(fleet.ships) <= MAX_FLEET_TRANSPORTS;
    if (!isDestination || !room) return 'friendly-fleet';
  }
  return null;
}

/**
 * A* over water from the fleet's tile to `destination`, start excluded. `null` if there is no route.
 *
 * Genuinely an A* since 0.18.3: with eight-way movement a diagonal costs √2 and a straight step
 * costs 1, so the frontier is no longer uniform and a breadth-first sweep would return routes that
 * merely look short.
 */
export function findSeaPath(
  state: SimState,
  world: World,
  fleet: FleetState,
  destination: number,
  from: number = fleet.tileIndex,
  /**
   * Water this fleet would rather not cross — **since 0.19.1**, and it is how a convoy keeps out
   * of a warship's reach (docs/DESIGN.md decision 166).
   *
   * Treated as impassable rather than merely expensive, because interception is not a risk but a
   * certainty: a warship catches anything that ends a tick within one tile of it, and cargo is lost
   * with the ship. There is no route worth taking that saves an hour and drowns an army.
   *
   * The **destination is always allowed** even if it is in the set. A landing beach beside a hostile
   * squadron is still where the army has to go; what this avoids is being caught in transit.
   * Callers that want the destination avoided too should not ask for it.
   */
  avoid?: ReadonlySet<number>,
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
  // **Chebyshev, not Manhattan.** With diagonals a fleet covers a tile of x and a tile of y in one
  // step, so Manhattan distance would overestimate what is left, the heuristic would stop being
  // admissible, and A* would start returning routes that merely look short. The larger axis is the
  // fewest steps possible, and every step costs at least a straight tile.
  const heuristic = (index: number) =>
    Math.max(
      Math.abs((index % world.width) - goalX),
      Math.abs(Math.floor(index / world.width) - goalY),
    ) * MARCH_PER_TILE;

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

      // Menaced water, if the caller named any. The goal is exempt — see `avoid`.
      if (avoid !== undefined && next !== destination && avoid.has(next)) continue;

      const candidate = (best[current] ?? Number.POSITIVE_INFINITY) + seaStepCost(world, current, next);
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
  /** Water to route around if it can be done at all — see `findSeaPath`. */
  avoid?: ReadonlySet<number>,
): SailResult {
  const fleet = fleetById(state, fleetId);
  if (!fleet) return { ok: false, reason: 'no-such-fleet' };

  const from = fleet.path[fleet.path.length - 1] ?? fleet.tileIndex;
  const leg = findSeaPath(state, world, fleet, destination, from, avoid);
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

      const toll = seaStepCost(world, fleet.tileIndex, next);

      if (reason === 'hostile-fleet') {
        if (fleet.sail < toll) break;
        fleet.sail -= toll;
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

      if (fleet.sail < toll) break;
      fleet.sail -= toll;
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
 * **Either one moved this tick, or the month has turned.** Something has to throttle this: two
 * fleets that fought to the 48-turn stalemate and both survived would otherwise sit beside each
 * other re-fighting a hundred and twenty times a month, grinding each other down a tick at a time
 * and burning the RNG.
 *
 * Requiring *movement* was the first attempt and it was wrong — it made a standoff permanent.
 * Measured in play: **four Byzantine flagships and eight Turkish ones sat adjacent in open water and
 * never fought**, because neither had anywhere it was going. Neither realm could force the issue and
 * neither would break off, for ever.
 *
 * A monthly engagement is the honest throttle. Fleets in contact fight once a month, which is the
 * cadence everything else in this game decides on, and a blockade still catches anything that sails
 * into it the moment it arrives.
 *
 * Order is fixed and the reason matters: pairs are visited in ascending id, and where both sides
 * carry warships the **lower id is the attacker**. A tie broken by anything less arbitrary — who is
 * stronger, who moved last — would be a rule about initiative that nobody has written.
 */
function interceptAdjacent(state: SimState, world: World, moved: ReadonlySet<number>): void {
  const monthTurned = isMonthBoundary(state.tick);
  if (moved.size === 0 && !monthTurned) return;

  for (const fleet of [...state.fleets].sort((a, b) => a.id - b.id)) {
    if (!state.fleets.includes(fleet)) continue;
    if (!hasWarship(fleet.ships)) continue;

    for (const tile of seaNeighbours(world, fleet.tileIndex).sort((a, b) => a - b)) {
      const other = fleetAt(state, tile);
      if (!other || other.ownerIndex === fleet.ownerIndex) continue;
      if (!monthTurned && !moved.has(fleet.id) && !moved.has(other.id)) continue;
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

/**
 * Storm a defended beach straight off the boats — owner-specified in 0.18.5.
 *
 * "The ships carrying troops should be able to fight vs troops on the land if there is no landing
 * zone empty, as if it is attacking the army from the ground."
 *
 * A **last resort, and only against troops.** An empty beach is always preferred and `putAshore`
 * tries every one of them first; this is what happens when a coast is held shoulder to shoulder and
 * the alternative is a loaded fleet circling for ever. Settlements are still excluded, which keeps
 * the earlier rule intact: an army does not assault a city from the sea, it lands beside one and
 * marches in.
 *
 * The men fight **as if they had marched there**. The defender gets the full ground advantage of the
 * tile it is standing on, exactly as it would against an attack overland — no allowance either way
 * for the water behind the attacker, because none was specified and inventing one would invent a
 * rule.
 *
 * Winning puts the survivors ashore as an army and takes the tile. Losing is expensive in the way
 * everything naval is expensive: the men who fell are gone, and what is left goes back aboard.
 */
export function stormBeach(
  state: SimState,
  world: World,
  fleet: FleetState,
  tile: number,
): boolean {
  if (stackSize(fleet.cargo) === 0) return false;
  if (isWater(world, tile)) return false;
  // Never a settlement — that rule predates this one and survives it.
  if (state.cities.some((city) => city.tileIndex === tile)) return false;

  const defender = state.armies.find((army) => army.tileIndex === tile);
  if (!defender || defender.ownerIndex === fleet.ownerIndex) return false;

  const advantage = defenderAdvantage(state, world, tile);
  const { report, survivors } = fightBattle(state, world, {
    tileIndex: tile,
    cityIndex: -1,
    attackerIndex: fleet.ownerIndex,
    defenderIndex: defender.ownerIndex,
    // The landing force has no army id — it is cargo until it is ashore.
    attacker: [{ source: 'army', stack: { ...fleet.cargo }, armyId: -1 }],
    defender: [
      { source: 'army', stack: { ...defender.units }, advantage: advantage.total, armyId: defender.id },
    ],
  });
  recordBattle(state, report);

  const ashore = survivors[0].armies.find((a) => a.armyId === -1)?.units ?? {};
  const held = survivors[1].armies.find((a) => a.armyId === defender.id)?.units ?? {};
  const won = report.winner === 'attacker';

  if (won) {
    removeArmy(state, defender.id);
    fleet.cargo = {};
    if (stackSize(ashore) > 0) {
      state.armies.push({
        id: state.nextArmyId++,
        ownerIndex: fleet.ownerIndex,
        tileIndex: tile,
        units: ashore,
        path: [],
        march: 0,
        role: 'field',
      });
      // Ground is taken by standing on it, however you arrived.
      state.tileOwner[tile] = fleet.ownerIndex;
    }
  } else {
    // Thrown back into the sea. What is left is still cargo, and still subject to the berths.
    fleet.cargo = ashore;
    if (stackSize(held) === 0) removeArmy(state, defender.id);
    else defender.units = held;
    drownExcessCargo(state, fleet, 'in the landing');
  }

  pushEvent(state, {
    kind: 'battle',
    text: won ? 'A landing was forced against a defended shore' : 'A landing was thrown back into the sea',
    tileIndex: tile,
    factionIndex: fleet.ownerIndex,
    battleId: report.id,
  });
  recomputeIncome(state, world);
  return true;
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
