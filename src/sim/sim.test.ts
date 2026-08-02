import { describe, expect, it } from 'vitest';
import { buildingsForTier, loadBuildings } from '../data/buildings';
import { loadFactions } from '../data/factions';
import { BASE_TILE_GOLD } from '../data/improvements';
import { loadEurope1350 } from '../data/maps';
import { calendarAt, TICKS_PER_MONTH } from './calendar';
import { createInitialState, STARTING_GOLD, STARTING_POPULATION } from './state';
import { advanceBy, wealthGrowthTenths } from './tick';
import { MILLI, whole, type SimState } from './types';

const world = loadEurope1350();
const roster = loadFactions();
const newState = (): SimState => createInitialState(world, roster, 'franks', 12345);

describe('calendar', () => {
  it('starts in January 1350, first day, first phase', () => {
    const date = calendarAt(0);
    expect(date).toMatchObject({
      year: 1350,
      monthName: 'January',
      day: 1,
      phase: 'Night',
      season: 'winter',
    });
  });

  it('advances four phases per day and thirty days per month', () => {
    expect(calendarAt(3).day).toBe(1);
    expect(calendarAt(4).day).toBe(2);
    expect(calendarAt(TICKS_PER_MONTH - 1)).toMatchObject({ day: 30, monthName: 'January' });
    expect(calendarAt(TICKS_PER_MONTH)).toMatchObject({ day: 1, monthName: 'February' });
  });

  it('rolls the year after twelve months', () => {
    expect(calendarAt(TICKS_PER_MONTH * 12)).toMatchObject({ year: 1351, monthName: 'January' });
  });

  it('assigns seasons, with winter wrapping across the year boundary', () => {
    const seasonOfMonth = (m: number) => calendarAt(TICKS_PER_MONTH * m).season;
    expect(seasonOfMonth(0)).toBe('winter'); // January
    expect(seasonOfMonth(3)).toBe('spring'); // April
    expect(seasonOfMonth(6)).toBe('summer'); // July
    expect(seasonOfMonth(9)).toBe('autumn'); // October
    expect(seasonOfMonth(11)).toBe('winter'); // December
  });
});

describe('initial state', () => {
  const state = newState();

  it('gives every faction its capital, and the neutral faction the rest', () => {
    const withCapitals = roster.filter((f) => f.capital !== null);
    for (const faction of withCapitals) {
      const index = roster.indexOf(faction);
      const owned = state.cities.filter((c) => c.ownerIndex === index);
      expect(owned, `${faction.name} should hold exactly one city`).toHaveLength(1);
      expect(world.cities[owned[0]!.cityIndex]?.name).toBe(faction.capital);
    }

    const neutralIndex = roster.findIndex((f) => f.neutral);
    const neutralCities = state.cities.filter((c) => c.ownerIndex === neutralIndex);
    expect(neutralCities).toHaveLength(world.cities.length - withCapitals.length);
    expect(neutralCities).toHaveLength(47);
  });

  it('opens every faction as a Village with 250 gold and 1,000 people', () => {
    const franks = state.factions[state.playerFactionIndex]!;
    expect(whole(franks.stock.gold)).toBe(STARTING_GOLD);
    for (const city of state.cities) {
      expect(city.tier).toBe(1);
      expect(city.populationMilli).toBe(STARTING_POPULATION * MILLI);
    }
  });

  it('claims the capital tile plus its land neighbours, never open water', () => {
    const parisIndex = world.cities.findIndex((c) => c.name === 'Paris');
    const paris = world.cities[parisIndex]!;
    const frankIndex = roster.findIndex((f) => f.id === 'franks');
    expect(state.tileOwner[paris.index]).toBe(frankIndex);

    const claimed = [...state.tileOwner].filter((o) => o === frankIndex).length;
    expect(claimed).toBeGreaterThan(1);
    expect(claimed).toBeLessThanOrEqual(5);
  });
});

describe('economy', () => {
  it('pays exactly one month of income over one month of ticks', () => {
    const state = newState();
    const player = state.factions[state.playerFactionIndex]!;
    const monthly = player.monthlyIncome.gold;

    // 1,000 population yields 10, and every held land tile yields its base gold on top.
    const held = [...state.tileOwner].filter((o) => o === state.playerFactionIndex).length;
    expect(monthly).toBe(10 + held * BASE_TILE_GOLD);
    expect(held).toBeGreaterThan(1);

    const before = player.stock.gold;
    advanceBy(state, world, TICKS_PER_MONTH);
    expect(player.stock.gold - before).toBe(monthly * MILLI);
  });

  it('grows population by the documented rate on the month boundary', () => {
    const state = newState();
    const city = state.cities.find((c) => c.ownerIndex === state.playerFactionIndex)!;

    advanceBy(state, world, TICKS_PER_MONTH - 1);
    expect(city.populationMilli).toBe(STARTING_POPULATION * MILLI);

    // A fresh Village has no housing built, so growth is 0.1% base + 0.1% city level = 0.2%.
    // Putting up Wooden Houses is what takes it to 0.3%.
    advanceBy(state, world, 1);
    expect(city.populationMilli).toBe(1_002_000);
  });

  it('never loses income to rounding across a year', () => {
    const state = newState();
    const player = state.factions[state.playerFactionIndex]!;
    advanceBy(state, world, TICKS_PER_MONTH * 12);
    // Income rises as population does, so assert the invariant that matters: the carry never
    // strands more than one tick's worth of value.
    expect(player.carry.gold).toBeLessThan(TICKS_PER_MONTH);
    expect(whole(player.stock.gold)).toBeGreaterThan(STARTING_GOLD);
  });
});

describe('wealth growth bonus', () => {
  it('hits the owner-stated anchors exactly', () => {
    expect(wealthGrowthTenths(10_000)).toBe(10); // +1.0%
    expect(wealthGrowthTenths(100_000)).toBe(20); // +2.0%
    expect(wealthGrowthTenths(1_000_000)).toBe(30); // +3.0%
  });

  it('pays nothing below the first threshold and never exceeds the cap', () => {
    expect(wealthGrowthTenths(0)).toBe(0);
    expect(wealthGrowthTenths(999)).toBe(0);
    expect(wealthGrowthTenths(250)).toBe(0);
    expect(wealthGrowthTenths(50_000_000)).toBe(30);
  });

  it('never decreases as the treasury grows', () => {
    let previous = 0;
    for (const gold of [0, 1_000, 5_000, 9_999, 10_000, 55_000, 99_999, 100_000, 500_000, 1_000_000]) {
      const current = wealthGrowthTenths(gold);
      expect(current, `at ${gold} gold`).toBeGreaterThanOrEqual(previous);
      previous = current;
    }
  });
});

describe('buildings catalogue', () => {
  it('loads and validates', () => {
    const all = loadBuildings();
    expect(all.length).toBeGreaterThan(0);
    expect(buildingsForTier(1).every((b) => b.minTier === 1)).toBe(true);
    expect(buildingsForTier(4).length).toBe(all.length);
  });

  it('gates the commerce chain by settlement tier', () => {
    const commerce = loadBuildings().filter((b) => b.line === 'commerce');
    expect(commerce).toHaveLength(4);
    for (const building of commerce) {
      expect(building.minTier).toBe(building.level);
    }
  });
});

describe('determinism', () => {
  it('produces identical state from identical ticks, however they are batched', () => {
    const a = newState();
    const b = newState();

    advanceBy(a, world, 1000);
    for (let i = 0; i < 100; i++) advanceBy(b, world, 10);

    expect(a.tick).toBe(1000);
    expect(snapshot(a)).toEqual(snapshot(b));
  });
});

/** Everything a save would contain, in a comparable form. */
function snapshot(state: SimState) {
  return {
    tick: state.tick,
    rng: state.rng,
    factions: state.factions.map((f) => ({ ...f, stock: { ...f.stock }, carry: { ...f.carry } })),
    cities: state.cities.map((c) => ({ ...c })),
    tileOwner: [...state.tileOwner],
  };
}
