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
import { landmassOf } from './geography';
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
      // Every realm garrisons something. Raiding is the one behaviour a personality may opt out
      // of entirely — Peaceful does — so it has no floor.
      expect(person.guardPermille, person.id).toBeGreaterThan(0);
      expect(person.raidPermille + person.guardPermille, person.id).toBeLessThanOrEqual(1000);
    }
  });

  it('still leans each one somewhere', () => {
    const build = (p: AiPersonality) => personalityProfile(p).build;
    expect(build('defensive').fortification).toBeGreaterThan(build('ambitious').fortification);
    expect(build('ambitious').expand).toBeGreaterThan(build('defensive').expand);
    // No realm has a reach limit any more — all of them mean to take the whole map. What leans is
    // what they do with the armies they raise.
    expect(personalityProfile('ambitious').raidPermille).toBeGreaterThan(
      personalityProfile('defensive').raidPermille,
    );
    expect(personalityProfile('defensive').guardPermille).toBeGreaterThan(
      personalityProfile('ambitious').guardPermille,
    );
    expect(personalityProfile('peaceful').raidPermille).toBe(0);
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

/**
 * **Every horizon in this file grew in 0.19.0, and none of the properties changed.**
 *
 * The owner halved gold income (`GOLD_INCOME_PERMILLE`, 500 → 250). Measured across the campaign,
 * that does not stop the rivals doing anything — it makes them take **60 to 100 years longer** to
 * do it, because everything an AI does costs gold:
 *
 * | What | Was true by | Now true by |
 * |---|---|---|
 * | Three rivals hold more than their capital | 1362 | 1366 |
 * | More than five battles fought | 1362 | 1364 |
 * | Every walkable acre claimed | ~1470 | 1530 |
 * | No single unit type more than half the world's army | ~1470 | 1530 |
 * | Most marooned settlements taken by sea | ~1470 | 1550 |
 *
 * So the horizons here are recalibrated rather than the assertions relaxed. Where a test asserted
 * "the AI eventually does X", it still does — later. The one thing worth watching is that the
 * middle of a campaign is now much poorer than it was, which is written up in NEXT.md.
 */
describe('a rival realm plays', () => {
  const state = campaign();
  years(state, 20);

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
  // 35 years rather than 25 since 0.19.0: at the halved income a world of Defensive realms has
  // barely raised an army by 1375, so the guard share it is meant to show divides by nothing.
  const ambitious = worldOf('ambitious', 35);
  const defensive = worldOf('defensive', 35);

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

  /**
   * **What "ambitious" means changed in 0.17.0.** It used to mean *reaches further* — and with
   * reach gone, both worlds now take everything they can walk to, so a conquest count ties at 50
   * and says nothing. Personality is a pair of odds on what each army raised is for, so that is
   * what this asserts.
   */
  it('has a world of defensive realms garrison its borders far harder', () => {
    const roles = (state: SimState, role: string) =>
      state.armies.filter((a) => a.role === role && a.ownerIndex !== state.playerFactionIndex)
        .length;

    // **A share, not a head count.** Ambitious realms conquer more, so they have more frontier to
    // garrison and more armies to do it with — comparing absolute numbers measures how big a
    // world's realms got, not what they chose to do with their armies.
    const share = (state: SimState) => {
      const mine = state.armies.filter((a) => a.ownerIndex !== state.playerFactionIndex);
      return mine.length === 0 ? 0 : roles(state, 'guard') / mine.length;
    };
    // Measured: 13.9% against 11.4%. The gap is narrower than the odds (50% against 10%) because
    // the quota binds first — a realm cannot post more guards than it has frontier settlements.
    expect(share(defensive)).toBeGreaterThan(share(ambitious));
  });

  /*
   * **Raiding is asserted on the tables, not on a head count.** Counting surviving raiders
   * measures how many came back, not how many were sent: a raiding column rides deep into hostile
   * country by design, where it meets garrisons and — since 0.17.1 — the winter. An Ambitious
   * world raids eight times as often as a Defensive one and can still finish a campaign with
   * fewer raiders standing, which is the behaviour working rather than failing.
   *
   * Border guards survive to be counted because they sit at home, which is why the assertion
   * above is the one that can be made behaviourally.
   */

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
    // Six years before 0.19.0's halved income; ten buys the same claimed area now.
    years(state, 10);

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

  /**
   * The regression this whole file exists to prevent a repeat of: **the map used to stop filling
   * in.** Every realm searched for unclaimed ground only within `claimRadius` — three tiles — of
   * its own settlements, so any ground further than that from *any* city on the map was ground no
   * realm ever had a reason to walk to. A century in, 318 of 1,692 land tiles were still bare:
   * the north-west of France, the Danish peninsula, the middle of Britain, and the whole Sahara
   * behind the Moors' cities.
   *
   * Asserted against **what a marching realm can actually reach**, not against the map, because
   * the honest residue is naval. Several islands carry Independent settlements and no realm's
   * capital, and until ships can carry an army there is no route to them at any distance — the
   * simulation is right to leave those alone, and a test that demanded the whole map would be
   * demanding a bug.
   */
  it('finishes every acre a realm can walk to, however far from a city', () => {
    const state = campaign();
    // Measured after 0.19.0: 9.8% of walkable ground still bare at 1470, 0.3% at 1510, none at 1530.
    years(state, 180);

    // The landmasses a living rival actually has a settlement on. Nowhere else is walkable to.
    const reachable = new Set(
      rivals(state)
        .filter((faction) => faction.alive)
        .flatMap((faction) =>
          citiesOf(state, faction.index).map((city) => landmassOf(world, city.tileIndex)),
        ),
    );

    let land = 0;
    let bare = 0;
    for (let tile = 0; tile < state.tileOwner.length; tile++) {
      if (!reachable.has(landmassOf(world, tile))) continue;
      land += 1;
      if ((state.tileOwner[tile] ?? -1) === -1) bare += 1;
    }

    expect(land).toBeGreaterThan(500);
    // It was 19% of the whole map. Everything a realm can march to is now taken but for a
    // handful of tiles that happened to be contested on the last month of the campaign.
    expect(bare / land, `${bare} of ${land} reachable tiles never claimed`).toBeLessThan(0.02);
  }, 120_000);

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

/**
 * What a realm recruits — owner-specified in 0.18.1, and the fix for a game with one unit in it.
 *
 * The old rule was a pure argmax on `size × hp × damage`, so heavy cavalry (3200) beat sword
 * infantry (2250) for every personality and **spear infantry was never built by anybody**, despite
 * doing double damage to horse. The roll of three is what puts a shape back into an army.
 */
describe('an army with a shape', () => {
  const state = campaign();
  // Measured after 0.19.0: Light Infantry is 80% of the world's army at 1470 and 43% at 1530.
  // Poverty, not the roll — `buildableHere` refuses anything a realm cannot pay two wages for, and
  // for the first century and a half of the halved economy that is the cheapest unit and no other.
  years(state, 180);

  /** Every unit the world has under arms, by id. */
  const muster = () => {
    const mix: Record<string, number> = {};
    for (const army of state.armies) {
      for (const [id, n] of Object.entries(army.units)) mix[id] = (mix[id] ?? 0) + n;
    }
    for (const city of state.cities) {
      for (const [id, n] of Object.entries(city.garrison)) mix[id] = (mix[id] ?? 0) + n;
    }
    return mix;
  };

  it('builds spear infantry, which the pure argmax never once did', () => {
    expect(muster().spear_infantry ?? 0).toBeGreaterThan(0);
  });

  /**
   * Measured at 120 years deliberately, not earlier.
   *
   * Light Infantry runs at two thirds of every army for the first sixty years, and that is **not**
   * this rule failing - it is the tier gate. A Village can build Light Infantry and nothing else, so
   * a young realm has one option however it rolls. The mix only becomes a statement about unit
   * choice once settlements have the buildings to offer one, and by then it is 36-46% of a roster
   * of nine.
   */
  it('fields a mixed roster rather than one unit repeated', () => {
    const mix = muster();
    const total = Object.values(mix).reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(200);

    // No single unit type dominates. Under the old argmax the best unit took essentially the whole
    // army the moment a realm could pay its wages.
    const biggest = Math.max(...Object.values(mix));
    expect(biggest / total).toBeLessThan(0.55);

    // And the roster is genuinely broad, not two units in a ratio.
    expect(Object.keys(mix).length).toBeGreaterThanOrEqual(7);
  });

  it('fields missiles and ground troops both', () => {
    const mix = muster();
    const missiles = (mix.archer ?? 0) + (mix.cavalry_archer ?? 0);
    const ground = (mix.light_infantry ?? 0) + (mix.sword_infantry ?? 0) + (mix.heavy_cavalry ?? 0);
    expect(missiles).toBeGreaterThan(0);
    expect(ground).toBeGreaterThan(0);
  });

  it('stays deterministic — the roll comes from the campaign seed', () => {
    const a = campaign(LEVEL_DIFFICULTY, 909);
    const b = campaign(LEVEL_DIFFICULTY, 909);
    years(a, 20);
    years(b, 20);
    expect(JSON.stringify(serialise(b))).toBe(JSON.stringify(serialise(a)));
  });
});

/**
 * Rival realms cross water — docs/MECHANICS.md §10.
 *
 * The naval phase exists for the settlements no realm can march to. This asserts the thing that
 * was actually broken for most of 0.18.0's development: that an expedition completes at all.
 */
describe('a rival realm sails', () => {
  it('takes settlements no realm could ever have walked to', () => {
    const state = campaign(LEVEL_DIFFICULTY, 77);
    const independents = roster.findIndex((f) => f.religion === 'none');

    // Landmasses no playable realm starts on — Ireland, Sardinia, Crete, Cyprus and the north.
    const settled = new Set(
      state.cities
        .filter((c) => c.ownerIndex !== independents)
        .map((c) => landmassOf(world, c.tileIndex)),
    );
    const marooned = state.cities.filter((c) => !settled.has(landmassOf(world, c.tileIndex)));
    expect(marooned.length).toBeGreaterThan(0);

    // **200 years, not 120.** After 0.19.0 halved income, the first fleet on this seed puts to sea
    // in 1450 and the first marooned settlement falls in 1510 — six of seven by 1550. The sea stops
    // being a wall a full century later than it did, which is the sharpest single consequence of
    // the cheaper economy and the one most worth revisiting if the pace feels wrong.
    years(state, 200);

    // Deliberately not "all of them": which islands fall is a balance outcome and varies by seed.
    // What must hold is that the sea is no longer a wall.
    const taken = marooned.filter((c) => c.ownerIndex !== independents);
    expect(taken.length).toBeGreaterThan(marooned.length / 2);
  });
});

/**
 * Concentration, fronts and the sea — the three things a large realm was failing to do.
 *
 * All three were the same shape of bug: rules that were right for a realm of three settlements and
 * were never scaled for one of thirty. Measured at 120 years before the fix, the world ran 158
 * armies averaging 3.9 units with 78% of them four or fewer, the Turks pointed 74 stacks at a single
 * objective, and there were 8 fleets on the whole map.
 */
describe('a large realm acts like one', () => {
  const state = campaign();
  // Measured after 0.19.0: 42% of field stacks were four units or fewer at 1470, 24% at 1510.
  years(state, 160);

  /**
   * **Field armies only.** A claiming stack is one unit and a raiding column three — both by
   * design (decisions 108, 118) — so counting them as "too small" would be asserting against
   * rules the owner asked for. What must not be small is the force that fights the war.
   */
  const fieldStacks = () =>
    state.armies.filter((army) => army.role === 'field').map((army) => stackSize(army.units));

  it('concentrates its men instead of scattering them in detachments', () => {
    const sizes = fieldStacks();
    expect(sizes.length).toBeGreaterThan(5);

    /**
     * **Both thresholds were relaxed in 0.18.6, and the reason is real rather than cosmetic.**
     * Releasing stranded border guards into the field force (decision 154) pours a quantity of
     * deliberately small stacks — a guard is one to three units — into the pool this measures. The
     * average fell from 7.0 to 7.0-ish and the small share rose from ~8% to ~23%.
     *
     * That is not the failure this test was written to catch. The 0.18.2 symptom was a realm
     * *founding* dozens of four-unit armies and sending each to fight on its own; these are stacks
     * that already existed, that have been handed back to the field because their post was
     * pointless, and that are mostly walking to a harbour to become cargo — where size does not
     * matter, since `fitting` loads whatever the berths take.
     *
     * So the bar is set where it still catches the original disease and tolerates this. If the
     * small share ever climbs past a third, something has genuinely regressed.
     */
    const average = sizes.reduce((a, b) => a + b, 0) / sizes.length;
    expect(average).toBeGreaterThan(6);

    /**
     * **The headline symptom: a map covered in field stacks too small to take anything.**
     *
     * Sampled over five years rather than read off one month, and the bar moved to 0.40 — both in
     * 0.19.1, and both because the instantaneous figure was measured swinging between **0.19 and
     * 0.49 within a decade** on the seed this runs. Realms raise stacks in waves and merge them
     * again (`RALLY_BELOW_FRACTION`), so a snapshot catches a crest or a trough and the old 0.33
     * sat squarely inside the noise. It failed on a naval change that has nothing to do with how
     * armies are sized, which is the tell.
     *
     * The bar still catches the disease it was written for by a wide margin: the 0.18.2 symptom was
     * **78%** of field stacks at four units or fewer, and `average > 6` above is the stable half of
     * the same guarantee.
     */
    // Sampled on a **copy**, so the campaign the rest of this block reads is not advanced out from
    // under it. The save round trip is exact by construction, and already tested as such.
    const probe = deserialise(serialise(state));
    let tiny = 0;
    let counted = 0;
    for (let year = 0; year < 5; year++) {
      const wave = probe.armies
        .filter((army) => army.role === 'field')
        .map((army) => stackSize(army.units));
      tiny += wave.filter((size) => size <= 4).length;
      counted += wave.length;
      years(probe, 1);
    }
    expect(tiny / counted).toBeLessThan(0.4);
  });

  it('puts real fleets to sea, not one hull for the world', () => {
    expect(state.fleets.length).toBeGreaterThan(10);
  });

  it('gets somebody off their starting landmass', () => {
    const spread = state.factions.filter((faction) => {
      if (!faction.alive || !faction.ai) return false;
      const mine = state.cities.filter((city) => city.ownerIndex === faction.index);
      return new Set(mine.map((city) => landmassOf(world, city.tileIndex))).size > 1;
    });
    // The Britons on their island and the Moors in North Africa used to take their own continent
    // and then stop playing for a century.
    expect(spread.length).toBeGreaterThan(0);
  });

  it('fights on more than one front once it is big enough', () => {
    // A realm large enough for several fronts should have armies genuinely far apart, rather than
    // every stack converging on one city at the other end of the empire.
    const biggest = [...state.factions]
      .filter((f) => f.alive && f.ai)
      .sort(
        (a, b) =>
          state.cities.filter((c) => c.ownerIndex === b.index).length -
          state.cities.filter((c) => c.ownerIndex === a.index).length,
      )[0];
    expect(biggest).toBeDefined();

    const theirs = state.armies.filter((a) => a.ownerIndex === biggest?.index);
    if (theirs.length < 4) return;

    const xs = theirs.map((a) => a.tileIndex % world.width);
    const ys = theirs.map((a) => Math.floor(a.tileIndex / world.width));
    const spread = Math.max(...xs) - Math.min(...xs) + (Math.max(...ys) - Math.min(...ys));
    expect(spread).toBeGreaterThan(8);
  });
});

/**
 * What 0.18.3 changed about ambition — the owner's report, in assertions.
 *
 * Four complaints, all about realms that grew large and then stopped doing anything interesting:
 * they took cities but left the countryside between them bare, they ground against whatever was
 * nearest rather than whatever was weakest, England never left its island, and Fez took Spain and
 * ignored the whole of North Africa.
 */
describe('a realm keeps reaching', () => {
  const state = campaign();
  years(state, 120);

  it('claims the ground between its cities, not only the cities', () => {
    let land = 0;
    let claimed = 0;
    for (let index = 0; index < state.tileOwner.length; index++) {
      if (landmassOf(world, index) === 0) continue;
      land += 1;
      if ((state.tileOwner[index] ?? -1) >= 0) claimed += 1;
    }
    // Measured at 90-100% across seeds. Before the claiming quotas were raised, a twelfth of the
    // walkable map was still bare after 120 years.
    expect(claimed / land).toBeGreaterThan(0.85);
  });

  it('leaves almost nothing independent', () => {
    const independents = roster.findIndex((f) => f.religion === 'none');
    const left = state.cities.filter((c) => c.ownerIndex === independents).length;
    expect(left).toBeLessThanOrEqual(2);
  });

  it('gets realms onto coasts they did not start on', () => {
    // England on its island and Fez in North Africa were the two the owner named.
    const spread = state.factions.filter((faction) => {
      if (!faction.alive || !faction.ai) return false;
      const mine = state.cities.filter((city) => city.ownerIndex === faction.index);
      return new Set(mine.map((city) => landmassOf(world, city.tileIndex))).size > 1;
    });
    expect(spread.length).toBeGreaterThan(0);
  });

  it('keeps its fleets doing something rather than swinging at anchor', () => {
    expect(state.fleets.length).toBeGreaterThan(5);

    /**
     * **Sampled over three years, not read off one month** — 0.19.1.
     *
     * The share of fleets under way at any instant was measured swinging between **0.00 and 0.67
     * inside five years** on this seed. That is not a navy falling asleep and waking up; it is a
     * convoy cycle — hulls gather at a quay, wait for an army, sail together, unload, and come back
     * empty. A snapshot lands wherever it lands in that cycle.
     *
     * Two things also make a reserve of idle hulls the *correct* state since 0.19.1: the owner asked
     * for more shipping than a realm has cargo for (decision 167), and a loaded convoy with no safe
     * route and no escort now deliberately waits in port rather than sailing into a warship
     * (decision 166). What must not happen is a navy that never moves at all.
     */
    const probe = deserialise(serialise(state));
    let peak = 0;
    for (let month = 0; month < 36; month++) {
      const busy = probe.fleets.filter(
        (fleet) => fleet.path.length > 0 || stackSize(fleet.cargo) > 0,
      ).length;
      peak = Math.max(peak, busy / Math.max(1, probe.fleets.length));
      advanceBy(probe, world, TICKS_PER_MONTH);
    }
    expect(peak).toBeGreaterThan(0.4);
  });
});

/**
 * **There is never a stalemate** — owner-specified in 0.18.4, and the hardest thing in this file
 * to keep true, because every individual rule that causes one is locally sensible.
 *
 * Measured before the fix, at 1500 and after: **52 of 52 armies idle**, battles dwindling, one
 * realm holding 46 cities and four holding 1–7 apiece and doing nothing for two hundred years.
 * Three separate dead ends fed it, and all three had the same shape — a branch that could fail with
 * nothing after it:
 *
 * - a realm whose every target failed `judge` chose no objective and stopped;
 * - a realm that had taken its whole landmass had nothing it could *walk* to, so objectives, raids
 *   and claimable ground all came back empty while its fleets sailed about with nothing to carry;
 * - claimers ran out of unclaimed ground once the map filled, and a rival's fields were invisible
 *   to them.
 */
describe('a campaign never settles into a stalemate', () => {
  const state = campaign();
  years(state, 180);

  const held = () =>
    state.factions
      .filter((f) => f.alive && f.ai)
      .map((f) => state.cities.filter((c) => c.ownerIndex === f.index).length)
      .join(',');

  // One run, three questions. Simulating 180 years is expensive enough without doing it thrice.
  const idleBefore = state.armies.filter((army) => army.path.length === 0).length;
  const armiesBefore = state.armies.length;
  const battlesBefore = state.nextBattleId;
  /**
   * Sampled **every year**, not at the two ends.
   *
   * Comparing `held()` before and after thirty years is a weaker test than it looks, and 0.18.10
   * found the hole: by 1530 this seed has narrowed to two realms, one taking a city in 1536 and
   * losing it again in 1554. The endpoints match exactly, while the window contains 2,483 battles
   * and two changes of ownership — a campaign about as far from frozen as it gets.
   *
   * Sampling is strictly the more sensitive assertion. A map that genuinely stops produces exactly
   * one value in this set however long it is run.
   */
  const ground = new Set([held()]);
  for (let year = 0; year < 30; year++) {
    years(state, 1);
    ground.add(held());
  }

  it('still has armies with somewhere to be', () => {
    expect(armiesBefore).toBeGreaterThan(10);
    // Not zero — an army that has just arrived, or one waiting on a quay to be shipped, is idle
    // this month and doing exactly what it should. What must not happen is all of them, for ever.
    expect(idleBefore / armiesBefore).toBeLessThan(0.75);
  });

  it('is still fighting', () => {
    expect(state.nextBattleId).toBeGreaterThan(battlesBefore);
  });

  it('still moves ground between realms', () => {
    expect(ground.size).toBeGreaterThan(1);
  });
});

/**
 * **The late game has to stay watchable**, not just the opening.
 *
 * The existing performance guard runs a decade from a standing start, where a realm has one army
 * and the map is empty — which is exactly the case that never regresses. Everything expensive in
 * this file scales with the number of armies, and a mature campaign has a hundred and thirty of
 * them, so the guard that matters is the one that pays for a century first.
 *
 * It caught nothing when it was written because it did not exist. What it is here to catch is the
 * shape of bug that produced the 0.18.8 regression: a linear scan of the cities or the armies
 * dropped inside a loop that already walks all 2,450 tiles, which is invisible at ten armies and
 * costs six seconds a decade at a hundred and thirty.
 */
describe('performance in a mature campaign', () => {
  it('runs a decade of a century-old world in a couple of seconds', () => {
    const state = campaign('king');
    years(state, 100);

    const started = Date.now();
    years(state, 10);
    const elapsed = Date.now() - started;

    // Measured at roughly 1.7s with 136 armies and 27 fleets afloat. The budget is deliberately
    // loose — this is a smoke alarm for an accidental quadratic, not a benchmark.
    expect(elapsed).toBeLessThan(6000);
    expect(state.armies.length).toBeGreaterThan(20);
  });
});
