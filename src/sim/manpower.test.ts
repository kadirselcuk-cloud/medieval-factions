import { beforeEach, describe, expect, it } from 'vitest';
import { loadFactions } from '../data/factions';
import { loadEurope1350 } from '../data/maps';
import { unitById } from '../data/units';
import { availableManpower, queueUnit, cancelProduction, queueShip } from './construction';
import { armedSharePermille, manpowerUnderArms, realmPeople } from './manpower';
import { createInitialState } from './state';
import { MILLI, MIN_POPULATION, type CityState, type SimState } from './types';

/**
 * Manpower — docs/MECHANICS.md §5.
 *
 * **There is no ceiling on it since 0.19.0** (decision 165). From 0.14.0 a realm could keep a fifth
 * of its people under arms and not one man more; the owner removed that in favour of the treasury
 * deciding. So the thing these tests pin down has changed: it is no longer that the cap holds, it is
 * that **nothing but the settlement's own population refuses a unit**, and that the men still move
 * between the two halves of the realm's total rather than leaving it.
 */

const world = loadEurope1350();
const roster = loadFactions();
const FRANKS = roster.findIndex((f) => f.id === 'franks');

const LIGHT_INFANTRY = 100;

let state: SimState;
let paris: CityState;

beforeEach(() => {
  state = createInitialState(world, roster, 'franks', 7);
  paris = state.cities.find((c) => c.ownerIndex === FRANKS)!;
  const faction = state.factions[FRANKS]!;
  for (const resource of ['gold', 'wood', 'iron', 'stone'] as const) {
    faction.stock[resource] = 100_000 * MILLI;
  }
});

describe('manpower', () => {
  it('counts soldiers among the realm’s people, not apart from them', () => {
    // The opening position: one Village of 1,000, and one Light Infantry granted in its garrison.
    expect(paris.population).toBe(1000);
    expect(manpowerUnderArms(state, FRANKS)).toBe(LIGHT_INFANTRY);
    expect(realmPeople(state, FRANKS)).toBe(1000 + LIGHT_INFANTRY);
  });

  it('moves men from the fields to the field, leaving the realm the same size', () => {
    const before = realmPeople(state, FRANKS);
    expect(queueUnit(state, paris, 'light_infantry')).toEqual({ ok: true });

    // The men came off the population and went under arms. The realm has exactly as many people
    // as it did a moment ago — which is what makes `armedSharePermille` a meaningful reading.
    expect(paris.population).toBe(1000 - LIGHT_INFANTRY);
    expect(manpowerUnderArms(state, FRANKS)).toBe(2 * LIGHT_INFANTRY);
    expect(realmPeople(state, FRANKS)).toBe(before);
  });

  it('counts men still in training, because they were levied when the order went out', () => {
    queueUnit(state, paris, 'light_infantry');
    expect(paris.recruitQueue).toHaveLength(1);
    expect(paris.garrison['light_infantry']).toBe(1);
    expect(manpowerUnderArms(state, FRANKS)).toBe(2 * LIGHT_INFANTRY);
  });

  it('gives the men back when an order is cancelled', () => {
    queueUnit(state, paris, 'light_infantry');
    cancelProduction(state, paris, 'recruit', 0);

    // Men called up but never marched go back to their fields, exactly as their gold goes back
    // to the treasury.
    expect(manpowerUnderArms(state, FRANKS)).toBe(LIGHT_INFANTRY);
    expect(paris.population).toBe(1000);
  });
});

/**
 * **The ceiling is gone** — owner-specified in 0.19.0, decision 165.
 *
 * The old rule refused the third Light Infantry a starting Village tried to raise, at 220 men of
 * 1,100. These are the tests that would have caught it coming back.
 */
describe('no ceiling on an army but the people to make it of', () => {
  it('raises an army far past the fifth the old rule allowed', () => {
    paris.population = 10_000;

    // Twenty Light Infantry is 2,000 men out of a realm of roughly ten thousand — comfortably
    // past the 20% that used to be a hard wall, and refused by none of it.
    for (let i = 0; i < 20; i++) {
      expect(queueUnit(state, paris, 'light_infantry')).toEqual({ ok: true });
    }
    expect(manpowerUnderArms(state, FRANKS)).toBe(21 * LIGHT_INFANTRY);
    expect(armedSharePermille(state, FRANKS)).toBeGreaterThan(200);
  });

  it('refuses only when the settlement itself has no more men to give', () => {
    paris.population = 10_000;
    // Levy until something stops it. The only thing that may is the settlement's own floor.
    let refusal: unknown;
    for (let i = 0; i < 500; i++) {
      const result = queueUnit(state, paris, 'light_infantry');
      if (!result.ok) {
        refusal = result;
        break;
      }
    }

    expect(refusal).toEqual({ ok: false, reason: 'too-few-people' });
    // Levied down to the floor and no further, and the realm is now mostly soldiers.
    expect(availableManpower(paris)).toBeLessThan(LIGHT_INFANTRY);
    expect(paris.population).toBeGreaterThanOrEqual(MIN_POPULATION);
    expect(armedSharePermille(state, FRANKS)).toBeGreaterThan(900);
  });

  it('lifts the same ceiling off hulls, which drew on the same fifth', () => {
    // A Dock, and a coastal settlement to put it on. Crews counted against the ceiling from
    // 0.18.0 (decision 127), so removing it has to free the navy too.
    const port = state.cities.find((c) => c.ownerIndex === FRANKS)!;
    port.population = 10_000;
    port.buildings.push('dock');

    for (let i = 0; i < 20; i++) {
      expect(queueShip(state, port, 'transport')).toEqual({ ok: true });
    }
    // Twenty Transports at forty crew apiece, plus the starting infantry.
    expect(manpowerUnderArms(state, FRANKS)).toBe(20 * 40 + LIGHT_INFANTRY);
  });

  it('reports the share under arms rather than a cap to measure against', () => {
    paris.population = 900;
    // 100 men under arms in a realm of 1,000 souls.
    expect(realmPeople(state, FRANKS)).toBe(1000);
    expect(armedSharePermille(state, FRANKS)).toBe(100);

    expect(armedSharePermille(state, roster.findIndex((f) => f.neutral))).toBe(0);
  });

  it('still costs a unit its whole size in people', () => {
    // The owner kept this when the ceiling went: the limit moved to the wage bill, but the price
    // in people did not change. It is what stops the treasury being the *only* constraint.
    expect(unitById('light_infantry')?.size).toBe(LIGHT_INFANTRY);
    const before = paris.population;
    queueUnit(state, paris, 'light_infantry');
    expect(paris.population).toBe(before - LIGHT_INFANTRY);
  });
});
