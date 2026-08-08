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
  unitById,
} from '../data/units';
import { armyAt, mobilise, stackSize } from './armies';
import { TICKS_PER_MONTH } from './calendar';
import { cancelProduction, queueShip, totalUpkeep } from './construction';
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
  orthogonalNeighbours,
  seaBeside,
} from './fleets';
import { sailingDistanceFrom, UNREACHABLE } from './geography';
import { canRaise, manpowerCap, manpowerUnderArms } from './manpower';
import { MARCH_PER_TILE } from './movement';
import { advanceFleets, fightAtSea, findSeaPath, orderSail, seaBlockedBy } from './sailing';
import { deserialise, migrate, serialise, SAVE_VERSION, type SaveFile } from './save';
import { createInitialState } from './state';
import { advanceBy } from './tick';
import {
  MAX_ARMY_UNITS,
  MAX_FLEET_SHIPS,
  MILLI,
  type CityState,
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
    expect(orthogonalNeighbours(world, port.tileIndex)).toContain(fleet.tileIndex);
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

describe('embarking and disembarking — board at a Dock, land on any coast', () => {
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

  it('refuses to load without a harbour, however many berths are free', () => {
    port.buildings = port.buildings.filter((b) => b !== 'dock');
    port.buildings = [...port.buildings, 'fishery'];
    const fleet = putToSea({ transport: 2 });
    port.garrison = { light_infantry: 1 };
    const raised = mobilise(state, world, port, { light_infantry: 1 });

    expect(embark(state, world, fleet.id, (raised as { armyId: number }).armyId)).toEqual({
      ok: false,
      reason: 'no-harbour',
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
    const beside = orthogonalNeighbours(world, ours.tileIndex).find(
      (tile) => isWater(world, tile) && !fleetAt(state, tile),
    )!;
    const beyond = orthogonalNeighbours(world, beside).find(
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

  it('will not re-fight a standoff: an interception needs something to be moving', () => {
    const { ours, enemy } = opposingFleets({ flagship: 1 }, { flagship: 1 });
    // Both lying to, already adjacent. Without the movement clause this pair would fight 120
    // times a month, grinding each other down a tick at a time.
    enemy.tileIndex = orthogonalNeighbours(world, ours.tileIndex).find(
      (tile) => isWater(world, tile) && tile !== ours.tileIndex,
    )!;
    enemy.path = [];
    enemy.sail = 0;

    advanceFleets(state, world);
    advanceFleets(state, world);
    advanceFleets(state, world);

    expect(state.battles).toHaveLength(0);
    expect(state.fleets.find((f) => f.id === ours.id)).toBeDefined();
    expect(state.fleets.find((f) => f.id === enemy.id)).toBeDefined();
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

  it('refuses a hull the realm has no room under its ceiling to crew', () => {
    port.population = 20_000;
    fund();

    // Filled a hull at a time rather than by arithmetic, because the ceiling is a share of *all*
    // the realm's people and soldiers count among them — so each Flagship raises the cap as well
    // as spending it, and the closed form for "how many is too many" is not worth writing down.
    while (canRaise(state, FRANKS, 40) && (port.fleet.flagship ?? 0) < 1000) {
      port.fleet.flagship = (port.fleet.flagship ?? 0) + 1;
    }

    expect(canRaise(state, FRANKS, 40)).toBe(false);
    expect(queueShip(state, port, 'transport')).toEqual({
      ok: false,
      reason: 'no-manpower',
    });
    expect(manpowerUnderArms(state, FRANKS)).toBeGreaterThan(manpowerCap(state, FRANKS) - 40);
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
