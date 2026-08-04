import { describe, expect, it } from 'vitest';
import { buildingsForTier, loadBuildings } from '../data/buildings';
import { loadFactions } from '../data/factions';
import { baseTileYield } from '../data/improvements';
import { terrainAt } from '../data/world';
import { loadEurope1350 } from '../data/maps';
import { calendarAt, TICKS_PER_MONTH } from './calendar';
import { createInitialState, STARTING_GOLD, STARTING_POPULATION, taxedGold } from './state';
import { advanceBy, cityGrowth, wealthGrowth } from './tick';
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
      expect(city.population).toBe(STARTING_POPULATION);
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

    // 1,000 population yields 10, and every held land tile yields its terrain's base gold.
    let held = 0;
    let tileGold = 0;
    state.tileOwner.forEach((owner, index) => {
      if (owner !== state.playerFactionIndex) return;
      held++;
      tileGold += baseTileYield(terrainAt(world, index % world.width, Math.floor(index / world.width))).gold;
    });
    // Halved by the tax rate (`GOLD_INCOME_PERMILLE`), which lands on gross income, and then
    // less the starting Light Infantry's 10 gold of upkeep, which is a wage and is paid in full.
    expect(monthly).toBe(taxedGold(10 + tileGold) - 10);
    expect(held).toBeGreaterThan(1);

    const before = player.stock.gold;
    advanceBy(state, world, TICKS_PER_MONTH);
    expect(player.stock.gold - before).toBe(monthly * MILLI);
  });

  it('grows population by the documented rate on the month boundary', () => {
    const state = newState();
    const city = state.cities.find((c) => c.ownerIndex === state.playerFactionIndex)!;

    advanceBy(state, world, TICKS_PER_MONTH - 1);
    expect(city.population).toBe(STARTING_POPULATION);

    // Growth is a flat count of people, never a percentage. A fresh Village with nothing built
    // gains 2 for existing and 3 for its tier; Wooden Houses is what takes it to 15.
    advanceBy(state, world, 1);
    expect(city.population).toBe(STARTING_POPULATION + 5);
  });

  // Housing and halls accumulate: a settlement with three of them standing has all three.
  it('adds up the housing and hall lines, in whole people', () => {
    const state = newState();
    const city = state.cities.find((c) => c.ownerIndex === state.playerFactionIndex)!;

    const rate = () => cityGrowth(state, city);
    expect(rate()).toBe(5); // 2 base + 3 for a Village

    city.buildings.push('wooden_houses');
    expect(rate()).toBe(15); // +10
    city.buildings.push('stone_houses');
    expect(rate()).toBe(30); // +15
    city.buildings.push('villas');
    expect(rate()).toBe(55); // +25
    city.buildings.push('manors');
    expect(rate()).toBe(95); // +40

    city.buildings.push('town_hall');
    expect(rate()).toBe(103); // +8
    city.buildings.push('city_hall');
    expect(rate()).toBe(115); // +12
    city.buildings.push('palace');
    expect(rate()).toBe(135); // +20
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
  it('pays a flat five, ten or fifteen people by decade of wealth', () => {
    expect(wealthGrowth(10_000)).toBe(5);
    expect(wealthGrowth(100_000)).toBe(10);
    expect(wealthGrowth(1_000_000)).toBe(15);
  });

  it('pays nothing below the first threshold and never exceeds the cap', () => {
    expect(wealthGrowth(0)).toBe(0);
    expect(wealthGrowth(9_999)).toBe(0);
    expect(wealthGrowth(250)).toBe(0);
    expect(wealthGrowth(50_000_000)).toBe(15);
  });

  // Debt costs exactly what wealth gains.
  it('mirrors itself into debt', () => {
    for (const gold of [1_000, 9_999, 10_000, 55_000, 100_000, 1_000_000, 9_000_000]) {
      // Stated as a sum rather than a negation, so a zero band cannot fail on -0 vs 0.
      expect(wealthGrowth(-gold) + wealthGrowth(gold), `at ±${gold}`).toBe(0);
    }
    expect(wealthGrowth(-9_999)).toBe(0);
    expect(wealthGrowth(-50_000_000)).toBe(-15);
  });

  it('never decreases as the treasury grows', () => {
    let previous = 0;
    for (const gold of [0, 1_000, 5_000, 9_999, 10_000, 55_000, 99_999, 100_000, 500_000, 1_000_000]) {
      const current = wealthGrowth(gold);
      expect(current, `at ${gold} gold`).toBeGreaterThanOrEqual(previous);
      previous = current;
    }
  });

  /** The whole reason for the change: flat growth is bounded by time, not by a rate. */
  it('cannot run away, however long a campaign runs', () => {
    const state = newState();
    const city = state.cities.find((c) => c.ownerIndex === state.playerFactionIndex)!;

    // Built out to the **maximum growth a settlement can ever reach** — top tier, every housing
    // level and every hall, and a treasury in the highest wealth band. The ceiling rather than
    // today's rate, because a century is long enough for the settlement to change hands and its
    // new owner to keep building, and nothing either of them can do may raise it further.
    city.tier = 4;
    city.buildings.push(
      'wooden_houses',
      'stone_houses',
      'villas',
      'manors',
      'town_hall',
      'city_hall',
      'palace',
    );
    for (const faction of state.factions) faction.stock.gold = 10_000_000 * MILLI;

    const ceiling = cityGrowth(state, city);
    advanceBy(state, world, TICKS_PER_MONTH * 12 * 100);

    // A century at the best rate any settlement can reach, and not one person more.
    expect(city.population).toBeLessThanOrEqual(STARTING_POPULATION + ceiling * 12 * 100);
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
