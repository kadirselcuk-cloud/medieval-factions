import { beforeEach, describe, expect, it } from 'vitest';
import { loadFactions } from '../data/factions';
import { loadEurope1350 } from '../data/maps';
import { cityDefence } from '../data/units';
import { tileIndex } from '../data/world';
import {
  armiesOf,
  armyAt,
  armySpeed,
  defenceOf,
  disband,
  mobilise,
  stackSize,
  stackSoldiers,
  stackUpkeep,
  standDown,
} from './armies';
import { TICKS_PER_MONTH } from './calendar';
import { totalUpkeep } from './construction';
import { advanceArmies, blockedBy, findPath, halt, MARCH_PER_TILE, orderMove, SEASON_MOVEMENT } from './movement';
import { createInitialState, recomputeIncome, STARTING_UNIT } from './state';
import { advanceBy } from './tick';
import { MAX_ARMY_UNITS, type CityState, type SimState } from './types';

const world = loadEurope1350();
const roster = loadFactions();
const FRANKS = roster.findIndex((f) => f.id === 'franks');

let state: SimState;
let paris: CityState;

beforeEach(() => {
  state = createInitialState(world, roster, 'franks', 4242);
  paris = state.cities.find((c) => c.ownerIndex === FRANKS)!;
});

/** Put an army of the given units on Paris and return it. */
function raise(units: Record<string, number>) {
  paris.garrison = { ...units };
  const result = mobilise(state, world, paris, units);
  if (!result.ok) throw new Error(`could not raise an army: ${result.reason}`);
  return armyAt(state, paris.tileIndex)!;
}

describe('city defence', () => {
  it('follows the owner-stated composition by tier', () => {
    expect(cityDefence(1, [])).toEqual({ light_infantry: 1 });
    expect(cityDefence(2, [])).toEqual({ light_infantry: 1, sword_infantry: 1 });
    expect(cityDefence(3, [])).toEqual({ light_infantry: 1, sword_infantry: 1, archer: 1 });
    expect(cityDefence(4, [])).toEqual({
      light_infantry: 1,
      spear_infantry: 1,
      sword_infantry: 1,
      archer: 1,
      light_cavalry: 1,
    });
  });

  it('adds one defender per military building and per town hall', () => {
    const defended = cityDefence(2, ['barracks', 'archery_range', 'stables', 'town_hall']);
    expect(defended).toEqual({
      light_infantry: 2, // tier 2 baseline, plus the town hall's militia
      sword_infantry: 2, // tier 2 baseline, plus the barracks
      archer: 1,
      light_cavalry: 1,
    });
  });

  it('ignores buildings that raise no troops', () => {
    expect(cityDefence(1, ['wooden_houses', 'fishery', 'cottage_shops'])).toEqual(
      cityDefence(1, []),
    );
  });

  // Nothing on the map may be walked into. Every settlement, including the 47 the Independents
  // hold, is defended from the first tick.
  it('defends every settlement on the map', () => {
    for (const city of state.cities) {
      expect(stackSize(defenceOf(city)), `city ${city.cityIndex}`).toBeGreaterThan(0);
    }
  });

  it('costs nothing — defenders are part of the settlement, not troops on the payroll', () => {
    paris.garrison = {};
    paris.tier = 4;
    paris.buildings = ['barracks', 'stables', 'archery_range', 'town_hall'];
    recomputeIncome(state, world);
    expect(totalUpkeep(state, FRANKS)).toBe(0);
    // A fully built Capitol fields nine free defenders: five from its tier and one from each
    // of Barracks, Archery Range, Stables and Town Hall.
    expect(stackSize(defenceOf(paris))).toBe(9);
  });
});

describe('the starting unit', () => {
  it('gives every playable faction one unit, and the Independents none', () => {
    const neutral = roster.findIndex((f) => f.neutral);
    for (const city of state.cities) {
      const expected = city.ownerIndex === neutral ? undefined : 1;
      expect(city.garrison[STARTING_UNIT]).toBe(expected);
    }
  });
});

describe('mustering', () => {
  it('moves units out of the garrison and into an army on the settlement tile', () => {
    const army = raise({ light_infantry: 2 });
    expect(paris.garrison).toEqual({});
    expect(army.units).toEqual({ light_infantry: 2 });
    expect(army.tileIndex).toBe(paris.tileIndex);
    expect(armiesOf(state, FRANKS)).toHaveLength(1);
  });

  it('reinforces the army already standing there rather than raising a second', () => {
    const army = raise({ light_infantry: 1 });
    paris.garrison['skirmisher'] = 1;
    mobilise(state, world, paris, { skirmisher: 1 });

    expect(state.armies).toHaveLength(1);
    expect(army.units).toEqual({ light_infantry: 1, skirmisher: 1 });
  });

  it('refuses to muster units the garrison does not hold', () => {
    paris.garrison = { light_infantry: 1 };
    expect(mobilise(state, world, paris, { light_infantry: 2 })).toEqual({
      ok: false,
      reason: 'not-in-garrison',
    });
    expect(state.armies).toHaveLength(0);
  });

  it('caps an army at twenty units', () => {
    raise({ light_infantry: MAX_ARMY_UNITS });
    paris.garrison['light_infantry'] = 1;
    expect(mobilise(state, world, paris, { light_infantry: 1 })).toEqual({
      ok: false,
      reason: 'army-full',
    });
  });

  it('stands an army down back into the garrison intact', () => {
    const army = raise({ light_infantry: 2, skirmisher: 1 });
    expect(standDown(state, world, army.id)).toMatchObject({ ok: true });
    expect(state.armies).toHaveLength(0);
    expect(paris.garrison).toEqual({ light_infantry: 2, skirmisher: 1 });
  });

  it('loses the units when an army disbands in the field', () => {
    const army = raise({ light_infantry: 2 });
    disband(state, army.id);
    expect(state.armies).toHaveLength(0);
    expect(paris.garrison).toEqual({});
  });
});

describe('army arithmetic', () => {
  it('marches at its slowest unit', () => {
    // Light cavalry 8, light infantry 4, sword infantry 3.
    expect(armySpeed(raise({ light_cavalry: 1 }))).toBe(8);
    expect(armySpeed(raise({ light_cavalry: 1, light_infantry: 1 }))).toBe(4);
    expect(armySpeed(raise({ light_cavalry: 1, sword_infantry: 1 }))).toBe(3);
  });

  it('counts soldiers and upkeep from the roster', () => {
    const units = { light_infantry: 2, light_cavalry: 1 }; // 100×2 + 40 men; 10×2 + 20 gold
    expect(stackSoldiers(units)).toBe(240);
    expect(stackUpkeep(units)).toBe(40);
  });

  it('charges upkeep for units in the field, exactly as for units in barracks', () => {
    paris.garrison = { light_infantry: 3 };
    recomputeIncome(state, world);
    const inBarracks = totalUpkeep(state, FRANKS);

    mobilise(state, world, paris, { light_infantry: 3 });
    recomputeIncome(state, world);
    expect(totalUpkeep(state, FRANKS)).toBe(inBarracks);
  });
});

describe('movement', () => {
  /** A land tile next to Paris, to march to. */
  const nearParis = () => {
    const city = world.cities.find((c) => c.name === 'Paris')!;
    return tileIndex(world, city.x + 1, city.y);
  };

  it('paths to an adjacent tile in one step', () => {
    const army = raise({ light_infantry: 1 });
    expect(findPath(state, world, army, nearParis())).toEqual([nearParis()]);
  });

  it('never routes across water', () => {
    const army = raise({ light_infantry: 1 });
    const water = state.tileOwner.findIndex((_, index) => {
      const x = index % world.width;
      const y = Math.floor(index / world.width);
      return world.terrain[tileIndex(world, x, y)] === 0;
    });
    expect(findPath(state, world, army, water)).toBeNull();
  });

  it('is blocked by a settlement another faction holds', () => {
    const army = raise({ light_infantry: 1 });
    const rouen = state.cities.find((c) => c.ownerIndex !== FRANKS)!;
    expect(blockedBy(state, world, army, rouen.tileIndex, true)).toBe('hostile-settlement');
    expect(findPath(state, world, army, rouen.tileIndex)).toBeNull();
  });

  it('walks the whole path and claims the ground it crosses', () => {
    const army = raise({ light_infantry: 1 }); // 4 tiles a month
    const target = nearParis();
    state.tileOwner[target] = -1;

    expect(orderMove(state, world, army.id, target)).toEqual({ ok: true, tiles: 1 });
    advanceBy(state, world, TICKS_PER_MONTH);

    expect(army.tileIndex).toBe(target);
    expect(army.path).toEqual([]);
    expect(state.tileOwner[target]).toBe(FRANKS);
  });

  // The whole point of the fixed-point march unit: the stated speed is the speed you get.
  it('takes exactly a month to cross four tiles of plains at speed four', () => {
    expect(MARCH_PER_TILE / (4 * SEASON_MOVEMENT.spring)).toBe(TICKS_PER_MONTH / 4);
    // Winter is -40%, so the same four tiles take two and a half months.
    expect(MARCH_PER_TILE / (4 * SEASON_MOVEMENT.winter)).toBe(50);
  });

  it('halts on command, discarding banked progress', () => {
    const army = raise({ light_infantry: 1 });
    orderMove(state, world, army.id, nearParis());
    advanceArmies(state, world);
    halt(state, army.id);
    expect(army.path).toEqual([]);
    expect(army.march).toBe(0);
  });

  it('merges into a friendly army waiting at the destination', () => {
    const first = raise({ light_infantry: 1 });
    const target = nearParis();
    orderMove(state, world, first.id, target);
    advanceBy(state, world, TICKS_PER_MONTH);
    expect(first.tileIndex).toBe(target);

    paris.garrison = { skirmisher: 1 };
    const second = armyById(state, mobiliseOrThrow({ skirmisher: 1 }));
    orderMove(state, world, second.id, target);
    advanceBy(state, world, TICKS_PER_MONTH);

    expect(state.armies).toHaveLength(1);
    expect(state.armies[0]!.units).toEqual({ light_infantry: 1, skirmisher: 1 });
  });

  function mobiliseOrThrow(units: Record<string, number>): number {
    const result = mobilise(state, world, paris, units);
    if (!result.ok) throw new Error(result.reason);
    return result.armyId;
  }

  function armyById(s: SimState, id: number) {
    const army = s.armies.find((a) => a.id === id);
    if (!army) throw new Error(`no army ${id}`);
    return army;
  }
});

describe('determinism with armies in the field', () => {
  it('produces identical state however the ticks are batched', () => {
    const build = (): SimState => {
      const s = createInitialState(world, roster, 'franks', 99);
      const city = s.cities.find((c) => c.ownerIndex === FRANKS)!;
      city.garrison = { light_infantry: 2 };
      mobilise(s, world, city, { light_infantry: 2 });
      const army = s.armies[0]!;
      const paris3 = world.cities.find((c) => c.name === 'Paris')!;
      orderMove(s, world, army.id, tileIndex(world, paris3.x + 2, paris3.y));
      return s;
    };

    const a = build();
    const b = build();
    advanceBy(a, world, 600);
    for (let i = 0; i < 60; i++) advanceBy(b, world, 10);

    expect(snapshot(a)).toEqual(snapshot(b));
  });
});

function snapshot(state: SimState) {
  return {
    tick: state.tick,
    rng: state.rng,
    armies: state.armies.map((army) => ({ ...army, units: { ...army.units }, path: [...army.path] })),
    tileOwner: [...state.tileOwner],
  };
}
