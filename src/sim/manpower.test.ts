import { beforeEach, describe, expect, it } from 'vitest';
import { loadFactions } from '../data/factions';
import { loadEurope1350 } from '../data/maps';
import { unitById } from '../data/units';
import { queueUnit, cancelProduction } from './construction';
import {
  canRaise,
  freeManpower,
  manpowerCap,
  manpowerUnderArms,
  MANPOWER_SHARE_PERMILLE,
  realmPeople,
} from './manpower';
import { createInitialState } from './state';
import { MILLI, type CityState, type SimState } from './types';

/**
 * The manpower ceiling — docs/MECHANICS.md §5.
 *
 * The rule is one line: a realm may keep a fifth of its people under arms. What these tests are
 * really pinning down is the thing that makes the rule behave — that a recruit **moves** between
 * the two halves of the total rather than leaving it, so the cap does not move when a unit is
 * raised. Get that wrong and the realm quietly settles at a sixth instead of a fifth.
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
    expect(manpowerCap(state, FRANKS)).toBe(220); // 20% of 1,100
  });

  it('does not move the cap when a unit is raised', () => {
    const before = manpowerCap(state, FRANKS);
    expect(queueUnit(state, paris, 'light_infantry')).toEqual({ ok: true });

    // The men came off the population and went under arms. The realm has exactly as many people
    // as it did a moment ago, so the fifth it may keep in the field is unchanged — this is the
    // whole reason the rule reads as 20% rather than as some smaller number nobody chose.
    expect(paris.population).toBe(1000 - LIGHT_INFANTRY);
    expect(manpowerUnderArms(state, FRANKS)).toBe(2 * LIGHT_INFANTRY);
    expect(realmPeople(state, FRANKS)).toBe(1100);
    expect(manpowerCap(state, FRANKS)).toBe(before);
  });

  it('counts men still in training, so a queue cannot outrun the cap', () => {
    queueUnit(state, paris, 'light_infantry');
    // Ordered, not yet trained — but levied, and therefore already under arms.
    expect(paris.recruitQueue).toHaveLength(1);
    expect(paris.garrison['light_infantry']).toBe(1);
    expect(manpowerUnderArms(state, FRANKS)).toBe(2 * LIGHT_INFANTRY);
  });

  it('refuses the unit that would take the realm over its ceiling', () => {
    // Room for one more at the opening, and no more than one: 220 allowed, 100 standing.
    expect(freeManpower(state, FRANKS)).toBe(120);
    expect(queueUnit(state, paris, 'light_infantry')).toEqual({ ok: true });

    expect(freeManpower(state, FRANKS)).toBe(20);
    expect(canRaise(state, FRANKS, LIGHT_INFANTRY)).toBe(false);
    expect(queueUnit(state, paris, 'light_infantry')).toEqual({
      ok: false,
      reason: 'no-manpower',
    });
  });

  it('gives the room back when an order is cancelled', () => {
    const before = freeManpower(state, FRANKS);
    queueUnit(state, paris, 'light_infantry');
    cancelProduction(state, paris, 'recruit', 0);

    // Men called up but never marched go back to their fields, exactly as their gold goes back
    // to the treasury.
    expect(freeManpower(state, FRANKS)).toBe(before);
    expect(manpowerUnderArms(state, FRANKS)).toBe(LIGHT_INFANTRY);
  });

  it('raises the ceiling with conquest, which is the only fast way to raise it', () => {
    const before = manpowerCap(state, FRANKS);
    const prize = state.cities.find((c) => c.ownerIndex !== FRANKS)!;
    prize.population = 4000;
    prize.ownerIndex = FRANKS;

    expect(manpowerCap(state, FRANKS)).toBe(before + 800); // 20% of 4,000
    expect(canRaise(state, FRANKS, LIGHT_INFANTRY)).toBe(true);
  });

  it('clamps to zero rather than going negative when a realm shrinks', () => {
    // Losing land can leave more men standing than the realm may now keep. Nothing is disbanded
    // — the ceiling gates recruitment, it does not conscript backwards. See OPEN-QUESTIONS.
    paris.population = 100;
    expect(manpowerUnderArms(state, FRANKS)).toBeGreaterThan(manpowerCap(state, FRANKS));
    expect(freeManpower(state, FRANKS)).toBe(0);
    expect(canRaise(state, FRANKS, 1)).toBe(false);
  });

  it('is the share the constant says it is', () => {
    // Guards the one number, and the arithmetic around it, against a silent retune.
    paris.population = 10_000;
    const people = realmPeople(state, FRANKS);
    expect(manpowerCap(state, FRANKS)).toBe(
      Math.floor((people * MANPOWER_SHARE_PERMILLE) / 1000),
    );
    expect(unitById('light_infantry')?.size).toBe(LIGHT_INFANTRY);
  });
});
