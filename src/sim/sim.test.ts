import { describe, expect, it } from 'vitest';
import { buildingsForTier, loadBuildings } from '../data/buildings';
import { loadFactions } from '../data/factions';
import { baseTileYield } from '../data/improvements';
import { terrainAt } from '../data/world';
import { loadEurope1350 } from '../data/maps';
import { calendarAt, TICKS_PER_MONTH } from './calendar';
import { createInitialState, STARTING_GOLD, STARTING_POPULATION, taxedGold } from './state';
import { advanceBy, cityGrowth, prosperityGrowth } from './tick';
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

/**
 * Growth from **net monthly income** — owner-specified in 0.19.0, decision 164.
 *
 * It replaced growth from the treasury *balance*, which rewarded hoarding: a realm that banked its
 * taxes and built nothing grew as fast as one running a real economy. The bands are marginal, like
 * tax brackets, and the owner authored all four rates and all three thresholds.
 */
describe('prosperity growth', () => {
  it('pays the owner’s schedule at each threshold', () => {
    expect(prosperityGrowth(1_000)).toBe(10); // 1% of the first 1,000
    expect(prosperityGrowth(10_000)).toBe(55); // + 0.5% of the next 9,000
    expect(prosperityGrowth(100_000)).toBe(145); // + 0.1% of the next 90,000
    expect(prosperityGrowth(1_000_000)).toBe(235); // + 0.01% of the next 900,000
  });

  it('treats the bands as marginal, so it never goes backwards at a boundary', () => {
    // The whole reason for reading them this way. Flat-rate-per-band would pay 10 people at 1,000
    // and 5 at 1,001, and every realm near a threshold would want to earn less.
    expect(prosperityGrowth(1_001)).toBeGreaterThanOrEqual(prosperityGrowth(1_000));
    expect(prosperityGrowth(10_001)).toBeGreaterThanOrEqual(prosperityGrowth(10_000));
    expect(prosperityGrowth(100_001)).toBeGreaterThanOrEqual(prosperityGrowth(100_000));

    let previous = 0;
    for (const net of [0, 100, 999, 1_000, 5_000, 10_000, 60_000, 100_000, 500_000, 9_000_000]) {
      const current = prosperityGrowth(net);
      expect(current, `at ${net} net`).toBeGreaterThanOrEqual(previous);
      previous = current;
    }
  });

  it('diminishes — ten times the income is never ten times the people', () => {
    // The property that keeps the population/income feedback loop from compounding: each decade of
    // income buys less than the one before it, so the marginal rate falls even as the total climbs.
    for (const net of [1_000, 10_000, 100_000, 1_000_000]) {
      expect(prosperityGrowth(net * 10), `at ${net} → ${net * 10}`).toBeLessThan(
        10 * prosperityGrowth(net),
      );
    }
  });

  it('pays almost nothing to a realm just getting started', () => {
    // The opening position is a few gold a month, and 1% of a few gold is nobody. Growth early on
    // is the flat terms — base, tier and buildings — exactly as it was.
    expect(prosperityGrowth(0)).toBe(0);
    expect(prosperityGrowth(99)).toBe(0);
    expect(prosperityGrowth(100)).toBe(1);
  });

  // Debt costs exactly what income gains — which is what makes the army self-limiting now that
  // there is no manpower ceiling: wages come off net income, and negative net income shrinks towns.
  it('mirrors itself into debt', () => {
    for (const net of [100, 999, 1_000, 55_000, 100_000, 1_000_000, 9_000_000]) {
      // Stated as a sum rather than a negation, so a zero band cannot fail on -0 vs 0.
      expect(prosperityGrowth(-net) + prosperityGrowth(net), `at ±${net}`).toBe(0);
    }
    expect(prosperityGrowth(-1_000_000)).toBe(-235);
  });

  /**
   * **The property 0.11.0 bought and this must not sell back.**
   *
   * Growth is no longer purely flat: income is derived from population, so population feeds itself
   * and the model compounds in principle. What stops it being the old half-a-trillion runaway is
   * the shape of the schedule — the rate falls by a factor of ten at each threshold, so the loop
   * is roughly logarithmic rather than exponential. This is the test that says so.
   */
  it('cannot run away, however long a campaign runs', () => {
    const state = newState();
    const city = state.cities.find((c) => c.ownerIndex === state.playerFactionIndex)!;

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

    // What the settlement would reach on its **flat terms alone** — base, tier and buildings, with
    // the income term contributing nothing. Measured before the century so the comparison is against
    // a fixed line rather than a moving one.
    state.factions[state.playerFactionIndex]!.monthlyIncome.gold = 0;
    const flat = cityGrowth(state, city);
    advanceBy(state, world, TICKS_PER_MONTH * 12 * 100);

    // A century of the best-built settlement in the game, against a century of pure flat growth.
    // The income term is allowed to add to it — that is what it is for — but it must stay the
    // **smaller** part, which is what says the feedback loop is logarithmic and not exponential.
    // The old compounding model reached 531 trillion from a worse starting point than this.
    expect(city.population).toBeGreaterThan(STARTING_POPULATION);
    expect(city.population).toBeLessThan(2 * (STARTING_POPULATION + flat * 12 * 100));
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

/**
 * A realm with no city for two years dissolves — owner-specified in 0.18.7.
 *
 * `updateLiveness` only finishes a realm that has lost **both** its cities and its armies, so one
 * reduced to a single wandering stack stayed on the books for ever: holding nothing, building
 * nothing, recruiting nothing, and still counted among the living. Campaign probes routinely showed
 * realms sitting at zero cities two centuries in.
 */
describe('a landless realm dissolves', () => {
  const world = loadEurope1350();
  const roster = loadFactions();

  /**
   * The **player's** realm is stripped, not a rival's.
   *
   * The first version of this test took Italy's one city away and left it an army — and the
   * Italians promptly stormed a village back by month six, resetting the clock. That is the rule
   * working exactly as intended and useless as a fixture. The player's realm has no AI, so it takes
   * no action of its own and stays landless until the test says otherwise.
   */
  const victim = roster.findIndex((f) => f.id === 'franks');

  /** A campaign with one realm stripped of its cities but left an army in the field. */
  const orphaned = () => {
    const state = createInitialState(world, roster, 'franks', 4242);
    const neutral = roster.findIndex((f) => f.neutral);
    for (const city of state.cities) {
      if (city.ownerIndex === victim) city.ownerIndex = neutral;
    }
    // Funded on purpose. A realm with no cities has no income, and an unpaid army deserts at 10% a
    // month — it would be gone well inside two years and this would be testing desertion instead.
    state.factions[victim]!.stock.gold = 10_000_000 * MILLI;

    // And parked on unclaimed ground, for the same reason: winter kills 10% a month of an army
    // standing on a **rival's** territory, which finished this one off by month thirteen.
    const refuge = state.cities[0]!.tileIndex + 1;
    state.tileOwner[refuge] = -1;
    state.armies.push({
      id: state.nextArmyId++,
      ownerIndex: victim,
      tileIndex: refuge,
      units: { light_infantry: 3 },
      path: [],
      march: 0,
      role: 'field',
    });
    return state;
  };

  it('holds on for the first two years, then strikes the armies off', () => {
    const state = orphaned();

    // A year and a half in: still alive, still counting.
    advanceBy(state, world, TICKS_PER_MONTH * 18);
    expect(state.factions[victim]?.alive).toBe(true);
    expect(state.factions[victim]?.cityless).toBeGreaterThan(0);
    expect(state.armies.some((a) => a.ownerIndex === victim)).toBe(true);

    // Past two years: the last soldiers go home and the realm goes with them.
    advanceBy(state, world, TICKS_PER_MONTH * 10);
    expect(state.armies.some((a) => a.ownerIndex === victim)).toBe(false);
    expect(state.factions[victim]?.alive).toBe(false);
  });

  it('resets the clock the moment it holds a city again', () => {
    const state = orphaned();
    advanceBy(state, world, TICKS_PER_MONTH * 12);
    expect(state.factions[victim]?.cityless).toBeGreaterThan(0);

    // A comeback: it storms somewhere back.
    state.cities[0]!.ownerIndex = victim;
    advanceBy(state, world, TICKS_PER_MONTH);

    expect(state.factions[victim]?.cityless).toBe(0);
    expect(state.factions[victim]?.alive).toBe(true);
  });
});
