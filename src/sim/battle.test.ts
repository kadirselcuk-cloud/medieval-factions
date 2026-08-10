import { beforeEach, describe, expect, it } from 'vitest';
import { loadFactions } from '../data/factions';
import { loadEurope1350 } from '../data/maps';
import type { UnitStack } from '../data/units';
import { terrainAt, tileIndex, type World } from '../data/world';
import { armyAt, armyById } from './armies';
import {
  ATTACKER,
  DEFENDER,
  defenderAdvantage,
  fightBattle,
  MAX_BATTLE_TURNS,
  MAX_DEFENDER_ADVANTAGE,
  unitCount,
} from './battle';
import { TICKS_PER_MONTH } from './calendar';
import { resolveEngagement } from './conquest';
import { advanceArmies, orderMove } from './movement';
import { deserialise, serialise } from './save';
import { createInitialState } from './state';
import { advanceBy } from './tick';
import { type ArmyState, type CityState, type SimState } from './types';

const world = loadEurope1350();
const roster = loadFactions();
const FRANKS = roster.findIndex((f) => f.id === 'franks');
const NEUTRAL = roster.findIndex((f) => f.neutral);

/** June. Battles fought in January would carry winter's extra 10% for the defender. */
const SUMMER = TICKS_PER_MONTH * 5;

let state: SimState;

beforeEach(() => {
  state = createInitialState(world, roster, 'franks', 4242);
  state.tick = SUMMER;
});

function place(units: UnitStack, ownerIndex: number, tile: number): ArmyState {
  const army: ArmyState = {
    id: state.nextArmyId++,
    ownerIndex,
    tileIndex: tile,
    units: { ...units },
    path: [],
    march: 0,
      role: 'field',
  };
  state.armies.push(army);
  return army;
}

/** An empty plains tile with an empty plains tile beside it, well away from anything. */
function openGround(w: World): { from: number; to: number } {
  for (let y = 1; y < w.height - 1; y++) {
    for (let x = 1; x < w.width - 2; x++) {
      if (terrainAt(w, x, y) !== 'plains' || terrainAt(w, x + 1, y) !== 'plains') continue;
      const from = tileIndex(w, x, y);
      const to = tileIndex(w, x + 1, y);
      if (state.cities.some((c) => c.tileIndex === from || c.tileIndex === to)) continue;
      return { from, to };
    }
  }
  throw new Error('no open ground on the map');
}

/** An Independent settlement with a walkable tile beside it. */
function independentTarget(): { city: CityState; approach: number } {
  for (const city of state.cities) {
    if (city.ownerIndex !== NEUTRAL) continue;
    const location = world.cities[city.cityIndex];
    if (!location) continue;
    for (const [dx, dy] of [
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0],
    ] as const) {
      const x = location.x + dx;
      const y = location.y + dy;
      if (x < 0 || y < 0 || x >= world.width || y >= world.height) continue;
      if (terrainAt(world, x, y) === 'water') continue;
      const approach = tileIndex(world, x, y);
      if (state.cities.some((c) => c.tileIndex === approach)) continue;
      return { city, approach };
    }
  }
  throw new Error('no reachable Independent settlement');
}

// ------------------------------------------------------------------ the ground

describe("defender's advantage", () => {
  it('adds terrain, the settlement bonus, the walls and winter', () => {
    const { city } = independentTarget();
    city.tier = 4;
    city.buildings = ['citadel']; // +60%
    state.tick = 0; // January — winter

    const advantage = defenderAdvantage(state, world, city.tileIndex);
    // Every defence bonus in the game was halved in 0.13.0 — see docs/MECHANICS.md §4.
    expect(advantage.settlement).toBe(50);
    expect(advantage.fortification).toBe(300);
    expect(advantage.winter).toBe(50);
    // Terrain under the city plus the three above, capped.
    expect(advantage.total).toBe(
      Math.min(
        MAX_DEFENDER_ADVANTAGE,
        advantage.terrain + advantage.settlement + advantage.fortification + advantage.winter,
      ),
    );
  });

  it('caps, so an attacker can never be healed by the ground', () => {
    const { city } = independentTarget();
    city.tier = 4;
    city.buildings = ['citadel'];
    state.tick = 0;
    expect(defenderAdvantage(state, world, city.tileIndex).total).toBeLessThanOrEqual(
      MAX_DEFENDER_ADVANTAGE,
    );
  });

  it('gives open plains a twentieth to whoever is standing on it', () => {
    const { to } = openGround(world);
    const advantage = defenderAdvantage(state, world, to);
    // 5%, not the 10% it was before 0.13.0 halved every defence bonus.
    expect(advantage).toMatchObject({ terrain: 50, settlement: 0, fortification: 0, winter: 0 });
    expect(advantage.total).toBe(50);
  });
});

// ------------------------------------------------------------------- the battle

describe('auto-resolve', () => {
  /**
   * The advantage is carried per contingent, not by the battle, so a caller has to state it —
   * which is the whole point: relief armies at a siege fight on different ground from the men
   * on the walls. Here both sides are field armies, so the defender simply gets the terrain.
   */
  const setup = (attacker: UnitStack, defender: UnitStack, tile: number) => ({
    tileIndex: tile,
    cityIndex: -1,
    attackerIndex: FRANKS,
    defenderIndex: NEUTRAL,
    attacker: [{ source: 'army' as const, stack: attacker, armyId: 1 }],
    defender: [
      {
        source: 'army' as const,
        stack: defender,
        armyId: 2,
        advantage: defenderAdvantage(state, world, tile).total,
      },
    ],
  });

  it('is reproducible from the same seed and campaign state', () => {
    const { to } = openGround(world);
    const a = fightBattle(state, world, setup({ light_infantry: 3 }, { archer: 2 }, to));

    const again = createInitialState(world, roster, 'franks', 4242);
    again.tick = SUMMER;
    const b = fightBattle(again, world, setup({ light_infantry: 3 }, { archer: 2 }, to));

    expect(JSON.stringify(b.report)).toBe(JSON.stringify(a.report));
  });

  it('never runs past the 48-turn cap', () => {
    const { to } = openGround(world);
    const { report } = fightBattle(state, world, setup({ skirmisher: 8 }, { skirmisher: 8 }, to));
    expect(report.turns.length).toBeLessThanOrEqual(MAX_BATTLE_TURNS);
  });

  /**
   * The whole point of a 50-tile field: ranged units get an opening phase. An archer opens fire
   * long before the infantry closing on it can strike back.
   */
  it('lets archers fire during the approach', () => {
    const { to } = openGround(world);
    const { report } = fightBattle(state, world, setup({ light_infantry: 1 }, { archer: 1 }, to));

    const firstShot = report.turns.findIndex((t) => t.actions.some((a) => a.kind === 'shoot'));
    const firstStrike = report.turns.findIndex((t) => t.actions.some((a) => a.kind === 'strike'));
    expect(firstShot).toBeGreaterThanOrEqual(0);
    expect(firstShot).toBeLessThan(firstStrike === -1 ? MAX_BATTLE_TURNS : firstStrike);
  });

  /** Terrain is worth a battle. The same unit on both sides is not an even fight. */
  it('hands the defender a mirror match on its own ground', () => {
    const { to } = openGround(world);
    const { report } = fightBattle(
      state,
      world,
      setup({ light_infantry: 1 }, { light_infantry: 1 }, to),
    );
    expect(report.winner).toBe('defender');
  });

  it('applies the damage formula the design document states', () => {
    const { to } = openGround(world);
    const { report } = fightBattle(
      state,
      world,
      setup({ light_infantry: 1 }, { light_infantry: 1 }, to),
    );

    // Plains gives the defender +5% since 0.13.0 halved every defence bonus. The defender is an
    // Independent Light Infantry: 100 soldiers doing 20 damage each, 2,000 raw, ×1.05 for the
    // ground. **Into 103 HP a man since 0.20.1** — the attacker is a Frankish Levy Footman, a plain
    // shared name with no trade of its own, but the realm's +3% hit points applies to everything it
    // fields — so 20 dead where an unmodified 100 HP would take 21.
    const blows = report.turns.flatMap((t) => t.actions).filter((a) => a.kind === 'strike');
    expect(blows[0]).toMatchObject({ casualties: 20, charge: false });
  });

  it('fires the charge bonus once and only once', () => {
    const { to } = openGround(world);
    const { report } = fightBattle(
      state,
      world,
      setup({ heavy_cavalry: 2 }, { light_infantry: 4 }, to),
    );

    for (const fighter of report.fighters) {
      const charges = report.turns
        .flatMap((t) => t.actions)
        .filter((a) => a.kind === 'strike' && a.slot === fighter.slot && a.charge);
      expect(charges.length, `slot ${fighter.slot}`).toBeLessThanOrEqual(1);
    }
  });

  it('treats a side with nothing on the field as already beaten', () => {
    const { to } = openGround(world);
    const { report } = fightBattle(state, world, {
      ...setup({ light_infantry: 1 }, {}, to),
      defender: [],
    });
    expect(report.winner).toBe('attacker');
    expect(report.ending).toBe('destroyed');
    expect(report.turns).toHaveLength(0);
  });

  it('reforms the survivors into whole units, striking off what is left of the rest', () => {
    const { to } = openGround(world);
    const { report } = fightBattle(
      state,
      world,
      setup({ light_infantry: 6 }, { light_infantry: 2 }, to),
    );

    expect(report.winner).toBe('attacker');
    // Six units went in; fewer come out, because the men who survived are reformed and any
    // formation below half strength is struck off.
    expect(unitCount(report.after[ATTACKER])).toBeLessThan(6);
    expect(unitCount(report.after[ATTACKER])).toBeGreaterThan(0);
    // Both defending units are finished as fighting formations, whether the last few men were
    // killed or simply broke and ran once the odds passed three to one.
    expect(unitCount(report.after[DEFENDER])).toBe(0);
    expect(report.losses[DEFENDER]).toBeGreaterThan(150);
  });
});

// ---------------------------------------------------------------- the aftermath

describe('engagements', () => {
  it('destroys the losing army and leaves the winner holding the ground', () => {
    const { from, to } = openGround(world);
    const attacker = place({ light_infantry: 1 }, FRANKS, from);
    const defender = place({ heavy_cavalry: 3 }, NEUTRAL, to);

    const { report, advance } = resolveEngagement(state, world, attacker, to);

    expect(report.winner).toBe('defender');
    expect(advance).toBe(false);
    expect(armyById(state, attacker.id)).toBeUndefined();
    expect(armyById(state, defender.id)).toBeDefined();
  });

  it('cannot walk into a settlement — every one of them fights back', () => {
    const { city, approach } = independentTarget();
    const attacker = place({ light_infantry: 1 }, FRANKS, approach);

    const { report } = resolveEngagement(state, world, attacker, city.tileIndex);
    expect(report.cityIndex).toBe(city.cityIndex);
    expect(unitCount(report.before[DEFENDER])).toBeGreaterThan(0);
  });

  it('takes the settlement when the attacker carries the field', () => {
    const { city, approach } = independentTarget();
    city.garrison = { light_infantry: 1 };
    city.queue = [{ kind: 'building', id: 'wooden_houses', monthsRemaining: 4 }];
    const people = city.population;

    const attacker = place({ heavy_cavalry: 8 }, FRANKS, approach);
    const { report, advance } = resolveEngagement(state, world, attacker, city.tileIndex);

    expect(report.winner).toBe('attacker');
    expect(report.captured).toBe(true);
    expect(advance).toBe(true);
    expect(city.ownerIndex).toBe(FRANKS);
    // People and buildings stay; work the old owner paid for does not.
    expect(city.population).toBe(people);
    expect(city.garrison).toEqual({});
    expect(city.queue).toEqual([]);
  });

  it('sends the garrison back behind the walls when the settlement holds', () => {
    const { city, approach } = independentTarget();
    city.garrison = { sword_infantry: 4 };

    const attacker = place({ light_infantry: 1 }, FRANKS, approach);
    const { report } = resolveEngagement(state, world, attacker, city.tileIndex);

    expect(report.winner).toBe('defender');
    expect(city.ownerIndex).toBe(NEUTRAL);
    // Survivors are reformed and returned; the free defenders leave nothing behind.
    expect(Object.keys(city.garrison)).toEqual(['sword_infantry']);
    expect(city.garrison['sword_infantry']).toBeGreaterThan(0);
  });

  it('extinguishes a realm that loses its last settlement, and releases its ground', () => {
    const { city, approach } = independentTarget();
    // Give the whole neutral faction just this one settlement.
    for (const other of state.cities) {
      if (other !== city && other.ownerIndex === NEUTRAL) other.ownerIndex = FRANKS;
    }
    state.tileOwner[approach] = NEUTRAL;

    const attacker = place({ heavy_cavalry: 8 }, FRANKS, approach);
    resolveEngagement(state, world, attacker, city.tileIndex);

    expect(state.factions[NEUTRAL]?.alive).toBe(false);
    expect(state.tileOwner[approach]).toBe(-1);
    expect([...state.tileOwner].some((owner) => owner === NEUTRAL)).toBe(false);
  });
});

// ----------------------------------------------------------------- the campaign

describe('battles in a running campaign', () => {
  it('is started by a march, not by a separate order', () => {
    const { city, approach } = independentTarget();
    const attacker = place({ heavy_cavalry: 8 }, FRANKS, approach);

    expect(orderMove(state, world, attacker.id, city.tileIndex).ok).toBe(true);
    // Horse crosses a tile a month, and hostile ground costs 40% more, so give it a wide margin.
    for (let i = 0; i < TICKS_PER_MONTH * 4 && state.battles.length === 0; i++) {
      state.tick += 1;
      advanceArmies(state, world);
    }

    expect(state.battles).toHaveLength(1);
    expect(city.ownerIndex).toBe(FRANKS);
    expect(armyAt(state, city.tileIndex)?.id).toBe(attacker.id);
    expect(state.tileOwner[city.tileIndex]).toBe(FRANKS);
  });

  it('keeps only the most recent battles, and survives a save', () => {
    const { from, to } = openGround(world);
    for (let i = 0; i < 5; i++) {
      const attacker = place({ light_infantry: 1 }, FRANKS, from);
      place({ light_infantry: 1 }, NEUTRAL, to);
      resolveEngagement(state, world, attacker, to);
      for (const army of [...state.armies]) state.armies.splice(state.armies.indexOf(army), 1);
    }

    expect(state.battles).toHaveLength(3);
    expect(state.battles[0]!.id).toBeGreaterThan(state.battles[2]!.id);

    const reloaded = deserialise(serialise(state));
    expect(JSON.stringify(reloaded.battles)).toBe(JSON.stringify(state.battles));
    expect(reloaded.nextBattleId).toBe(state.nextBattleId);
  });

  /** The one guarantee everything else rests on: a battle must not knock the sim off its rails. */
  it('leaves the simulation deterministic', () => {
    const run = (): string => {
      const s = createInitialState(world, roster, 'franks', 77);
      const { city, approach } = (() => {
        const saved = state;
        state = s;
        const target = independentTarget();
        state = saved;
        return target;
      })();
      const army: ArmyState = {
        id: s.nextArmyId++,
        ownerIndex: FRANKS,
        tileIndex: approach,
        units: { light_infantry: 4 },
        path: [],
        march: 0,
      role: 'field',
      };
      s.armies.push(army);
      orderMove(s, world, army.id, city.tileIndex);
      advanceBy(s, world, TICKS_PER_MONTH * 6);
      return JSON.stringify(serialise(s));
    };

    expect(run()).toBe(run());
  });
});
