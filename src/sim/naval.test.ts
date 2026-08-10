import { beforeEach, describe, expect, it } from 'vitest';
import { loadFactions } from '../data/factions';
import { loadEurope1350 } from '../data/maps';
import {
  buildableShips,
  canEmbarkFrom,
  fleetCapacity,
  hasWarship,
  loadShips,
  shipById,
  transportsIn,
  unitById,
} from '../data/units';
import { armyAt, mobilise, stackSize } from './armies';
import { TICKS_PER_MONTH } from './calendar';
import { availableManpower, cancelProduction, queueShip, totalUpkeep } from './construction';
import {
  berths,
  disembark,
  dock,
  drownExcessCargo,
  embark,
  fitting,
  fleetAt,
  fleetSpeed,
  isCoastal,
  isWater,
  landingBlockedBy,
  landingSites,
  launch,
  mergeFleets,
  seaNeighbours,
  seaBeside,
  stepLength,
} from './fleets';
import { sailingDistanceFrom, UNREACHABLE, walkingDistanceFrom } from './geography';
import {
  convoysWanted,
  ESCORTS_PER_CONVOY,
  escortsWanted,
  hullsWanted,
  MAX_CONVOYS,
  maxBeaches,
  menacedWater,
  spareLift,
} from './navalAi';
import { manpowerUnderArms } from './manpower';
import { MARCH_PER_TILE } from './movement';
import {
  advanceFleets,
  DIAGONAL_PERMILLE,
  fightAtSea,
  findSeaPath,
  orderSail,
  seaBlockedBy,
  stormBeach,
} from './sailing';
import { deserialise, migrate, serialise, SAVE_VERSION, type SaveFile } from './save';
import { createInitialState } from './state';
import { advanceBy } from './tick';
import {
  MAX_ARMY_UNITS,
  MAX_FLEET_SHIPS,
  MAX_FLEET_TRANSPORTS,
  MILLI,
  type CityState,
  type FleetState,
  type SimState,
} from './types';

const world = loadEurope1350();
const roster = loadFactions();
const FRANKS = roster.findIndex((f) => f.id === 'franks');

let state: SimState;
let port: CityState;

/**
 * A coastal settlement handed to the Franks and given a Dock, and the water beside it.
 *
 * Every test here needs a harbour. The Franks open inland, so one is taken from the map and made
 * theirs — and it is taken from the **real** map rather than from a fabricated pond on purpose:
 * the naval rules are about the shape of Europe, and a synthetic world with tidy square seas would
 * quietly stop testing the thing that matters. `seaBeside` finding two water tiles instead of one
 * is exactly the sort of detail worth keeping under the tests.
 */
beforeEach(() => {
  state = createInitialState(world, roster, 'franks', 4242);
  port = state.cities.find((city) => seaBeside(world, city.tileIndex).length > 0)!;
  port.ownerIndex = FRANKS;
  state.tileOwner[port.tileIndex] = FRANKS;
  port.garrison = {};
  port.fleet = {};
  if (!port.buildings.includes('dock')) port.buildings = [...port.buildings, 'dock'];
});

/** Gold and timber enough that nothing here ever fails for want of the treasury. */
function fund() {
  const faction = state.factions[FRANKS]!;
  faction.stock.gold = 100_000 * MILLI;
  faction.stock.wood = 100_000 * MILLI;
  faction.stock.iron = 100_000 * MILLI;
  faction.stock.stone = 100_000 * MILLI;
}

/** Moor ships and put them to sea, returning the fleet. */
function putToSea(ships: Record<string, number>) {
  port.fleet = { ...ships };
  const result = launch(state, world, port, ships);
  if (!result.ok) throw new Error(`could not launch: ${result.reason}`);
  return state.fleets.find((f) => f.id === result.fleetId)!;
}

describe('a ship is a unit', () => {
  it('carries its crew as its size, so the shared resolver can field it', () => {
    for (const ship of loadShips()) {
      expect(ship.size).toBe(ship.crew);
      // No range means it closes and fights in melee; the rest are the neutral values that make
      // the land damage formula a no-op for ships.
      expect(ship.range).toBe(0);
      expect(ship.accuracy).toBe(1);
      expect(ship.antiCavalry).toBe(1);
      expect(ship.chargeMultiplier).toBe(1);
      expect(ship.class).toBe('naval');
    }
  });

  it('resolves through unitById, which is what let fleets reuse the land helpers', () => {
    expect(unitById('flagship')?.size).toBe(200);
    expect(unitById('transport')?.upkeep).toBe(10);
    // And a ship never leaks into anything that offers the player troops to recruit.
    expect(unitById('light_infantry')?.class).toBe('infantry');
  });

  it('keeps the owner-authored costs and build times untouched', () => {
    expect(shipById('transport')?.cost).toMatchObject({ gold: 50, wood: 50 });
    expect(shipById('flagship')?.months).toBe(18);
    expect(shipById('heavy_ship')?.requiresBuilding).toBe('port');
  });

  it('gives berths to transports and nothing else', () => {
    expect(shipById('transport')?.carries).toBe(5);
    for (const ship of loadShips().filter((s) => s.id !== 'transport')) {
      expect(ship.carries).toBe(0);
    }
    // Owner-specified: four Transports carry a whole army, so a full stack crosses in one convoy.
    expect(fleetCapacity({ transport: 4 })).toBe(MAX_ARMY_UNITS);
    expect(fleetCapacity({ light_ship: 5 })).toBe(0);
  });

  it('sails every hull at the same three tiles a month', () => {
    for (const ship of loadShips()) expect(ship.strategicSpeed).toBe(300);
  });

  it('counts anything that carries nothing as a warship, so convoys pass each other', () => {
    expect(hasWarship({ light_ship: 1 })).toBe(true);
    expect(hasWarship({ flagship: 1, transport: 4 })).toBe(true);
    expect(hasWarship({ transport: 9 })).toBe(false);
    expect(hasWarship({})).toBe(false);
  });

  it('unlocks up the building chain, and a Dock is the lowest that can load an army', () => {
    expect(buildableShips(['dock']).map((s) => s.id)).toEqual(['transport', 'light_ship']);
    expect(buildableShips(['shipyard']).length).toBe(4);
    expect(buildableShips(['fishery']).length).toBe(0);

    expect(canEmbarkFrom(['dock'])).toBe(true);
    expect(canEmbarkFrom(['shipyard'])).toBe(true);
    // A fishery is a boat and a jetty, not a harbour.
    expect(canEmbarkFrom(['fishery'])).toBe(false);
  });
});

describe('launching and docking', () => {
  it('puts a fleet on the water beside the harbour, not on the harbour', () => {
    const fleet = putToSea({ transport: 2 });
    expect(isWater(world, fleet.tileIndex)).toBe(true);
    expect(seaNeighbours(world, port.tileIndex)).toContain(fleet.tileIndex);
    expect(port.fleet).toEqual({});
  });

  it('refuses to launch what is not moored there', () => {
    port.fleet = { transport: 1 };
    expect(launch(state, world, port, { transport: 3 })).toEqual({
      ok: false,
      reason: 'not-in-moorings',
    });
  });

  it('reinforces the fleet already alongside rather than founding a second', () => {
    const first = putToSea({ transport: 1 });
    port.fleet = { light_ship: 1 };
    launch(state, world, port, { light_ship: 1 });

    expect(state.fleets).toHaveLength(1);
    expect(state.fleets[0]?.id).toBe(first.id);
    expect(state.fleets[0]?.ships).toEqual({ transport: 1, light_ship: 1 });
  });

  it('sends the ships back to the moorings and the cargo ashore when it docks', () => {
    const fleet = putToSea({ transport: 2 });
    port.garrison = { light_infantry: 2 };
    const army = mobilise(state, world, port, { light_infantry: 2 });
    expect(army.ok).toBe(true);
    embark(state, world, fleet.id, (army as { armyId: number }).armyId);

    expect(dock(state, world, fleet.id).ok).toBe(true);
    expect(state.fleets).toHaveLength(0);
    expect(port.fleet).toEqual({ transport: 2 });
    // A docked fleet is not a fleet, so what it was carrying has to land somewhere.
    expect(port.garrison).toEqual({ light_infantry: 2 });
  });
});

describe('embarking and disembarking — wherever the ship can reach the shore', () => {
  it('loads an army standing in a harbour beside the fleet', () => {
    const fleet = putToSea({ transport: 2 });
    port.garrison = { light_infantry: 3 };
    const raised = mobilise(state, world, port, { light_infantry: 3 });
    const armyId = (raised as { armyId: number }).armyId;

    expect(embark(state, world, fleet.id, armyId).ok).toBe(true);
    expect(fleet.cargo).toEqual({ light_infantry: 3 });
    // The army stops existing as an entity the moment all of it is aboard.
    expect(state.armies.find((a) => a.id === armyId)).toBeUndefined();
    expect(berths(fleet)).toEqual({ capacity: 10, used: 3 });
  });

  /**
   * **Rewritten in 0.18.9**, where the owner dropped the harbour requirement: an army boards
   * wherever the ship can reach the shore. This used to assert the opposite.
   */
  it('loads without a harbour — a Dock is for building ships, not for boarding them', () => {
    port.buildings = port.buildings.filter((b) => b !== 'dock');
    port.buildings = [...port.buildings, 'fishery'];
    const fleet = putToSea({ transport: 2 });
    port.garrison = { light_infantry: 1 };
    const raised = mobilise(state, world, port, { light_infantry: 1 });

    expect(embark(state, world, fleet.id, (raised as { armyId: number }).armyId).ok).toBe(true);
    expect(fleet.cargo).toEqual({ light_infantry: 1 });
  });

  it('loads from open shore with no settlement at all', () => {
    const fleet = putToSea({ transport: 2 });
    // A bare coastal tile beside the fleet — no city, no buildings, nothing but beach.
    const beach = seaNeighbours(world, fleet.tileIndex).find(
      (tile) => !isWater(world, tile) && !state.cities.some((c) => c.tileIndex === tile),
    );
    if (beach === undefined) return;

    state.armies.push({
      id: state.nextArmyId++,
      ownerIndex: FRANKS,
      tileIndex: beach,
      units: { light_infantry: 2 },
      path: [],
      march: 0,
      role: 'field',
    });
    const armyId = state.nextArmyId - 1;

    expect(embark(state, world, fleet.id, armyId).ok).toBe(true);
    expect(fleet.cargo).toEqual({ light_infantry: 2 });
  });

  it('still refuses when the fleet is not touching the men', () => {
    const fleet = putToSea({ transport: 2 });
    port.garrison = { light_infantry: 1 };
    const raised = mobilise(state, world, port, { light_infantry: 1 });
    // Shove the fleet somewhere else on the map entirely.
    const far = state.tileOwner.length - 1;
    fleet.tileIndex = isWater(world, far) ? far : fleet.tileIndex;
    if (fleet.tileIndex !== far) return;

    expect(embark(state, world, fleet.id, (raised as { armyId: number }).armyId)).toEqual({
      ok: false,
      reason: 'not-alongside',
    });
  });

  it('refuses to load more units than there are berths', () => {
    const fleet = putToSea({ transport: 1 });
    port.garrison = { light_infantry: 8 };
    const raised = mobilise(state, world, port, { light_infantry: 8 });

    expect(embark(state, world, fleet.id, (raised as { armyId: number }).armyId)).toEqual({
      ok: false,
      reason: 'no-berths',
    });
  });

  it('splits a stack across the berths it has, leaving the rest ashore', () => {
    const fleet = putToSea({ transport: 1 });
    port.garrison = { light_infantry: 8 };
    const raised = mobilise(state, world, port, { light_infantry: 8 });
    const armyId = (raised as { armyId: number }).armyId;

    const room = berths(fleet).capacity - berths(fleet).used;
    expect(embark(state, world, fleet.id, armyId, fitting({ light_infantry: 8 }, room)).ok).toBe(
      true,
    );

    // Five aboard, three still standing in the port as the army they were — same id, same tile.
    expect(fleet.cargo).toEqual({ light_infantry: 5 });
    const ashore = state.armies.find((a) => a.id === armyId);
    expect(ashore?.units).toEqual({ light_infantry: 3 });
    expect(ashore?.tileIndex).toBe(port.tileIndex);
  });

  it('takes the heaviest formations first when it splits', () => {
    // Heaviest by men per unit: light_infantry 100, archer 60, heavy_cavalry 40.
    expect(fitting({ heavy_cavalry: 2, light_infantry: 2, archer: 2 }, 3)).toEqual({
      light_infantry: 2,
      archer: 1,
    });
    // Everything fits, so everything goes.
    expect(fitting({ archer: 2 }, 9)).toEqual({ archer: 2 });
    expect(fitting({ archer: 2 }, 0)).toEqual({});
  });

  it('refuses to board men the army does not have', () => {
    const fleet = putToSea({ transport: 1 });
    port.garrison = { light_infantry: 1 };
    const raised = mobilise(state, world, port, { light_infantry: 1 });

    expect(
      embark(state, world, fleet.id, (raised as { armyId: number }).armyId, { archer: 1 }),
    ).toEqual({ ok: false, reason: 'not-in-army' });
  });

  it('lands on a coast the realm does not own, and claims it by standing on it', () => {
    const fleet = putToSea({ transport: 2 });
    fleet.cargo = { light_infantry: 2 };

    const beach = landingSites(state, world, fleet)[0]!;
    // The permissive half of the rule: not the realm's ground, and nothing built on it.
    const rival = roster.findIndex((f) => f.id !== 'franks');
    state.tileOwner[beach] = rival;

    expect(disembark(state, world, fleet.id, beach).ok).toBe(true);
    expect(fleet.cargo).toEqual({});
    expect(armyAt(state, beach)?.units).toEqual({ light_infantry: 2 });
    // Ground is taken by standing on it — a landing is a march that arrived by sea.
    expect(state.tileOwner[beach]).toBe(FRANKS);
  });

  it('will not land on top of a settlement it does not hold', () => {
    const foreign = state.cities.find(
      (city) => city.ownerIndex !== FRANKS && isCoastal(world, city.tileIndex),
    )!;
    const water = seaBeside(world, foreign.tileIndex)[0]!;
    const fleet = putToSea({ transport: 1 });
    fleet.tileIndex = water;
    fleet.cargo = { light_infantry: 1 };

    expect(landingBlockedBy(state, world, fleet, foreign.tileIndex)).toBe('hostile-settlement');
    expect(disembark(state, world, fleet.id, foreign.tileIndex)).toEqual({
      ok: false,
      reason: 'blocked',
    });
  });

  it('will not land on open water, or on a coast it is not beside', () => {
    const fleet = putToSea({ transport: 1 });
    fleet.cargo = { light_infantry: 1 };
    expect(landingBlockedBy(state, world, fleet, fleet.tileIndex)).toBe('water');
    expect(landingBlockedBy(state, world, fleet, port.tileIndex === fleet.tileIndex ? 0 : 0)).not.toBe(
      null,
    );
  });

  it('reinforces a friendly army already ashore rather than founding a second stack', () => {
    const fleet = putToSea({ transport: 2 });
    fleet.cargo = { light_infantry: 2 };
    const beach = landingSites(state, world, fleet)[0]!;

    state.armies.push({
      id: state.nextArmyId++,
      ownerIndex: FRANKS,
      tileIndex: beach,
      units: { light_infantry: 1 },
      path: [],
      march: 0,
      role: 'field',
    });

    expect(disembark(state, world, fleet.id, beach).ok).toBe(true);
    expect(state.armies.filter((a) => a.tileIndex === beach)).toHaveLength(1);
    expect(armyAt(state, beach)?.units).toEqual({ light_infantry: 3 });
  });
});

describe('sailing', () => {
  it('routes over water and never over land', () => {
    const fleet = putToSea({ light_ship: 1 });
    const seas = sailingDistanceFrom(world, [fleet.tileIndex]);

    // Somewhere genuinely far, so the route is not one step.
    let far = -1;
    let best = 0;
    for (let index = 0; index < seas.length; index++) {
      const d = seas[index] ?? UNREACHABLE;
      if (d !== UNREACHABLE && d > best) {
        best = d;
        far = index;
      }
    }
    expect(far).toBeGreaterThanOrEqual(0);

    const route = findSeaPath(state, world, fleet, far);
    expect(route).not.toBeNull();
    for (const step of route!) expect(isWater(world, step)).toBe(true);
    expect(route![route!.length - 1]).toBe(far);
  });

  it('has no route to a land tile at all', () => {
    const fleet = putToSea({ light_ship: 1 });
    expect(findSeaPath(state, world, fleet, port.tileIndex)).toBeNull();
    expect(seaBlockedBy(state, world, fleet, port.tileIndex)).toBe('land');
  });

  it('sails at its slowest hull — which, at one speed for the whole roster, is any of them', () => {
    const fleet = putToSea({ light_ship: 1, flagship: 1 });
    expect(findSeaPath(state, world, fleet, fleet.tileIndex)).toEqual([]);

    // Owner-specified: every hull makes three tiles a month, so an escort never slows a convoy.
    expect(fleetSpeed(fleet)).toBe(300);
    expect(fleetSpeed(putToSea({ transport: 1 }))).toBe(300);
  });

  it('crosses open water far faster than an army crosses land', () => {
    const fleet = putToSea({ transport: 1 });
    const seas = sailingDistanceFrom(world, [fleet.tileIndex]);
    const destination = [...seas].findIndex((d) => d === 3);
    expect(destination).toBeGreaterThanOrEqual(0);

    orderSail(state, world, fleet.id, destination);
    expect(fleet.path).toHaveLength(3);

    // A Transport makes 3 tiles a month in fair weather and 1.8 in winter, so three months is
    // ample whatever season the campaign opens in. An army on foot would still be on its first
    // tile: three tiles of hostile ground is more than four years' marching.
    advanceBy(state, world, TICKS_PER_MONTH * 3);
    expect(fleet.path).toHaveLength(0);
    expect(fleet.tileIndex).toBe(destination);
  });

  it('costs one tile of march points per sea tile — no terrain, no owner', () => {
    // Open water has no cost multipliers at all, which is what makes the sea sweep exact rather
    // than a lower bound. Asserted as a property of the constant the sailing loop spends.
    expect(MARCH_PER_TILE).toBe(TICKS_PER_MONTH * 100 * 100);
  });
});

describe('battle at sea', () => {
  /**
   * Two hostile fleets, with the enemy **sailing into** the tile beside ours.
   *
   * The enemy is placed a tile further out and given exactly one tile's worth of banked points, so
   * a single `advanceFleets` walks it into contact. That is the shape a real interception has —
   * something moving is caught — and rigging it any other way would test a case the rule
   * deliberately excludes.
   */
  function opposingFleets(mine: Record<string, number>, theirs: Record<string, number>) {
    const ours = putToSea(mine);
    const beside = seaNeighbours(world, ours.tileIndex).find(
      (tile) => isWater(world, tile) && !fleetAt(state, tile),
    )!;
    const beyond = seaNeighbours(world, beside).find(
      (tile) => isWater(world, tile) && tile !== ours.tileIndex && !fleetAt(state, tile),
    )!;

    const enemy = {
      id: state.nextFleetId++,
      ownerIndex: FRANKS === 0 ? 1 : 0,
      tileIndex: beyond,
      ships: { ...theirs },
      cargo: {} as Record<string, number>,
      path: [beside],
      sail: MARCH_PER_TILE,
    };
    state.fleets.push(enemy);
    return { ours, enemy, beside };
  }

  it('a warship intercepts within one tile, without either fleet moving onto the other', () => {
    const { ours, enemy, beside } = opposingFleets({ flagship: 1 }, { transport: 1 });

    advanceFleets(state, world);

    // The convoy is gone, and the Flagship caught it without leaving its own tile.
    expect(state.fleets.find((f) => f.id === enemy.id)).toBeUndefined();
    expect(state.fleets.find((f) => f.id === ours.id)?.tileIndex).toBe(ours.tileIndex);
    expect(ours.tileIndex).not.toBe(beside);
    expect(state.battles).toHaveLength(1);
  });

  it('lets two unescorted convoys pass each other untouched', () => {
    const { ours, enemy } = opposingFleets({ transport: 2 }, { transport: 2 });
    advanceFleets(state, world);

    expect(state.fleets.find((f) => f.id === ours.id)).toBeDefined();
    expect(state.fleets.find((f) => f.id === enemy.id)).toBeDefined();
    expect(state.battles).toHaveLength(0);
  });

  /**
   * **Rewritten in 0.18.6.** This test used to assert the opposite — that a stationary pair never
   * fights — which was the movement clause working as designed and was reported from play as a bug:
   * four Byzantine flagships and eight Turkish ones sat adjacent in open water for ever. The
   * throttle is now the month rather than movement.
   */
  it('re-fights a standoff once a month, and not once a tick', () => {
    const { ours, enemy } = opposingFleets({ flagship: 1 }, { flagship: 1 });
    enemy.tileIndex = seaNeighbours(world, ours.tileIndex).find(
      (tile) => isWater(world, tile) && tile !== ours.tileIndex,
    )!;
    enemy.path = [];
    enemy.sail = 0;

    // Mid-month, both lying to: nothing happens, or the pair would grind each other down 120
    // times a month and burn the RNG doing it.
    state.tick = TICKS_PER_MONTH + 3;
    advanceFleets(state, world);
    advanceFleets(state, world);
    expect(state.battles).toHaveLength(0);

    // The month turns and they engage.
    state.tick = TICKS_PER_MONTH * 2;
    advanceFleets(state, world);
    expect(state.battles.length).toBeGreaterThan(0);
  });

  it('drowns the army aboard when the transports carrying it go down', () => {
    const { ours, enemy } = opposingFleets({ transport: 1 }, { flagship: 2 });
    ours.cargo = { heavy_cavalry: 2 };

    advanceFleets(state, world);

    // The transport is sunk, and the cargo went with it — not evacuated, not washed ashore.
    expect(state.fleets.find((f) => f.id === ours.id)).toBeUndefined();
    expect(state.armies.some((a) => a.ownerIndex === FRANKS && a.units.heavy_cavalry)).toBe(false);
    expect(state.fleets.find((f) => f.id === enemy.id)).toBeDefined();
  });

  it('drowns exactly the cargo the surviving transports can no longer carry', () => {
    const fleet = putToSea({ transport: 3 });
    fleet.cargo = { light_infantry: 6, archer: 6 };
    expect(berths(fleet)).toEqual({ capacity: 15, used: 12 });

    // Two hulls lost: ten berths gone, so seven of the twelve aboard drown.
    fleet.ships = { transport: 1 };
    const drowned = drownExcessCargo(state, fleet, 'in the fighting');

    expect(drowned).toBe(7);
    expect(stackSize(fleet.cargo)).toBe(5);
    expect(fleetCapacity(fleet.ships)).toBe(5);
  });

  it('uses the shipped auto-resolve — a sea battle is recorded like any other', () => {
    const { ours, enemy } = opposingFleets({ flagship: 1 }, { light_ship: 1 });
    fightAtSea(state, world, ours, enemy, ours.tileIndex);

    expect(state.battles).toHaveLength(1);
    const report = state.battles[0]!;
    expect(report.cityIndex).toBe(-1);
    // No ground at sea: terrain, settlement and fortification all contribute nothing.
    expect(report.advantage.terrain).toBe(0);
    expect(report.advantage.settlement).toBe(0);
    expect(report.advantage.fortification).toBe(0);
  });
});

describe('crews are men', () => {
  it('counts moored ships, ships at sea, hulls on the slipway and cargo alike', () => {
    const before = manpowerUnderArms(state, FRANKS);

    port.fleet = { flagship: 1 };
    expect(manpowerUnderArms(state, FRANKS)).toBe(before + 200);

    const fleet = putToSea({ flagship: 1 });
    expect(manpowerUnderArms(state, FRANKS)).toBe(before + 200);

    fleet.cargo = { light_infantry: 1 };
    expect(manpowerUnderArms(state, FRANKS)).toBe(before + 200 + 100);
  });

  it('levies the crew off the settlement and against the ceiling when a keel is laid', () => {
    port.population = 20_000;
    fund();
    const people = port.population;
    const before = manpowerUnderArms(state, FRANKS);

    expect(queueShip(state, port, 'transport').ok).toBe(true);

    expect(port.population).toBe(people - 40);
    expect(manpowerUnderArms(state, FRANKS)).toBe(before + 40);
    expect(port.shipQueue).toHaveLength(1);
  });

  it('refuses a hull only when the port itself has run out of people', () => {
    // **Rewritten in 0.19.0.** This used to assert that a realm at its manpower ceiling could not
    // crew another hull. There is no ceiling (decision 165), so the assertion is now the one that
    // survived it: a harbour can lay down keels until its own population hits the floor, and the
    // refusal that stops it is local.
    port.population = 1_000;
    fund();

    // A Transport is 40 crew and the floor is 100, so nine hulls empty the town and the tenth
    // cannot be manned. Nothing about the rest of the realm enters into it.
    for (let i = 0; i < 22; i++) {
      const result = queueShip(state, port, 'transport');
      if (!result.ok) {
        expect(result).toEqual({ ok: false, reason: 'too-few-people' });
        break;
      }
    }

    expect(availableManpower(port)).toBeLessThan(40);
    expect(queueShip(state, port, 'transport')).toEqual({
      ok: false,
      reason: 'too-few-people',
    });
  });

  it('gives the crew back when a hull on the slipway is cancelled', () => {
    port.population = 20_000;
    port.buildings = [...port.buildings, 'shipyard'];
    fund();
    const people = port.population;
    expect(queueShip(state, port, 'flagship').ok).toBe(true);
    expect(port.population).toBe(people - 200);

    // Cancelling wastes the months, not the people — the same bargain the treasury gets.
    cancelProduction(state, port, 'ship', 0);
    expect(port.population).toBe(people);
  });

  it('charges upkeep for ships at sea as well as ships in harbour', () => {
    port.fleet = { transport: 1 };
    const moored = totalUpkeep(state, FRANKS);
    putToSea({ transport: 1 });
    expect(totalUpkeep(state, FRANKS)).toBe(moored);
  });
});

describe('fleets desert in debt', () => {
  it('loses ships, and the cargo with the last of them', () => {
    const faction = state.factions[FRANKS]!;
    const fleet = putToSea({ transport: 4 });
    fleet.cargo = { light_infantry: 4 };

    // Deep enough in the red that the roll runs, over enough months that it bites.
    faction.stock.gold = -50_000 * MILLI;
    faction.monthlyIncome.gold = 0;
    advanceBy(state, world, TICKS_PER_MONTH * 24);

    const left = state.fleets.find((f) => f.id === fleet.id);
    const hulls = left ? stackSize(left.ships) : 0;
    expect(hulls).toBeLessThan(4);
    // Whatever survives, the cargo never exceeds what the surviving transports can carry.
    if (left) expect(stackSize(left.cargo)).toBeLessThanOrEqual(fleetCapacity(left.ships));
  });

  it('leaves the navy of a solvent realm alone', () => {
    const fleet = putToSea({ transport: 3 });
    state.factions[FRANKS]!.stock.gold = 100_000 * MILLI;
    advanceBy(state, world, TICKS_PER_MONTH * 12);

    expect(state.fleets.find((f) => f.id === fleet.id)?.ships).toEqual({ transport: 3 });
  });
});

describe('saves', () => {
  it('round-trips a loaded fleet exactly', () => {
    const fleet = putToSea({ transport: 2, light_ship: 1 });
    fleet.cargo = { light_infantry: 2, archer: 1 };
    fleet.path = [fleet.tileIndex];
    fleet.sail = 12_345;

    const back = deserialise(serialise(state));
    expect(back.fleets).toEqual(state.fleets);
    expect(back.nextFleetId).toBe(state.nextFleetId);
  });

  it('opens a v8 campaign with empty seas and its moored ships intact', () => {
    port.fleet = { transport: 2 };
    const serialised = serialise(state) as unknown as Record<string, unknown>;
    delete serialised.fleets;
    delete serialised.nextFleetId;

    const file = {
      id: 'x',
      name: 'x',
      kind: 'manual',
      version: 8,
      tick: state.tick,
      factionId: 'franks',
      mapId: 'europe-1350',
      savedAt: 0,
      state: serialised,
    } as unknown as SaveFile;

    const migrated = migrate(file);
    expect(migrated.version).toBe(SAVE_VERSION);
    expect(migrated.state.fleets).toEqual([]);
    expect(migrated.state.nextFleetId).toBe(1);
    // The hulls a v8 realm built were always in `city.fleet`; nothing is lost.
    const harbour = migrated.state.cities.find((c) => c.tileIndex === port.tileIndex)!;
    expect(harbour.fleet).toEqual({ transport: 2 });
  });
});

describe('determinism', () => {
  it('runs a naval campaign byte-identically from the same seed', () => {
    const run = () => {
      const s = createInitialState(world, roster, 'franks', 909);
      const harbour = s.cities.find(
        (city) => city.ownerIndex === FRANKS && isCoastal(world, city.tileIndex),
      );
      if (harbour) {
        harbour.buildings = [...harbour.buildings, 'dock'];
        harbour.fleet = { transport: 2, light_ship: 1 };
        launch(s, world, harbour, { transport: 2, light_ship: 1 });
      }
      advanceBy(s, world, TICKS_PER_MONTH * 36);
      return JSON.stringify(serialise(s));
    };
    expect(run()).toBe(run());
  });

  it('carries on identically across a save and reload mid-voyage', () => {
    const fleet = putToSea({ transport: 2 });
    const seas = sailingDistanceFrom(world, [fleet.tileIndex]);
    const destination = [...seas].findIndex((d) => d === 5);
    if (destination >= 0) orderSail(state, world, fleet.id, destination);

    advanceBy(state, world, TICKS_PER_MONTH);
    const reloaded = deserialise(serialise(state));

    advanceBy(state, world, TICKS_PER_MONTH * 6);
    advanceBy(reloaded, world, TICKS_PER_MONTH * 6);
    expect(JSON.stringify(serialise(reloaded))).toBe(JSON.stringify(serialise(state)));
  });
});

describe('the fleet cap', () => {
  it('holds the same twenty an army does', () => {
    expect(MAX_FLEET_SHIPS).toBe(20);
    port.fleet = { transport: 21 };
    expect(launch(state, world, port, { transport: 21 })).toEqual({
      ok: false,
      reason: 'fleet-full',
    });
  });
});

/**
 * Eight-way sea movement — owner-specified in 0.18.3.
 *
 * Armies still move in four directions. Ships do not, and the reason is geography rather than a
 * change of heart about diagonals: this map's water is a set of basins joined at single tiles, and
 * several of those joins are diagonal.
 */
describe('ships sail in eight directions', () => {
  /** Flood-fill the water and return how many separate basins there are. */
  const basins = (diagonal: boolean) => {
    const size = world.width * world.height;
    const seen = new Uint8Array(size);
    const steps = diagonal
      ? [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]]
      : [[0, -1], [1, 0], [0, 1], [-1, 0]];

    const sizes: number[] = [];
    for (let start = 0; start < size; start++) {
      if (seen[start] || !isWater(world, start)) continue;
      seen[start] = 1;
      const queue = [start];
      let count = 0;
      for (let head = 0; head < queue.length; head++) {
        const index = queue[head]!;
        count += 1;
        const x = index % world.width;
        const y = Math.floor(index / world.width);
        for (const step of steps) {
          const nx = x + (step[0] ?? 0);
          const ny = y + (step[1] ?? 0);
          if (nx < 0 || ny < 0 || nx >= world.width || ny >= world.height) continue;
          const next = ny * world.width + nx;
          if (seen[next] || !isWater(world, next)) continue;
          seen[next] = 1;
          queue.push(next);
        }
      }
      sizes.push(count);
    }
    return sizes.sort((a, b) => b - a);
  };

  it('joins the Black Sea to the Mediterranean, which four-way movement never could', () => {
    // The Bosphorus at Constantinople is a diagonal step. Without diagonals the Black Sea is its
    // own basin and a realm on it can build any navy it likes and never leave home.
    const four = basins(false);
    const eight = basins(true);

    expect(four.length).toBeGreaterThan(eight.length);
    // Four-way leaves a large sea and a separate, much smaller one; eight-way merges them.
    expect(four[0]).toBeLessThan(eight[0]!);
    expect(eight[0]).toBeGreaterThan(700);
  });

  it('reaches every neighbour of a sea tile, corners included', () => {
    const fleet = putToSea({ transport: 1 });
    const around = seaNeighbours(world, fleet.tileIndex).filter((t) => isWater(world, t));
    expect(around.length).toBeGreaterThan(0);

    for (const tile of around) {
      // One step each, whether straight or diagonal.
      expect(findSeaPath(state, world, fleet, tile)).toEqual([tile]);
    }
  });

  it('charges a diagonal what a diagonal costs, so the stated speed stays honest', () => {
    // √2 to three places. Without this, a fleet crossing corners would cover 4.2 tiles a month
    // while the roster claims 3 — the exact reason armies have no diagonals at all.
    expect(DIAGONAL_PERMILLE).toBe(1414);
    expect(Math.floor((MARCH_PER_TILE * DIAGONAL_PERMILLE) / 1000)).toBe(1_696_800);
  });
});

describe('a harbour launches into the nearest water', () => {
  it('prefers a straight neighbour to a corner', () => {
    const water = seaBeside(world, port.tileIndex);
    const straight = water.filter((t) => stepLength(world, port.tileIndex, t) === 1);
    const fleet = putToSea({ transport: 1 });

    // Where the harbour has both, the ship leaves by the straight one.
    if (straight.length > 0) expect(straight).toContain(fleet.tileIndex);
    else expect(water).toContain(fleet.tileIndex);
  });
});

/**
 * The owner asked directly whether armies assault cities straight off the boats. They cannot, and
 * this is the rule that stops them: a settlement someone else holds is not a landing site at all.
 */
describe('a landing finds a beach, never a city', () => {
  it('refuses to put men ashore onto a hostile settlement', () => {
    const fleet = putToSea({ transport: 2 });
    fleet.cargo = { light_infantry: 2 };

    // A settlement beside the fleet that belongs to somebody else.
    const neighbour = seaNeighbours(world, fleet.tileIndex)
      .map((tile) => state.cities.find((c) => c.tileIndex === tile))
      .find((c) => c !== undefined);
    if (!neighbour) return;
    neighbour.ownerIndex = FRANKS === 0 ? 1 : 0;

    expect(landingBlockedBy(state, world, fleet, neighbour.tileIndex)).toBe('hostile-settlement');
    expect(landingSites(state, world, fleet)).not.toContain(neighbour.tileIndex);
    expect(disembark(state, world, fleet.id, neighbour.tileIndex)).toEqual({
      ok: false,
      reason: 'blocked',
    });
    // The men are still aboard — nothing was quietly thrown at the walls.
    expect(fleet.cargo).toEqual({ light_infantry: 2 });
  });
});

/**
 * Storming a defended beach — owner-specified in 0.18.5.
 *
 * "The ships carrying troops should be able to fight vs troops on the land if there is no landing
 * zone empty, as if it is attacking the army from the ground." A last resort: an empty beach is
 * always preferred, and a settlement is still never a landing site at all.
 */
describe('a landing can be forced', () => {
  const rival = FRANKS === 0 ? 1 : 0;

  /** A fleet with cargo, and the coast beside it. */
  const loaded = () => {
    const fleet = putToSea({ transport: 2 });
    fleet.cargo = { light_infantry: 4 };
    const beach = seaNeighbours(world, fleet.tileIndex).find(
      (tile) => !isWater(world, tile) && !state.cities.some((c) => c.tileIndex === tile),
    );
    return { fleet, beach };
  };

  it('fights the army holding the shore rather than circling for ever', () => {
    const { fleet, beach } = loaded();
    if (beach === undefined) return;

    state.armies.push({
      id: state.nextArmyId++,
      ownerIndex: rival,
      tileIndex: beach,
      units: { light_infantry: 1 },
      path: [],
      march: 0,
      role: 'field',
    });
    // Blocked as a landing site, which is what makes this necessary.
    expect(landingBlockedBy(state, world, fleet, beach)).toBe('hostile-army');

    const battles = state.nextBattleId;
    expect(stormBeach(state, world, fleet, beach)).toBe(true);
    expect(state.nextBattleId).toBeGreaterThan(battles);

    // Four Light Infantry against one, on open ground: the landing carries and takes the tile.
    expect(armyAt(state, beach)?.ownerIndex).toBe(FRANKS);
    expect(state.tileOwner[beach]).toBe(FRANKS);
    expect(stackSize(fleet.cargo)).toBe(0);
  });

  it('never storms a settlement — that rule survives this one', () => {
    const fleet = putToSea({ transport: 2 });
    fleet.cargo = { light_infantry: 4 };

    const city = seaNeighbours(world, fleet.tileIndex)
      .map((tile) => state.cities.find((c) => c.tileIndex === tile))
      .find((c) => c !== undefined);
    if (!city) return;
    city.ownerIndex = rival;

    expect(stormBeach(state, world, fleet, city.tileIndex)).toBe(false);
    expect(stackSize(fleet.cargo)).toBe(4);
  });

  it('does nothing where the shore is empty or friendly', () => {
    const { fleet, beach } = loaded();
    if (beach === undefined) return;
    // No defender: this is an ordinary landing, and `disembark` handles it.
    expect(stormBeach(state, world, fleet, beach)).toBe(false);
    expect(stackSize(fleet.cargo)).toBe(4);
  });
});

/**
 * Two fleets in contact fight — owner-reported in 0.18.6.
 *
 * Interception used to require that one of the pair had **moved that tick**, to stop two survivors
 * of a stalemate re-fighting a hundred and twenty times a month. It made a standoff permanent
 * instead: the owner watched four Byzantine flagships and eight Turkish ones sit adjacent in open
 * water and never fight, neither able to force the issue and neither willing to break off.
 */
describe('fleets in contact do not stare at each other', () => {
  const rival = FRANKS === 0 ? 1 : 0;

  /** Two hostile fleets, adjacent, both stationary. */
  const standoff = () => {
    const ours = putToSea({ flagship: 2 });
    const beside = seaNeighbours(world, ours.tileIndex).find(
      (tile) => isWater(world, tile) && !fleetAt(state, tile),
    );
    if (beside === undefined) return undefined;

    state.fleets.push({
      id: state.nextFleetId++,
      ownerIndex: rival,
      tileIndex: beside,
      ships: { flagship: 1 },
      cargo: {},
      path: [],
      sail: 0,
    });
    return ours;
  };

  it('fights when the month turns, though neither has moved', () => {
    const ours = standoff();
    if (!ours) return;

    const battles = state.nextBattleId;
    // Land on a month boundary with nothing under way: the old rule made this a no-op for ever.
    state.tick = TICKS_PER_MONTH - 1;
    advanceFleets(state, world);
    state.tick = TICKS_PER_MONTH;
    advanceFleets(state, world);

    expect(state.nextBattleId).toBeGreaterThan(battles);
  });

  it('does not re-fight every tick inside the month', () => {
    const ours = standoff();
    if (!ours) return;

    state.tick = TICKS_PER_MONTH + 1;
    const battles = state.nextBattleId;
    for (let i = 0; i < 20; i++) {
      state.tick += 1;
      if (state.tick % TICKS_PER_MONTH === 0) state.tick += 1;
      advanceFleets(state, world);
    }
    // Stationary, mid-month: the throttle holds and the RNG is not burned a tick at a time.
    expect(state.nextBattleId).toBe(battles);
  });
});

/**
 * Four Transports to a fleet — owner-specified in 0.18.7.
 *
 * Four carry five units each, so a fleet's hold is exactly `MAX_ARMY_UNITS`: one convoy lifts one
 * army and never more. The other sixteen berths are for warships.
 */
describe('a convoy is four transports and no more', () => {
  it('makes a full hold exactly one army', () => {
    expect(MAX_FLEET_TRANSPORTS * (shipById('transport')?.carries ?? 0)).toBe(MAX_ARMY_UNITS);
  });

  it('refuses to launch a fifth transport into the same fleet', () => {
    port.fleet = { transport: 5 };
    expect(launch(state, world, port, { transport: 5 })).toEqual({
      ok: false,
      reason: 'too-many-transports',
    });

    // Four is fine, and fills the hold.
    expect(launch(state, world, port, { transport: 4 }).ok).toBe(true);
    const fleet = state.fleets[0]!;
    expect(berths(fleet).capacity).toBe(MAX_ARMY_UNITS);
    // The fifth stays moored, to sail as a second convoy.
    expect(port.fleet).toEqual({ transport: 1 });
  });

  it('refuses to reinforce a full hold, but takes escorts all day', () => {
    putToSea({ transport: 4 });
    port.fleet = { transport: 1, flagship: 2 };

    expect(launch(state, world, port, { transport: 1 })).toEqual({
      ok: false,
      reason: 'too-many-transports',
    });
    expect(launch(state, world, port, { flagship: 2 }).ok).toBe(true);
    expect(state.fleets).toHaveLength(1);
    expect(state.fleets[0]?.ships).toEqual({ transport: 4, flagship: 2 });
  });

  /**
   * **Merging takes what fits rather than refusing** — owner-specified in 0.19.2. The cap it used to
   * protect is still protected: what does not fit stays where it was.
   */
  it('merges two convoys up to the cap and leaves the surplus behind', () => {
    const first = putToSea({ transport: 3 });
    const second: FleetState = {
      id: state.nextFleetId++,
      ownerIndex: FRANKS,
      tileIndex: seaBeside(world, port.tileIndex).find((t) => t !== first.tileIndex) ?? -1,
      ships: { transport: 3 },
      cargo: {},
      path: [],
      sail: 0,
    };
    if (second.tileIndex < 0) return;
    state.fleets.push(second);

    expect(mergeFleets(state, first.id, second.id).ok).toBe(true);
    // One Transport crossed to fill the hold; two stayed, and are still a fleet of their own.
    expect(first.ships).toEqual({ transport: MAX_FLEET_TRANSPORTS });
    expect(second.ships).toEqual({ transport: 2 });
    expect(state.fleets).toHaveLength(2);
  });

  it('still refuses when not one hull can move', () => {
    const first = putToSea({ transport: 4 });
    const second: FleetState = {
      id: state.nextFleetId++,
      ownerIndex: FRANKS,
      tileIndex: seaBeside(world, port.tileIndex).find((t) => t !== first.tileIndex) ?? -1,
      ships: { transport: 1 },
      cargo: {},
      path: [],
      sail: 0,
    };
    if (second.tileIndex < 0) return;
    state.fleets.push(second);

    expect(mergeFleets(state, first.id, second.id)).toEqual({
      ok: false,
      reason: 'too-many-transports',
    });
    expect(state.fleets).toHaveLength(2);
  });

  it('lets an escort join a full hold, which is the whole point of the change', () => {
    const convoy = putToSea({ transport: 4 });
    const escort: FleetState = {
      id: state.nextFleetId++,
      ownerIndex: FRANKS,
      tileIndex: seaBeside(world, port.tileIndex).find((t) => t !== convoy.tileIndex) ?? -1,
      ships: { light_ship: 20 },
      cargo: {},
      path: [],
      sail: 0,
    };
    if (escort.tileIndex < 0) return;
    state.fleets.push(escort);

    expect(mergeFleets(state, convoy.id, escort.id).ok).toBe(true);
    // Sixteen berths beside the four Transports, and the other four warships stay put.
    expect(convoy.ships).toEqual({ transport: 4, light_ship: 16 });
    expect(stackSize(convoy.ships)).toBe(MAX_FLEET_SHIPS);
    expect(escort.ships).toEqual({ light_ship: 4 });
  });

  it('never lands half a hold, because the men would drown with the half left behind', () => {
    const laden = putToSea({ transport: 3 });
    port.garrison = { light_infantry: 6 };
    const army = mobilise(state, world, port, { light_infantry: 6 });
    embark(state, world, laden.id, (army as { armyId: number }).armyId);
    expect(stackSize(laden.cargo)).toBe(6);

    const receiving: FleetState = {
      id: state.nextFleetId++,
      ownerIndex: FRANKS,
      tileIndex: seaBeside(world, port.tileIndex).find((t) => t !== laden.tileIndex) ?? -1,
      ships: { transport: 2, light_ship: 1 },
      cargo: {},
      path: [],
      sail: 0,
    };
    if (receiving.tileIndex < 0) return;
    state.fleets.push(receiving);

    // Only two of the three loaded Transports would fit, so none of them move and nobody drowns.
    mergeFleets(state, receiving.id, laden.id);
    expect(stackSize(laden.cargo)).toBe(6);
    expect(transportsIn(laden.ships)).toBe(3);
  });
});

/**
 * How big a navy a realm wants — **shipping is built for the armies that have nowhere to walk**.
 *
 * The formula used to be a function of cities held alone, and 0.18.9 measured that shape as
 * unable to deliver the ships the owner asked for: every raise of the flat ceilings destroyed
 * overseas conquest, taking 0 of the 7 marooned settlements against the shipped build's 5-7.
 * Demand now comes from spare troops, with the old city figure kept underneath as a floor.
 */
describe('naval appetite scales with idle armies, not cities held', () => {
  /** The Franks, and everything they could walk to. */
  const franksHome = (s: SimState) =>
    walkingDistanceFrom(
      world,
      s.cities.filter((c) => c.ownerIndex === FRANKS).map((c) => c.tileIndex),
    );

  it('counts nothing as spare while there is a war on the army-s own landmass', () => {
    const s = createInitialState(world, roster, 'franks', 4242, 'knight');
    const capital = s.cities.find((c) => c.ownerIndex === FRANKS);
    expect(capital).toBeDefined();
    mobilise(s, world, capital!, { ...capital!.garrison });

    // The Franks open in mainland Europe surrounded by settlements they would attack, so the
    // landmass they are standing on is contested and none of their men are waiting for a boat.
    expect(spareLift(s, world, FRANKS, franksHome(s), () => true)).toBe(0);
  });

  it('counts every stack as spare once there is nothing on the landmass worth attacking', () => {
    const s = createInitialState(world, roster, 'franks', 4242, 'knight');
    const capital = s.cities.find((c) => c.ownerIndex === FRANKS);
    capital!.garrison = { light_infantry: MAX_ARMY_UNITS };
    mobilise(s, world, capital!, { light_infantry: MAX_ARMY_UNITS });

    // A whole army's worth of men with no war to march to is one convoy's worth of shipping.
    expect(spareLift(s, world, FRANKS, franksHome(s), () => false)).toBe(1);
  });

  it('leaves a realm still fighting on land with exactly the shipping it had before', () => {
    // The old formula, for every realm size the map can produce. A realm with no spare troops must
    // want precisely this many **convoys**, or 0.18.10 was a balance change rather than a
    // redirection. The escort that rides with them is a separate question, and the owner raised it
    // in 0.19.1 — see the escort tests below.
    for (const cities of [1, 4, 10, 22, 45, 56]) {
      expect(convoysWanted(cities, 0)).toBe(Math.max(1, Math.min(5, 1 + Math.floor(cities / 10))));
    }
  });

  it('gives a realm with idle armies more shipping than its cities would buy', () => {
    // Britain: seven cities, so the city formula allows one convoy. Ten armies with nowhere to
    // march is ten armies' worth of demand, and the ceiling is what stops it.
    expect(convoysWanted(7, 0)).toBe(1);
    expect(convoysWanted(7, 4)).toBe(4);
    expect(convoysWanted(7, 10)).toBe(10);
    // And the ceiling still binds above that.
    expect(convoysWanted(7, MAX_CONVOYS + 20)).toBe(MAX_CONVOYS);
  });

  it('never lets the hull ceiling sit below the plan it is capping', () => {
    for (const cities of [1, 4, 7, 10, 22, 45, 56]) {
      for (const lift of [0, 1, 4, 8, 40]) {
        for (const landlocked of [false, true]) {
          const convoys = convoysWanted(cities, lift);
          const escorts = escortsWanted(cities, landlocked, convoys);
          // Berths for every convoy, plus the escorts, must fit inside the ceiling — otherwise a
          // realm stops building at the ceiling and never assembles what it decided it wanted.
          expect(hullsWanted(cities, landlocked, convoys, escorts)).toBeGreaterThanOrEqual(
            MAX_FLEET_TRANSPORTS * convoys + escorts,
          );
        }
      }
    }
  });

  it('keeps the escort target bounded, however large the realm', () => {
    // The bound moved from 14 to 40 in 0.19.1 with the owner's three-per-convoy brief. What stops
    // a big target starving the hold is no longer this cap — it is that `buildFleet` measures the
    // escort against the Transports already afloat. The cap is only there so a navy is finite.
    for (const cities of [1, 22, 56]) {
      for (const lift of [0, 8, 40]) {
        expect(escortsWanted(cities, true, convoysWanted(cities, lift))).toBeLessThanOrEqual(40);
      }
    }
  });
});

/**
 * **A convoy keeps out of a warship's reach** — owner-specified in 0.19.1, decision 166.
 *
 * A warship intercepts anything ending a tick within one tile of it and cargo drowns with the hull,
 * so the eight tiles around an enemy warship are not a risk to a loaded transport, they are a
 * certainty. Routing became a question of avoiding them rather than of distance.
 */
describe('transports do not sail into enemy warships', () => {
  it('counts the tile a hostile warship stands on and every tile around it as menaced', () => {
    const enemy = roster.findIndex((f, i) => i !== FRANKS && !f.neutral);
    const water = seaBeside(world, port.tileIndex)[0]!;
    state.fleets.push({
      id: state.nextFleetId++,
      ownerIndex: enemy,
      tileIndex: water,
      ships: { light_ship: 1 },
      cargo: {},
      path: [],
      sail: 0,
    });

    const menaced = menacedWater(state, world, FRANKS);
    expect(menaced.has(water)).toBe(true);
    for (const tile of seaNeighbours(world, water)) expect(menaced.has(tile)).toBe(true);
  });

  it('ignores an enemy convoy, which can catch nothing', () => {
    const enemy = roster.findIndex((f, i) => i !== FRANKS && !f.neutral);
    const water = seaBeside(world, port.tileIndex)[0]!;
    state.fleets.push({
      id: state.nextFleetId++,
      ownerIndex: enemy,
      tileIndex: water,
      ships: { transport: 3 },
      cargo: {},
      path: [],
      sail: 0,
    });

    // Two transport convoys pass each other untouched (decision 125), so routing around one would
    // be superstition rather than seamanship.
    expect(menacedWater(state, world, FRANKS).size).toBe(0);
  });

  it('never treats our own warships as a hazard', () => {
    putToSea({ light_ship: 1 });
    expect(menacedWater(state, world, FRANKS).size).toBe(0);
  });

  it('routes around menaced water when a way round exists', () => {
    const fleet = putToSea({ transport: 2 });
    const open = [...Array(world.width * world.height).keys()].filter(
      (t) => isWater(world, t) && t !== fleet.tileIndex,
    );
    const destination = open.find(
      (t) => findSeaPath(state, world, fleet, t) !== null && stepsBetween(fleet, t) > 4,
    );
    if (destination === undefined) return;

    const direct = findSeaPath(state, world, fleet, destination)!;
    // Menace the first step of the direct route. A detour must therefore differ from it.
    const menaced = new Set<number>([direct[0]!]);
    const around = findSeaPath(state, world, fleet, destination, fleet.tileIndex, menaced);

    if (around !== null) {
      expect(around[0]).not.toBe(direct[0]);
      expect(around).not.toContain(direct[0]);
    }
  });

  it('always allows the destination itself, however menaced it is', () => {
    const fleet = putToSea({ transport: 2 });
    const destination = seaNeighbours(world, fleet.tileIndex).find((t) => isWater(world, t));
    if (destination === undefined) return;

    // The beach an army has to land on may be exactly the one being watched. What the rule avoids
    // is being caught in transit, not arriving somewhere dangerous.
    const path = findSeaPath(state, world, fleet, destination, fleet.tileIndex, new Set([destination]));
    expect(path).toEqual([destination]);
  });

  /** Straight-line tiles, only used to pick a destination far enough away to have a choice of route. */
  function stepsBetween(fleet: FleetState, tile: number): number {
    return Math.max(
      Math.abs((fleet.tileIndex % world.width) - (tile % world.width)),
      Math.abs(
        Math.floor(fleet.tileIndex / world.width) - Math.floor(tile / world.width),
      ),
    );
  }
});

/**
 * **Large amounts of warships, without starving the hold** — owner-specified in 0.19.1.
 *
 * Raising the escort target is the exact thing that destroyed overseas conquest in 0.18.9. What makes
 * three per convoy safe is that `buildFleet` measures the escort against the Transports already
 * afloat rather than the ones eventually wanted.
 */
describe('convoys are escorted in strength', () => {
  it('wants three warships for every convoy it means to run', () => {
    expect(escortsWanted(1, false, 1)).toBeGreaterThanOrEqual(ESCORTS_PER_CONVOY);
    expect(escortsWanted(1, false, 4)).toBe(4 * ESCORTS_PER_CONVOY);
    expect(escortsWanted(1, false, 10)).toBe(10 * ESCORTS_PER_CONVOY);
  });

  it('keeps a patrol squadron even for a realm running one convoy', () => {
    // A large realm with a single convoy still wants warships — they are the ones that go hunting.
    expect(escortsWanted(40, false, 1)).toBeGreaterThan(ESCORTS_PER_CONVOY);
  });

  it('caps, so an escort target cannot run away with a whole navy', () => {
    expect(escortsWanted(60, true, MAX_CONVOYS)).toBeLessThanOrEqual(40);
  });

  it('leaves room in a convoy for the escort to ride with the cargo', () => {
    // Four Transports and sixteen berths spare, so three escorts fit alongside the army rather
    // than having to sail as a separate fleet.
    expect(MAX_FLEET_SHIPS - MAX_FLEET_TRANSPORTS).toBeGreaterThanOrEqual(ESCORTS_PER_CONVOY);
  });
});

/** **More landings for a larger realm** — owner-specified in 0.19.1. */
describe('a large realm lands in more places', () => {
  it('scales the number of beaches with the realm, within bounds', () => {
    expect(maxBeaches(1)).toBe(3);
    expect(maxBeaches(12)).toBe(3);
    expect(maxBeaches(30)).toBe(5);
    expect(maxBeaches(60)).toBe(7);
    // Never fewer than the flat three it replaced, never more than seven.
    for (const cities of [0, 5, 25, 55, 200]) {
      expect(maxBeaches(cities)).toBeGreaterThanOrEqual(3);
      expect(maxBeaches(cities)).toBeLessThanOrEqual(7);
    }
  });

  it('lifts more armies at once than it did', () => {
    // Only a realm with idle armies reaches it; size alone still stops at five.
    expect(MAX_CONVOYS).toBeGreaterThan(8);
    expect(convoysWanted(60, 0)).toBe(5);
    expect(convoysWanted(60, 40)).toBe(MAX_CONVOYS);
  });
});
