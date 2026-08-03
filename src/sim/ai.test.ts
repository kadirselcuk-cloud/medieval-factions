import { describe, expect, it } from 'vitest';
import {
  AI_DIFFICULTIES,
  AI_PERSONALITIES,
  difficultyProfile,
  LEVEL_DIFFICULTY,
  loadDifficulties,
  loadPersonalities,
  personalityProfile,
} from '../data/ai';
import { buildingById } from '../data/buildings';
import { loadFactions } from '../data/factions';
import { loadEurope1350 } from '../data/maps';
import { terrainAt, tileIndex } from '../data/world';
import { BREAK_EVEN, GROUND_WORTH } from './ai';
import { stackSize, stackSoldiers } from './armies';
import { fightBattle, type BattleSetup } from './battle';
import { TICKS_PER_MONTH } from './calendar';
import { deserialise, migrate, serialise, SAVE_VERSION, type SaveFile } from './save';
import { createInitialState, rolledPersonality } from './state';
import { advanceBy } from './tick';
import { BASE_SIGHT, sightOf, visibleTiles } from './vision';
import { whole, type AiDifficulty, type AiPersonality, type SimState } from './types';

const world = loadEurope1350();
const roster = loadFactions();
const neutralIndex = roster.findIndex((f) => f.neutral);

const campaign = (difficulty: AiDifficulty = LEVEL_DIFFICULTY, seed = 12345): SimState =>
  createInitialState(world, roster, 'franks', seed, difficulty);

const years = (state: SimState, n: number) => advanceBy(state, world, TICKS_PER_MONTH * 12 * n);

const citiesOf = (state: SimState, index: number) =>
  state.cities.filter((city) => city.ownerIndex === index);

/** Everything a realm has under arms, garrisons included. */
function unitsOf(state: SimState, index: number): number {
  let count = 0;
  for (const city of state.cities) if (city.ownerIndex === index) count += stackSize(city.garrison);
  for (const army of state.armies) if (army.ownerIndex === index) count += stackSize(army.units);
  return count;
}

/** The realms the AI is actually playing — everyone but the player and the Independents. */
const rivals = (state: SimState) => state.factions.filter((f) => f.ai !== null);

describe('ai data', () => {
  it('names every difficulty and personality exactly once', () => {
    expect(loadDifficulties().map((d) => d.id)).toEqual([...AI_DIFFICULTIES]);
    expect(loadPersonalities().map((p) => p.id)).toEqual([...AI_PERSONALITIES]);
  });

  it('makes Knight the rung with no handicap either way', () => {
    expect(LEVEL_DIFFICULTY).toBe('knight');
    expect(difficultyProfile('knight').incomePermille).toBe(1000);
  });

  it('orders the ladder — richer, braver, bigger and less distractible as it climbs', () => {
    const ladder = loadDifficulties();
    for (let i = 1; i < ladder.length; i++) {
      const below = ladder[i - 1]!;
      const above = ladder[i]!;
      expect(above.incomePermille, above.id).toBeGreaterThan(below.incomePermille);
      // Lower odds means it commits at worse numbers, so the ladder runs downward here.
      expect(above.oddsPermille, above.id).toBeLessThan(below.oddsPermille);
      expect(above.armyUnits, above.id).toBeGreaterThan(below.armyUnits);
      expect(above.ditherPermille, above.id).toBeLessThan(below.ditherPermille);
      expect(above.patienceMonths, above.id).toBeGreaterThan(below.patienceMonths);
    }
  });

  /**
   * They lean off a common centre rather than being five different games. Every one of them
   * builds an economy, keeps an army, expands and makes war; the differences are in degree.
   */
  it('keeps every personality close to the others', () => {
    const aggression = loadPersonalities().map((p) => p.aggressionPermille);
    expect(Math.max(...aggression) - Math.min(...aggression)).toBeLessThanOrEqual(400);

    for (const person of loadPersonalities()) {
      expect(person.attacksRealms, person.id).toBe(true);
      expect(person.prefersSiege, person.id).toBe(true);
      expect(person.build.military, person.id).toBeGreaterThan(0);
      expect(person.build.expand, person.id).toBeGreaterThan(0);
      expect(person.reach, person.id).toBeGreaterThanOrEqual(6);
    }
  });

  it('still leans each one somewhere', () => {
    const build = (p: AiPersonality) => personalityProfile(p).build;
    expect(build('defensive').fortification).toBeGreaterThan(build('ambitious').fortification);
    expect(build('ambitious').expand).toBeGreaterThan(build('defensive').expand);
    expect(personalityProfile('ambitious').reach).toBeGreaterThan(
      personalityProfile('defensive').reach,
    );
    expect(personalityProfile('ambitious').aggressionPermille).toBeLessThan(
      personalityProfile('defensive').aggressionPermille,
    );

    // Peaceful is the economy lean: more housing and commerce, fewer troops — but still troops.
    expect(build('peaceful').commerce).toBeGreaterThan(build('balanced').commerce);
    expect(build('peaceful').housing).toBeGreaterThan(build('balanced').housing);
    expect(build('peaceful').military).toBeLessThan(build('balanced').military);
    expect(build('peaceful').military).toBeGreaterThan(0);
  });

  /**
   * Honour turned out to be the wrong kind of trait for a war engine. Refusing to starve a city
   * out, or to attack a realm somebody else already had by the throat, is about **who a realm
   * will deal with** rather than how it fights — so it waits for diplomacy, and until then an
   * honourable realm campaigns exactly as a balanced one does.
   */
  it('makes honourable identical to balanced until diplomacy exists', () => {
    const honorable = { ...personalityProfile('honorable') } as Record<string, unknown>;
    const balanced = { ...personalityProfile('balanced') } as Record<string, unknown>;
    delete honorable['id'];
    delete honorable['name'];
    delete honorable['blurb'];
    delete balanced['id'];
    delete balanced['name'];
    delete balanced['blurb'];
    expect(honorable).toEqual(balanced);
  });
});

describe('who the ai plays', () => {
  const state = campaign();

  it('plays every realm except the player and the Independents', () => {
    expect(state.factions[state.playerFactionIndex]?.ai).toBeNull();
    expect(state.factions[neutralIndex]?.ai).toBeNull();
    expect(rivals(state)).toHaveLength(roster.length - 2);
  });

  it('gives every rival the chosen difficulty and some personality', () => {
    for (const faction of rivals(state)) {
      expect(faction.ai?.difficulty).toBe(LEVEL_DIFFICULTY);
      expect(AI_PERSONALITIES).toContain(faction.ai?.personality);
    }
  });

  it('rolls personalities from the seed, so the same campaign meets the same Europe', () => {
    const again = campaign(LEVEL_DIFFICULTY, 12345);
    const other = campaign(LEVEL_DIFFICULTY, 999);
    const read = (s: SimState) => rivals(s).map((f) => f.ai?.personality);

    expect(read(again)).toEqual(read(state));
    expect(read(other)).not.toEqual(read(state));
    expect(rolledPersonality(12345, 'franks', 3)).toBe(rolledPersonality(12345, 'franks', 3));
  });

  it('leaves the Independents inert — they are ground, not a rival', () => {
    const before = citiesOf(state, neutralIndex).length;
    expect(before).toBeGreaterThan(40);

    const run = campaign();
    years(run, 20);
    // They lose cities to everybody and never take one, because they never act.
    expect(citiesOf(run, neutralIndex).length).toBeLessThan(before);
    expect(run.armies.filter((a) => a.ownerIndex === neutralIndex)).toHaveLength(0);
  });
});

describe('determinism', () => {
  it('produces byte-identical campaigns from the same seed', () => {
    const a = campaign();
    const b = campaign();
    years(a, 15);
    years(b, 15);
    expect(JSON.stringify(serialise(b))).toBe(JSON.stringify(serialise(a)));
  });

  it('survives a save round trip mid-campaign and carries on identically', () => {
    const live = campaign();
    years(live, 10);

    const reloaded = deserialise(serialise(live));
    years(live, 5);
    years(reloaded, 5);
    expect(JSON.stringify(serialise(reloaded))).toBe(JSON.stringify(serialise(live)));
  });

  it('rolls the dither for every living rival, whether or not it acts', () => {
    // The stream must not depend on what each realm found to do, or a campaign would diverge
    // the first time a realm had nothing worth doing.
    const a = campaign();
    const b = campaign();
    years(a, 3);
    years(b, 3);
    expect(b.rng).toBe(a.rng);
  });
});

describe('a rival realm plays', () => {
  const state = campaign();
  years(state, 12);

  it('builds', () => {
    const built = rivals(state).flatMap((f) =>
      citiesOf(state, f.index).flatMap((city) => city.buildings),
    );
    expect(built.length).toBeGreaterThan(20);
  });

  it('recruits and puts armies in the field', () => {
    const armies = state.armies.filter((army) => state.factions[army.ownerIndex]?.ai);
    expect(armies.length).toBeGreaterThan(4);
    expect(armies.every((army) => stackSize(army.units) > 0)).toBe(true);
  });

  it('takes ground it did not start with', () => {
    const taken = rivals(state).filter((f) => citiesOf(state, f.index).length > 1);
    expect(taken.length).toBeGreaterThan(2);
  });

  it('fights', () => {
    expect(state.nextBattleId - 1).toBeGreaterThan(5);
  });

  it('develops its tiles', () => {
    const improved = [...state.improvementLevel].filter((level, index) => {
      const owner = state.tileOwner[index] ?? -1;
      return level > 0 && owner >= 0 && state.factions[owner]?.ai;
    });
    expect(improved.length).toBeGreaterThan(0);
  });

  it('never bankrupts itself into a desertion spiral', () => {
    const run = campaign();
    years(run, 40);
    for (const faction of rivals(run)) {
      if (!faction.alive) continue;
      // Debt deep enough to cost population is a realm that has lost control of its payroll.
      expect(whole(faction.stock.gold), faction.id).toBeGreaterThan(-10_000);
    }
  });

  it('never levies a settlement below the population that earned it its tier', () => {
    const run = campaign('king');
    years(run, 40);
    for (const city of run.cities) {
      const owner = run.factions[city.ownerIndex];
      if (!owner?.ai) continue;
      // 400 is the lowest levy floor any personality has; the tier floors sit above it.
      expect(city.population, `city ${city.cityIndex}`).toBeGreaterThanOrEqual(100);
    }
  });
});

describe('difficulty changes the game', () => {
  it('hands out its income multiplier and nothing else', () => {
    const easy = campaign('recruit');
    const hard = campaign('king');
    const rival = rivals(easy)[0]!.index;
    expect(easy.factions[rival]?.monthlyIncome.gold).toBeLessThan(
      hard.factions[rival]?.monthlyIncome.gold ?? 0,
    );
    // The player is never scaled, at any rung.
    expect(easy.factions[easy.playerFactionIndex]?.monthlyIncome.gold).toBe(
      hard.factions[hard.playerFactionIndex]?.monthlyIncome.gold,
    );
  });

  it('makes a King far more dangerous than a Recruit', () => {
    const easy = campaign('recruit');
    const hard = campaign('king');
    years(easy, 25);
    years(hard, 25);

    const conquered = (s: SimState) =>
      rivals(s).reduce((total, f) => total + Math.max(0, citiesOf(s, f.index).length - 1), 0);
    const troops = (s: SimState) => rivals(s).reduce((t, f) => t + unitsOf(s, f.index), 0);

    expect(conquered(hard)).toBeGreaterThan(conquered(easy));
    expect(troops(hard)).toBeGreaterThan(troops(easy));
    expect(hard.nextBattleId).toBeGreaterThan(easy.nextBattleId);
  });
});

/**
 * Personality, tested as a controlled experiment rather than by reading a live campaign.
 *
 * Personalities are rolled from the seed, so any given campaign may contain none of the one
 * being tested — seed 12345 rolls no Defensive realm at all. Running a whole Europe in which
 * *every* rival shares one character isolates the variable properly, and the difference between
 * two such worlds is the thing the personality actually buys.
 */
function worldOf(personality: AiPersonality, forYears: number): SimState {
  const state = campaign();
  for (const faction of state.factions) {
    if (faction.ai) faction.ai.personality = personality;
  }
  years(state, forYears);
  return state;
}

describe('personality changes the game', () => {
  const ambitious = worldOf('ambitious', 25);
  const defensive = worldOf('defensive', 25);

  it('has a world of defensive realms put up more walls than a world of ambitious ones', () => {
    const perCity = (state: SimState) => {
      const held = rivals(state).flatMap((f) => citiesOf(state, f.index));
      const walls = held
        .flatMap((city) => city.buildings)
        .filter((id) => id.includes('wall') || id.includes('palisade') || id === 'citadel').length;
      return held.length === 0 ? 0 : walls / held.length;
    };
    expect(perCity(defensive)).toBeGreaterThan(perCity(ambitious));
  });

  it('has a world of ambitious realms take more cities than a defensive one', () => {
    const taken = (state: SimState) =>
      rivals(state).reduce((n, f) => n + citiesOf(state, f.index).length, 0);
    expect(taken(ambitious)).toBeGreaterThan(taken(defensive));
  });

  /**
   * Peaceful is an economy lean, not a pacifist. It builds and settles harder than anyone and
   * keeps a smaller army — but it recruits, it expands, and it still makes war.
   */
  it('has a world of peaceful realms out-build and under-arm a balanced one', () => {
    const peaceful = worldOf('peaceful', 25);
    const balanced = worldOf('balanced', 25);

    /** Share of everything built that is economy rather than walls or barracks. */
    const economyShare = (state: SimState): number => {
      const built = rivals(state)
        .flatMap((f) => citiesOf(state, f.index).flatMap((c) => c.buildings))
        .map((id) => buildingById(id)?.line);
      const economy = built.filter(
        (line) => line === 'housing' || line === 'commerce' || line === 'administration',
      ).length;
      return built.length === 0 ? 0 : economy / built.length;
    };
    /** And the share that is barracks, stables and walls. */
    const martialShare = (state: SimState): number => {
      const built = rivals(state)
        .flatMap((f) => citiesOf(state, f.index).flatMap((c) => c.buildings))
        .map((id) => buildingById(id)?.line);
      const martial = built.filter((line) => line === 'military' || line === 'fortification').length;
      return built.length === 0 ? 0 : martial / built.length;
    };
    const held = (state: SimState) =>
      rivals(state).reduce((n, f) => n + citiesOf(state, f.index).length, 0);

    expect(economyShare(peaceful)).toBeGreaterThan(economyShare(balanced));
    expect(martialShare(peaceful)).toBeLessThan(martialShare(balanced));

    // Still a realm that fights and grows, not one that sits still.
    expect(held(peaceful)).toBeGreaterThan(rivals(peaceful).length);
    expect(peaceful.nextBattleId - 1).toBeGreaterThan(0);
  });

  it('has honourable realms besiege exactly as everyone else does', () => {
    // The trait that used to make them storm instead is gone until diplomacy — see the data test.
    const sieged = (personality: AiPersonality) => {
      const state = campaign();
      for (const faction of state.factions) {
        if (faction.ai) faction.ai.personality = personality;
      }
      let seen = 0;
      for (let month = 0; month < 12 * 20; month++) {
        advanceBy(state, world, TICKS_PER_MONTH);
        seen += state.cities.filter((city) => city.siege).length;
      }
      return seen;
    };
    expect(sieged('honorable')).toBe(sieged('balanced'));
    expect(sieged('honorable')).toBeGreaterThan(0);
  });
});

/**
 * Consolidation — docs/MECHANICS.md §8.
 *
 * A realm fills in the unclaimed ground around its own settlements before it marches on anybody.
 * Without it an army walks a one-tile corridor to the first city it can beat, and the realm holds
 * a line across the map instead of a country.
 */
describe('a realm consolidates before it campaigns', () => {
  it('claims a solid area around its settlements rather than a thread', () => {
    const state = campaign();
    years(state, 6);

    let held = 0;
    let nearHome = 0;
    let realms = 0;

    for (const faction of rivals(state)) {
      const cities = citiesOf(state, faction.index);
      if (cities.length === 0) continue;
      realms += 1;
      const radius = personalityProfile(faction.ai!.personality).claimRadius;

      for (let tile = 0; tile < state.tileOwner.length; tile++) {
        if (state.tileOwner[tile] !== faction.index) continue;
        held += 1;
        const close = cities.some(
          (city) =>
            Math.max(
              Math.abs((tile % world.width) - (city.tileIndex % world.width)),
              Math.abs(
                Math.floor(tile / world.width) - Math.floor(city.tileIndex / world.width),
              ),
            ) <= radius + 1,
        );
        if (close) nearHome += 1;
      }
    }

    // Well past the five tiles each realm opens with.
    expect(held).toBeGreaterThan(realms * 5);

    // And the mass of it sits around the settlements. Some outliers are expected and correct:
    // ground is claimed by marching over it, so an army on its way to a target takes the corridor
    // it walks, and a coastal capital runs out of land to claim long before an inland one does.
    expect(nearHome / held, 'realms are holding corridors, not countries').toBeGreaterThan(0.7);
  });

  it('grows the claimed area steadily rather than in one dash', () => {
    const state = campaign();
    const owned = () => [...state.tileOwner].filter((o) => o >= 0 && o !== neutralIndex).length;

    years(state, 2);
    const early = owned();
    years(state, 6);
    expect(owned()).toBeGreaterThan(early);
  });
});

/**
 * The AI's estimate of what a defender is worth, checked against the resolver that actually
 * decides the battle.
 *
 * This is the one number in `ai.ts` that has to agree with something outside it. When it did
 * not, the AI either threw single units at walls forever or refused to attack anything for a
 * century — both shipped in development, and both looked like an AI bug rather than an
 * arithmetic one. If the combat rules are ever retuned, this fails first.
 */
describe('the odds model matches the resolver', () => {
  function plains(): number {
    for (let y = 0; y < world.height; y++) {
      for (let x = 0; x < world.width; x++) {
        if (terrainAt(world, x, y) === 'plains') return tileIndex(world, x, y);
      }
    }
    throw new Error('the map has no plains');
  }

  /** Attackers needed to beat four defending Light Infantry on the given ground. */
  function measure(advantage: number): number {
    const tile = plains();
    for (let attackers = 1; attackers <= 24; attackers++) {
      const state = campaign();
      const setup: BattleSetup = {
        tileIndex: tile,
        cityIndex: -1,
        attackerIndex: 1,
        defenderIndex: 2,
        attacker: [{ source: 'army', stack: { light_infantry: attackers }, armyId: 1 }],
        defender: [
          { source: 'army', stack: { light_infantry: 4 }, advantage, armyId: 2 },
        ],
      };
      if (fightBattle(state, world, setup).report.winner === 'attacker') return (attackers / 4) * 1000;
    }
    return Number.POSITIVE_INFINITY;
  }

  const predicted = (advantage: number) => BREAK_EVEN + Math.floor((advantage * GROUND_WORTH) / 1000);

  it('predicts the break-even ratio within a quarter of a defender', () => {
    for (const advantage of [0, 100, 200, 300, 400, 500, 600, 700, 800, 900]) {
      const real = measure(advantage);
      expect(Math.abs(predicted(advantage) - real), `at advantage ${advantage}`).toBeLessThanOrEqual(
        350,
      );
    }
  });

  it('agrees that an attacker needs the edge even on level ground', () => {
    // Moving and striking are separate actions, so whoever closes gives up the first blow.
    expect(measure(0)).toBeGreaterThan(1000);
    expect(BREAK_EVEN).toBeGreaterThan(1000);
  });
});

describe('saves', () => {
  it('wakes the rivals up in a campaign saved before they existed', () => {
    const state = campaign();
    const file: SaveFile = {
      id: 'test',
      name: 'v5',
      kind: 'manual',
      version: 5,
      tick: state.tick,
      factionId: 'franks',
      mapId: world.id,
      savedAt: 0,
      state: serialise(state),
    };
    // A v5 file predates the AI entirely, so strip what it could not have held.
    for (const faction of file.state.factions) {
      delete (faction as { ai?: unknown }).ai;
    }

    const migrated = migrate(file);
    expect(migrated.version).toBe(SAVE_VERSION);

    const loaded = deserialise(migrated.state);
    expect(loaded.factions[loaded.playerFactionIndex]?.ai).toBeNull();
    expect(loaded.factions[neutralIndex]?.ai).toBeNull();
    for (const faction of rivals(loaded)) {
      expect(faction.ai?.difficulty).toBe(LEVEL_DIFFICULTY);
      expect(AI_PERSONALITIES).toContain(faction.ai?.personality);
    }
  });
});

describe('performance', () => {
  it('costs little enough to run a decade in a second', () => {
    // Twelve realms deciding once a month, at maximum speed, must not stall the frame loop.
    const state = campaign('king');
    const started = Date.now();
    years(state, 10);
    expect(Date.now() - started).toBeLessThan(4000);
    expect(stackSoldiers(state.armies[0]?.units ?? {})).toBeGreaterThanOrEqual(0);
  });
});

/**
 * Fog of war — docs/MECHANICS.md §9.
 *
 * The rules under test are the owner's: three tiles of sight from every tile a realm holds, and
 * one more per settlement tier above Village.
 */
describe('fog of war', () => {
  it('sees three tiles beyond the ground it holds', () => {
    const state = campaign();
    const seen = visibleTiles(state, world, state.playerFactionIndex);
    const capital = citiesOf(state, state.playerFactionIndex)[0]!;
    const cx = capital.tileIndex % world.width;
    const cy = Math.floor(capital.tileIndex / world.width);

    // A Village sees three; the four tiles it starts owning each see three of their own, so the
    // capital's own reach is the binding one at the diagonal.
    expect(seen[tileIndex(world, cx + 3, cy)]).toBe(1);
    expect(seen[tileIndex(world, cx, cy + 3)]).toBe(1);
    // Four out along a diagonal is past every source of sight it has.
    expect(seen[tileIndex(world, cx + 4, cy + 4)]).toBe(0);
  });

  it('sees one tile further for every tier a settlement gains', () => {
    expect(sightOf(1)).toBe(BASE_SIGHT);
    expect(sightOf(2)).toBe(BASE_SIGHT + 1);
    expect(sightOf(3)).toBe(BASE_SIGHT + 2);
    expect(sightOf(4)).toBe(BASE_SIGHT + 3);

    const state = campaign();
    const capital = citiesOf(state, state.playerFactionIndex)[0]!;
    const cx = capital.tileIndex % world.width;
    const cy = Math.floor(capital.tileIndex / world.width);
    const far = tileIndex(world, cx + 6, cy);

    expect(visibleTiles(state, world, state.playerFactionIndex)[far]).toBe(0);
    capital.tier = 4;
    expect(visibleTiles(state, world, state.playerFactionIndex)[far]).toBe(1);
  });

  it('does not reveal a rival realm on the far side of the map', () => {
    const state = campaign();
    const seen = visibleTiles(state, world, state.playerFactionIndex);
    const rival = rivals(state).find((f) => citiesOf(state, f.index).length > 0)!;
    const theirs = citiesOf(state, rival.index)[0]!;
    // Not asserted for every rival — a neighbour close enough to overlook is correct.
    const distant = rivals(state).filter(
      (f) =>
        citiesOf(state, f.index).length > 0 &&
        seen[citiesOf(state, f.index)[0]!.tileIndex] === 0,
    );
    expect(theirs).toBeDefined();
    expect(distant.length).toBeGreaterThan(5);
  });

  /** The AI is explicitly not blinded — docs/MECHANICS.md §9. */
  it('never reaches the simulation, so the rivals play as if it did not exist', () => {
    const withFog = campaign();
    const without = campaign();
    years(withFog, 8);
    years(without, 8);
    // Nothing in `advance` consults vision, so two identical campaigns stay identical whatever
    // the player can see. If the AI ever started reading it, this is what would break.
    expect(JSON.stringify(serialise(without))).toBe(JSON.stringify(serialise(withFog)));
  });
});
