import {
  fleetCapacity,
  shipById,
  transportsIn,
  unitById,
  type UnitStack,
} from '../data/units';
import { inBounds, tileIndex, type World } from '../data/world';
import { armyAt, stackSize } from './armies';
import { pushEvent } from './events';
import { terrainOf } from './movement';
import {
  MAX_ARMY_UNITS,
  MAX_FLEET_SHIPS,
  MAX_FLEET_TRANSPORTS,
  type ArmyState,
  type CityState,
  type FleetState,
  type SimState,
} from './types';

/**
 * Fleets — raising them, loading them, and putting an army back on dry land.
 *
 * The land equivalents are in `armies.ts` and this file is deliberately their mirror: a settlement's
 * `fleet` is its moorings the way `garrison` is its barracks, `launch` is `mobilise`, and `dock` is
 * `standDown`. What is genuinely new is the pair in the middle — **embarking and disembarking** —
 * because that is the only place in the game where one kind of entity turns into another.
 *
 * The rule those two implement is owner-specified: **board and land wherever the ship can reach the
 * shore** (decision 124, widened in 0.18.9). Neither end needs a harbour, a settlement or ownership
 * of the ground — only that the fleet is on one of the eight tiles touching it, and that nobody
 * hostile is standing where the men would come off.
 *
 * Sailing and fighting are not here — they are `sailing.ts`. This file is orders, not motion.
 */

export type FleetFailure =
  | 'not-owner'
  | 'no-such-fleet'
  | 'no-such-army'
  | 'no-settlement'
  | 'nothing-selected'
  | 'not-in-moorings'
  | 'not-in-army'
  | 'fleet-full'
  | 'no-harbour'
  | 'no-sea-room'
  | 'not-alongside'
  | 'no-berths'
  | 'no-cargo'
  | 'blocked'
  | 'sea-occupied'
  | 'too-many-transports';

export type FleetResult = { ok: true; fleetId: number } | { ok: false; reason: FleetFailure };

const fail = (reason: FleetFailure): FleetResult => ({ ok: false, reason });

// ------------------------------------------------------------------- queries

export function fleetAt(state: SimState, tile: number): FleetState | undefined {
  return state.fleets.find((fleet) => fleet.tileIndex === tile);
}

export function fleetById(state: SimState, id: number): FleetState | undefined {
  return state.fleets.find((fleet) => fleet.id === id);
}

export function fleetsOf(state: SimState, factionIndex: number): readonly FleetState[] {
  return state.fleets.filter((fleet) => fleet.ownerIndex === factionIndex);
}

/** A fleet sails at its slowest hull, exactly as an army marches at its slowest unit. */
export function fleetSpeed(fleet: FleetState): number {
  const speeds = Object.keys(fleet.ships)
    .map((id) => shipById(id)?.strategicSpeed ?? 0)
    .filter((speed) => speed > 0);
  return speeds.length === 0 ? 0 : Math.min(...speeds);
}

/** Berths this fleet has, and berths it is using. Only Transports contribute any. */
export function berths(fleet: FleetState): { capacity: number; used: number } {
  return { capacity: fleetCapacity(fleet.ships), used: stackSize(fleet.cargo) };
}

export function isWater(world: World, tile: number): boolean {
  return terrainOf(world, tile) === 'water';
}

/**
 * The **eight** neighbours of a tile — owner-specified in 0.18.3.
 *
 * Armies move orthogonally, because a diagonal would let one cross √2 tiles of ground for the price
 * of one and quietly make every stated marching speed a lie. **Ships do not**, and the reason is not
 * a relaxation of that argument but geography: the sea on this map is a set of basins joined at
 * single tiles, and several of those joins are diagonal.
 *
 * Measured on `europe-1350`: with four-way movement the water is **four separate basins**, and the
 * **Black Sea (58 tiles) cannot reach the Mediterranean (693) at all** — the Bosphorus at
 * Constantinople is a diagonal step. A Black Sea realm could build any navy it liked and never leave
 * home. With eight-way movement the whole thing is one sea of 754 tiles, as it should be.
 *
 * The speed lie is paid for rather than ignored: a diagonal costs `DIAGONAL_PERMILLE` of a tile in
 * `sailing.ts`, so "three tiles a month" stays true in every direction.
 *
 * Used for every naval adjacency, not only movement: which water a harbour can launch into, which
 * fleet is alongside which quay, which beach a fleet can land on, and what a warship can intercept.
 * A ship that can *sail* diagonally can obviously also tie up diagonally.
 */
export function seaNeighbours(world: World, index: number): number[] {
  const x = index % world.width;
  const y = Math.floor(index / world.width);
  const out: number[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      if (inBounds(world, x + dx, y + dy)) out.push(tileIndex(world, x + dx, y + dy));
    }
  }
  return out;
}

/**
 * 1 for a straight neighbour, 2 for a corner — an ordering, not a distance.
 *
 * Only ever used to rank the tiles around a harbour, so the true √2 would be pointless precision;
 * what matters is that a corner sorts after a straight step.
 */
export function stepLength(world: World, from: number, to: number): number {
  const dx = Math.abs((to % world.width) - (from % world.width));
  const dy = Math.abs(Math.floor(to / world.width) - Math.floor(from / world.width));
  return dx + dy;
}

/** Sea tiles beside a settlement — where a fleet has to be to load from it. */
export function seaBeside(world: World, tile: number): number[] {
  return seaNeighbours(world, tile).filter((next) => isWater(world, next));
}

/** A settlement is coastal if a ship can sit next to it. Nothing inland can ever build one. */
export function isCoastal(world: World, tile: number): boolean {
  return seaNeighbours(world, tile).some((next) => isWater(world, next));
}

// ------------------------------------------------------------------ launching

/**
 * Put ships to sea from a settlement's moorings.
 *
 * The naval `mobilise`. The fleet appears on a **water tile beside the settlement**, because a
 * fleet only ever exists on water — there is no such thing as a fleet standing in a city, only
 * hulls in `city.fleet` that have not been launched.
 *
 * **Any of the eight tiles around the harbour, nearest first** — owner-specified in 0.18.3. Nearest
 * means a straight neighbour before a corner, which is the difference between a ship leaving by the
 * river mouth and leaving round the headland. Where two are equally near the lower index wins:
 * arbitrary, but fixed, and fixed is what determinism needs.
 *
 * A fleet already sitting on that tile is reinforced rather than replaced, mirroring how a second
 * muster joins the stack already standing on a city.
 */
export function launch(
  state: SimState,
  world: World,
  city: CityState,
  picks: UnitStack,
): FleetResult {
  const wanted = Object.entries(picks).filter(([, count]) => count > 0);
  if (wanted.length === 0) return fail('nothing-selected');

  for (const [id, count] of wanted) {
    if ((city.fleet[id] ?? 0) < count) return fail('not-in-moorings');
  }

  // Straight neighbours before corners, then by index. A corner is √2 away and a ship launched
  // into one has already sailed further than it needed to.
  const water = seaBeside(world, city.tileIndex).sort(
    (a, b) => stepLength(world, city.tileIndex, a) - stepLength(world, city.tileIndex, b) || a - b,
  );
  const free = water.find((tile) => {
    const standing = fleetAt(state, tile);
    return !standing || standing.ownerIndex === city.ownerIndex;
  });
  if (free === undefined) return water.length === 0 ? fail('no-sea-room') : fail('sea-occupied');

  const existing = fleetAt(state, free);
  const added = wanted.reduce((total, [, count]) => total + count, 0);
  const already = existing ? stackSize(existing.ships) : 0;
  if (already + added > MAX_FLEET_SHIPS) return fail('fleet-full');

  // **Four Transports to a fleet** — owner-specified, and the reason the hold is exactly one army.
  // The surplus stays moored; it becomes a second convoy when there is water to put it on.
  const carriers = transportsIn(picks) + (existing ? transportsIn(existing.ships) : 0);
  if (carriers > MAX_FLEET_TRANSPORTS) return fail('too-many-transports');

  const fleet: FleetState = existing ?? {
    id: state.nextFleetId++,
    ownerIndex: city.ownerIndex,
    tileIndex: free,
    ships: {},
    cargo: {},
    path: [],
    sail: 0,
  };

  for (const [id, count] of wanted) {
    const left = (city.fleet[id] ?? 0) - count;
    if (left > 0) city.fleet[id] = left;
    else delete city.fleet[id];
    fleet.ships[id] = (fleet.ships[id] ?? 0) + count;
  }

  if (!existing) state.fleets.push(fleet);

  const name = world.cities[city.cityIndex]?.name ?? 'a settlement';
  pushEvent(state, {
    kind: 'ship',
    text: `${added} ship${added === 1 ? '' : 's'} put to sea from ${name}`,
    tileIndex: fleet.tileIndex,
    factionIndex: city.ownerIndex,
  });
  return { ok: true, fleetId: fleet.id };
}

/**
 * Bring a fleet back into a friendly harbour it is sitting beside.
 *
 * The naval `standDown`. Anything still aboard is put ashore into the settlement's garrison rather
 * than left floating — a fleet that has docked is not a fleet, so its cargo has to land somewhere,
 * and the harbour it just tied up in is the only honest answer.
 */
export function dock(state: SimState, world: World, fleetId: number): FleetResult {
  const fleet = fleetById(state, fleetId);
  if (!fleet) return fail('no-such-fleet');

  const harbour = seaNeighbours(world, fleet.tileIndex)
    .map((tile) => state.cities.find((city) => city.tileIndex === tile))
    .find((city) => city !== undefined && city.ownerIndex === fleet.ownerIndex);
  if (!harbour) return fail('no-harbour');

  for (const [id, count] of Object.entries(fleet.ships)) {
    harbour.fleet[id] = (harbour.fleet[id] ?? 0) + count;
  }
  for (const [id, count] of Object.entries(fleet.cargo)) {
    harbour.garrison[id] = (harbour.garrison[id] ?? 0) + count;
  }
  removeFleet(state, fleetId);

  const name = world.cities[harbour.cityIndex]?.name ?? 'a settlement';
  pushEvent(state, {
    kind: 'ship',
    text: `A fleet tied up at ${name}`,
    tileIndex: harbour.tileIndex,
    factionIndex: harbour.ownerIndex,
  });
  return { ok: true, fleetId };
}

export function removeFleet(state: SimState, fleetId: number): void {
  const position = state.fleets.findIndex((fleet) => fleet.id === fleetId);
  if (position >= 0) state.fleets.splice(position, 1);
}

/**
 * Fold one fleet into another. One fleet per sea tile, as one army per land tile.
 *
 * **Partial since 0.19.2** — owner-specified: *"enable fleets to merge if they are not mergeable."*
 * It used to be all or nothing: a merge that would breach either cap was refused outright, so a
 * squadron of eight warships meeting a convoy with room for six gave it none of them, and two
 * half-empty convoys that could have made one full one stayed two. The refusal was protecting rules
 * that a **partial** merge does not break at all — the result still never exceeds twenty hulls or
 * four Transports (decisions 122 and 156), because what does not fit simply stays where it was.
 *
 * It fails now only when nothing whatever can move.
 *
 * **Warships move first, then Transports.** The common case is an escort joining a convoy, and it is
 * the case the owner reported broken; filling the hold first would let four Transports take the room
 * the escort needed. Order within each kind is by sorted id, so the same merge always moves the same
 * hulls.
 *
 * **Cargo travels with its hold, or not at all.** If `from` is carrying men, its Transports move only
 * if *all* of them fit — half a hold arriving is half a hold drowning, and `drownExcessCargo` would
 * be the thing that killed them. Where they cannot all move, the warships still transfer and the
 * loaded convoy is left intact, which is the right answer anyway: it is now escorted.
 */
export function mergeFleets(state: SimState, intoId: number, fromId: number): FleetResult {
  const into = fleetById(state, intoId);
  const from = fleetById(state, fromId);
  if (!into || !from) return fail('no-such-fleet');
  if (into.ownerIndex !== from.ownerIndex) return fail('not-owner');

  let hullRoom = MAX_FLEET_SHIPS - stackSize(into.ships);
  let holdRoom = MAX_FLEET_TRANSPORTS - transportsIn(into.ships);
  if (hullRoom <= 0) return fail('fleet-full');

  const carries = (id: string) => (shipById(id)?.carries ?? 0) > 0;
  const ids = Object.keys(from.ships).sort(
    (a, b) => Number(carries(a)) - Number(carries(b)) || a.localeCompare(b),
  );

  // Cargo cannot be split from the hulls under it, so decide up front whether the hold may move.
  const laden = stackSize(from.cargo) > 0;
  const holdMayMove = !laden || transportsIn(from.ships) <= Math.min(holdRoom, hullRoom);

  let moved = 0;
  for (const id of ids) {
    const available = from.ships[id] ?? 0;
    if (available <= 0) continue;

    let room = hullRoom;
    if (carries(id)) {
      if (!holdMayMove) continue;
      room = Math.min(room, holdRoom);
    }

    const take = Math.min(available, room);
    if (take <= 0) continue;

    into.ships[id] = (into.ships[id] ?? 0) + take;
    from.ships[id] = available - take;
    if (from.ships[id] === 0) delete from.ships[id];

    hullRoom -= take;
    if (carries(id)) holdRoom -= take;
    moved += take;
  }

  if (moved === 0) return fail(holdRoom <= 0 ? 'too-many-transports' : 'fleet-full');

  // The men only follow when every hull they were riding in has gone across with them.
  if (holdMayMove && transportsIn(from.ships) === 0) {
    for (const [id, count] of Object.entries(from.cargo)) {
      into.cargo[id] = (into.cargo[id] ?? 0) + count;
    }
    from.cargo = {};
  }

  if (stackSize(from.ships) === 0) removeFleet(state, fromId);
  else drownExcessCargo(state, from, 'in the crossing');

  // Two half-loaded convoys merging can exceed what their Transports between them carry only if
  // one of them was already over — but the check is cheap and the invariant is worth holding.
  drownExcessCargo(state, into, 'in the crossing');
  return { ok: true, fleetId: intoId };
}

// ------------------------------------------------------------ embark and disembark

/**
 * The largest part of a stack that would fit in `room` berths.
 *
 * **Splitting is by unit id, largest formations first**, and it exists because a fleet that could
 * not take a whole army used to take nothing at all — a realm with three transports and a twelve
 * unit stack sat in harbour for a century. Heaviest first because a landing force wants weight: if
 * only half the army crosses, it should be the half that can fight.
 *
 * Order is fixed — by `size` descending, then by id — so the same fleet always loads the same men.
 */
export function fitting(units: UnitStack, room: number): UnitStack {
  const picks: UnitStack = {};
  let left = room;

  const heaviest = Object.keys(units).sort(
    (a, b) => (unitById(b)?.size ?? 0) - (unitById(a)?.size ?? 0) || a.localeCompare(b),
  );
  for (const id of heaviest) {
    if (left <= 0) break;
    const take = Math.min(units[id] ?? 0, left);
    if (take <= 0) continue;
    picks[id] = take;
    left -= take;
  }
  return picks;
}

/**
 * Load an army, or part of one, onto a fleet — **at a Dock, and only at a Dock** (decision 124).
 *
 * Three things have to line up: the army stands in a settlement its realm owns, that settlement has
 * a Dock or better, and the fleet is on a sea tile touching it.
 *
 * `picks` loads **part** of the army, which is how an oversized stack is split across a crossing
 * (docs/DESIGN.md decision 129). Omit it and the whole army goes. Units left behind stay as the
 * army they were, standing where they were, so a second trip — or a second fleet — can take them:
 * this is the one place in the game where a stack can be divided, and it is deliberately confined
 * to the quayside rather than being a general field order.
 *
 * An army loaded in full ceases to exist as an entity. Cargo has no id, no route and no role, and
 * it becomes an army again only when it steps ashore.
 */
export function embark(
  state: SimState,
  world: World,
  fleetId: number,
  armyId: number,
  picks?: UnitStack,
): FleetResult {
  const fleet = fleetById(state, fleetId);
  if (!fleet) return fail('no-such-fleet');

  const army = state.armies.find((a) => a.id === armyId);
  if (!army) return fail('no-such-army');
  if (army.ownerIndex !== fleet.ownerIndex) return fail('not-owner');

  /**
   * **Anywhere the fleet can reach the shore** — owner-specified in 0.18.9, superseding the Dock.
   *
   * Boarding used to need a harbour the realm owned: a settlement with a Dock or better, with the
   * fleet on one of the eight tiles around it. That rule cost more than it bought. It made every
   * expedition a pilgrimage — an army with nothing to do had to walk across a continent to one of a
   * handful of ports before it could be useful — and it was the reason twenty units sat in Cyprus,
   * and the reason a realm's field force queued at three harbours while its coastline went unused.
   *
   * Now the only requirement is the one that was always physically real: **the ship has to be next
   * to the men.** Any land tile touching the fleet will do, settlement or open field, harbour or
   * bare shingle. Landing already worked this way (decision 124's permissive half), so the two ends
   * of a crossing now follow the same rule, which is easier to hold in the head as well as to play.
   *
   * Docks keep their other jobs: they are still what a settlement needs to **build** a ship, and
   * still worth their fishery income.
   */
  if (!seaNeighbours(world, army.tileIndex).includes(fleet.tileIndex)) {
    return fail('not-alongside');
  }

  const taking = picks ?? army.units;
  const boarding = Object.entries(taking).filter(([, count]) => count > 0);
  if (boarding.length === 0) return fail('nothing-selected');
  for (const [id, count] of boarding) {
    if ((army.units[id] ?? 0) < count) return fail('not-in-army');
  }

  const { capacity, used } = berths(fleet);
  const wanted = boarding.reduce((total, [, count]) => total + count, 0);
  if (used + wanted > capacity) return fail('no-berths');

  for (const [id, count] of boarding) {
    fleet.cargo[id] = (fleet.cargo[id] ?? 0) + count;
    const left = (army.units[id] ?? 0) - count;
    if (left > 0) army.units[id] = left;
    else delete army.units[id];
  }

  // An army with nobody left in it is not an army. One with men still ashore stays where it is,
  // keeping its id and its orders, so the rest of it is still a stack that can be commanded.
  const emptied = Object.keys(army.units).length === 0;
  if (emptied) {
    const position = state.armies.findIndex((a) => a.id === armyId);
    if (position >= 0) state.armies.splice(position, 1);
  }

  const here = state.cities.find((c) => c.tileIndex === army.tileIndex);
  const name = here ? (world.cities[here.cityIndex]?.name ?? 'a settlement') : 'the shore';
  pushEvent(state, {
    kind: 'army',
    text: emptied
      ? `An army embarked at ${name}`
      : `${wanted} unit${wanted === 1 ? '' : 's'} embarked at ${name}, the rest left ashore`,
    tileIndex: fleet.tileIndex,
    factionIndex: fleet.ownerIndex,
  });
  return { ok: true, fleetId };
}

/**
 * Why a fleet may not land its cargo on a tile, or `null` if it may.
 *
 * The permissive half of decision 124. The realm does **not** need to own the beach and there does
 * not need to be anything built on it — what it needs is that nobody hostile is standing there.
 * An opposed landing is a thing you do somewhere the enemy is not.
 */
export function landingBlockedBy(
  state: SimState,
  world: World,
  fleet: FleetState,
  tile: number,
): 'water' | 'not-adjacent' | 'hostile-settlement' | 'hostile-army' | 'army-full' | null {
  if (isWater(world, tile)) return 'water';
  if (!seaNeighbours(world, fleet.tileIndex).includes(tile)) return 'not-adjacent';

  const city = state.cities.find((c) => c.tileIndex === tile);
  if (city && city.ownerIndex !== fleet.ownerIndex) return 'hostile-settlement';

  const standing = armyAt(state, tile);
  if (standing) {
    if (standing.ownerIndex !== fleet.ownerIndex) return 'hostile-army';
    if (stackSize(standing.units) + stackSize(fleet.cargo) > MAX_ARMY_UNITS) return 'army-full';
  }
  return null;
}

/** Every beach this fleet could put an army on right now. */
export function landingSites(state: SimState, world: World, fleet: FleetState): number[] {
  if (stackSize(fleet.cargo) === 0) return [];
  return seaNeighbours(world, fleet.tileIndex).filter(
    (tile) => landingBlockedBy(state, world, fleet, tile) === null,
  );
}

/**
 * Put the cargo ashore on an adjacent coastal tile.
 *
 * The landed army **claims the tile it steps onto**, exactly as a march claims ground by presence
 * (decision 21) — which is how a realm gets its first acre on a landmass it has never held. That
 * one line is the whole reason the naval phase changes the map rather than merely adding boats.
 *
 * Landing where a friendly army already stands reinforces it instead of creating a second stack,
 * because one army per tile holds at sea level too.
 */
export function disembark(
  state: SimState,
  world: World,
  fleetId: number,
  tile: number,
): FleetResult {
  const fleet = fleetById(state, fleetId);
  if (!fleet) return fail('no-such-fleet');
  if (stackSize(fleet.cargo) === 0) return fail('no-cargo');

  const blocked = landingBlockedBy(state, world, fleet, tile);
  if (blocked !== null) return fail(blocked === 'army-full' ? 'fleet-full' : 'blocked');

  const existing = armyAt(state, tile);
  const army: ArmyState = existing ?? {
    id: state.nextArmyId++,
    ownerIndex: fleet.ownerIndex,
    tileIndex: tile,
    units: {},
    path: [],
    march: 0,
    role: 'field',
  };

  const landed = stackSize(fleet.cargo);
  for (const [id, count] of Object.entries(fleet.cargo)) {
    army.units[id] = (army.units[id] ?? 0) + count;
  }
  fleet.cargo = {};
  if (!existing) state.armies.push(army);

  // Ground is taken by standing on it. A landing is a march that arrived by sea.
  state.tileOwner[tile] = fleet.ownerIndex;

  pushEvent(state, {
    kind: 'army',
    text: `${landed} unit${landed === 1 ? '' : 's'} landed from the sea`,
    tileIndex: tile,
    factionIndex: fleet.ownerIndex,
  });
  return { ok: true, fleetId };
}

/**
 * Drown whatever the surviving Transports can no longer carry — decision 126.
 *
 * Called after every loss a fleet can suffer: a battle, and desertion. **Cargo is lost with the
 * ship**, so this is not a redistribution, it is a casualty list — the men go into the sea and
 * nothing is written back anywhere.
 *
 * Units are shed in **sorted id order** rather than by any judgement of worth, because the
 * alternative is a rule about which men a captain saves, and nobody has written one. Sorted is
 * arbitrary; more importantly it is identical on every machine and after every reload.
 */
export function drownExcessCargo(state: SimState, fleet: FleetState, how: string): number {
  let over = stackSize(fleet.cargo) - fleetCapacity(fleet.ships);
  if (over <= 0) return 0;

  let drowned = 0;
  for (const id of Object.keys(fleet.cargo).sort()) {
    if (over <= 0) break;
    const held = fleet.cargo[id] ?? 0;
    const lost = Math.min(held, over);
    const left = held - lost;
    if (left > 0) fleet.cargo[id] = left;
    else delete fleet.cargo[id];
    over -= lost;
    drowned += lost;

    pushEvent(state, {
      kind: 'desertion',
      text: `${lost} × ${unitById(id)?.name ?? id} lost with the ships ${how}`,
      tileIndex: fleet.tileIndex,
      factionIndex: fleet.ownerIndex,
    });
  }
  return drowned;
}
