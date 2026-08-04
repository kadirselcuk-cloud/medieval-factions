import { beforeEach, describe, expect, it } from 'vitest';
import { loadFactions } from '../data/factions';
import { loadEurope1350 } from '../data/maps';
import { tileIndex } from '../data/world';
import { mobilise } from './armies';
import { TICKS_PER_MONTH } from './calendar';
import { orderMove } from './movement';
import { deserialise, migrate, serialise, type SaveFile } from './save';
import { createInitialState } from './state';
import { advanceBy } from './tick';
import type { CityState, SimState } from './types';
import { BASE_SIGHT, KNOWN_RANGE, rememberGround, visibleTiles } from './vision';

/**
 * Fog of war — docs/MECHANICS.md §9.
 *
 * Three states, and the interesting one is the middle: ground the realm has seen before and no
 * longer can. That is the only part of fog that has to be remembered rather than derived, so it is
 * the only part that can be lost — on a reload, on a migration, or by an army walking away from a
 * tile a moment before the month rolls over. These tests are aimed squarely at that.
 */

const world = loadEurope1350();
const roster = loadFactions();
const FRANKS = roster.findIndex((f) => f.id === 'franks');

let state: SimState;
let paris: CityState;

beforeEach(() => {
  state = createInitialState(world, roster, 'franks', 7);
  paris = state.cities.find((c) => c.ownerIndex === FRANKS)!;
});

const at = (x: number, y: number): number => tileIndex(world, x, y);
const cityX = (city: CityState): number => city.tileIndex % world.width;
const cityY = (city: CityState): number => Math.floor(city.tileIndex / world.width);

describe('fog of war', () => {
  it('sees by walking distance, not in a square', () => {
    // The owner's shape: sight reaches its full radius along each axis and tapers to a point
    // diagonally, because armies move orthogonally and so does knowledge.
    //
    // Measured around a lone army far from the realm. Testing it around Paris would prove
    // nothing — the capital's four owned neighbours each cast sight of their own, so the union
    // of five overlapping diamonds is not a diamond.
    const x = cityX(paris);
    const y = cityY(paris);
    state.armies.push({
      id: state.nextArmyId++,
      ownerIndex: FRANKS,
      tileIndex: at(x + 20, y),
      units: { light_infantry: 1 },
      path: [],
      march: 0,
      role: 'field',
    });

    const seen = visibleTiles(state, world, FRANKS);
    const ax = x + 20;
    const inSight = (dx: number, dy: number) => seen[at(ax + dx, y + dy)];

    expect(inSight(BASE_SIGHT, 0)).toBe(1); // straight out, the full radius
    expect(inSight(0, BASE_SIGHT)).toBe(1);
    expect(inSight(-BASE_SIGHT, 0)).toBe(1);
    expect(inSight(2, 1)).toBe(1); // |dx| + |dy| = 3, just inside
    expect(inSight(2, 2)).toBe(0); // |dx| + |dy| = 4, just outside
    expect(inSight(BASE_SIGHT, BASE_SIGHT)).toBe(0); // the corner a square gave away free

    // And the whole diamond, counted: 2r² + 2r + 1 = 25 at radius 3, against a square's 49.
    let n = 0;
    for (let dy = -BASE_SIGHT; dy <= BASE_SIGHT; dy++) {
      for (let dx = -BASE_SIGHT; dx <= BASE_SIGHT; dx++) {
        if (inSight(dx, dy) === 1) n++;
      }
    }
    expect(n).toBe(2 * BASE_SIGHT * BASE_SIGHT + 2 * BASE_SIGHT + 1);
  });

  it('opens knowing the country around its own settlements, before a single tick', () => {
    const x = cityX(paris);
    const y = cityY(paris);

    // Ten tiles out is known but not seen — the dim band, not the clear one.
    const far = at(Math.min(world.width - 1, x + KNOWN_RANGE), y);
    expect(state.discovered[far]).toBe(1);
    expect(visibleTiles(state, world, FRANKS)[far]).toBe(0);
  });

  it('leaves the far side of the map genuinely unknown', () => {
    const x = cityX(paris);
    // Well beyond the band from any French settlement.
    const away = x > world.width / 2 ? 0 : world.width - 1;
    expect(state.discovered[at(away, cityY(paris))]).toBe(0);
  });

  it('remembers ground an army walked over, after the army has gone', () => {
    const x = cityX(paris);
    const y = cityY(paris);
    // A tile outside the known band entirely, so nothing else can account for it being known.
    const scoutX = Math.min(world.width - 1, x + KNOWN_RANGE + BASE_SIGHT + 2);
    const target = at(scoutX, y);
    expect(state.discovered[target]).toBe(0);

    state.armies.push({
      id: state.nextArmyId++,
      ownerIndex: FRANKS,
      tileIndex: target,
      units: { light_infantry: 1 },
      path: [],
      march: 0,
      role: 'field',
    });
    rememberGround(state, world);
    expect(state.discovered[target]).toBe(1);

    // The army marches home. What it saw is not unlearned — that is the whole point of a memory,
    // and the bug it exists to prevent is a shroud that closes behind a moving army.
    state.armies.length = 0;
    rememberGround(state, world);
    expect(state.discovered[target]).toBe(1);
    expect(visibleTiles(state, world, FRANKS)[target]).toBe(0);
  });

  it('opens new ground as an army marches out past the known band', () => {
    // The end-to-end version, through the real movement code rather than by placing an army.
    // This is the behaviour that gets reported as broken, so it is worth owning as a test: an
    // army must march **11 tiles** clear of a settlement before it reveals anything at all,
    // because the settlement already knows 10 in every direction and the army only sees 3.
    const x = cityX(paris);
    const y = cityY(paris);
    const mine = mobilise(state, world, paris, { light_infantry: 1 });
    expect(mine.ok).toBe(true);

    // Held by id: state.armies holds every faction's armies, so index 0 stops being ours the
    // moment a rival musters one.
    const id = state.armies.find((a) => a.ownerIndex === FRANKS)!.id;
    const count = (): number => state.discovered.reduce((n, bit) => n + bit, 0);

    // The diamond of walking distance 10, and nothing else: 2r² + 2r + 1.
    const opening = count();
    expect(opening).toBe(2 * KNOWN_RANGE * KNOWN_RANGE + 2 * KNOWN_RANGE + 1);

    // Foot crosses a tile every two months, unclaimed ground costs a further 20%, and winter
    // takes 40% off the pace — so clearing a band of 10 is years of marching, not months.
    orderMove(state, world, id, at(Math.min(world.width - 1, x + KNOWN_RANGE + 4), y));
    advanceBy(state, world, TICKS_PER_MONTH * 60);

    const army = state.armies.find((a) => a.id === id);
    expect(army).toBeDefined();
    expect(army!.tileIndex % world.width).toBeGreaterThan(x + KNOWN_RANGE);
    expect(count()).toBeGreaterThan(opening);
  });

  it('is monotonic — losing ground never unlearns its geography', () => {
    advanceBy(state, world, TICKS_PER_MONTH);
    const before = Array.from(state.discovered);

    // Strip the realm to nothing at all.
    state.tileOwner.fill(-1);
    for (const city of state.cities) city.ownerIndex = -1;
    rememberGround(state, world);

    expect(Array.from(state.discovered)).toEqual(before);
  });

  it('survives a save and reload exactly', () => {
    advanceBy(state, world, TICKS_PER_MONTH * 3);
    const reloaded = deserialise(serialise(state));
    expect(Array.from(reloaded.discovered)).toEqual(Array.from(state.discovered));
  });

  it('opens a v6 save on an empty memory rather than an undefined one', () => {
    // A v6 save has no `discovered` key at all, so the field is stripped rather than emptied —
    // an empty array would prove the wrong thing.
    const serialised: Record<string, unknown> = { ...serialise(state) };
    delete serialised['discovered'];

    const file = migrate({
      id: 'test',
      name: 'v6',
      kind: 'manual',
      version: 6,
      tick: state.tick,
      factionId: 'franks',
      mapId: 'europe-1350',
      savedAt: 0,
      state: serialised,
    } as unknown as SaveFile);

    const restored = deserialise(file.state);
    expect(restored.discovered).toHaveLength(world.width * world.height);
    // Nothing is claimed to have been explored, because a v6 save never recorded it. The realm
    // re-learns its own country on the first tick, which is what `loadState` forces.
    expect(Array.from(restored.discovered).every((bit) => bit === 0)).toBe(true);

    rememberGround(restored, world);
    expect(restored.discovered[paris.tileIndex]).toBe(1);
  });
});
