import { AI_PERSONALITIES, difficultyProfile, LEVEL_DIFFICULTY } from '../data/ai';
import { summariseBuildings } from '../data/buildings';
import type { Faction } from '../data/factions';
import { tileOutput } from '../data/improvements';
import { bonusesOf } from '../data/rosters';
import {
  adjacentWaterCount,
  featureAt,
  terrainAt,
  tileIndex,
  type World,
} from '../data/world';
import { improvementAt, totalUpkeep } from './construction';
import { rememberGround } from './vision';
import {
  emptyLedger,
  MILLI,
  RESOURCES,
  type AiDifficulty,
  type AiPersonality,
  type CityState,
  type FactionState,
  type SimState,
} from './types';

/** docs/CONTENT.md §1 — every faction opens with one Village and 250 gold. */
export const STARTING_GOLD = 250;
export const STARTING_POPULATION = 1000;

/**
 * The owner's opening unit: "start with 1 unit of lowest army".
 *
 * It lands in the capital's garrison rather than as an army already in the field, so the first
 * decision of a campaign is whether to march it out — and so it is visibly distinct from the
 * settlement's own defenders, which cost nothing and can never leave.
 */
export const STARTING_UNIT = 'light_infantry';

/**
 * Tiles claimed around a starting capital. The owner specified "the 4 tiles around it",
 * orthogonally. Water is skipped: territory is a land concept until naval exists, and an
 * inland-sea claim would give Bursa or Constantinople a free stretch of open water. [GEN]
 */
const STARTING_CLAIM_OFFSETS: readonly (readonly [number, number])[] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

/**
 * The character a realm is played with, when the roster does not name one.
 *
 * Deterministic in the campaign seed and the faction's own id, so the same seed always meets
 * the same Europe and a different one meets a different one. It deliberately does **not** draw
 * from `state.rng`: creating a campaign must not consume the simulation's stream, or the first
 * battle of a campaign would depend on how many factions the roster happened to contain.
 */
export function rolledPersonality(seed: number, id: string, index: number): AiPersonality {
  let hash = (seed ^ 0x9e3779b9) | 0;
  for (let i = 0; i < id.length; i++) {
    hash = Math.imul(hash ^ id.charCodeAt(i), 0x85ebca6b);
  }
  hash = Math.imul(hash ^ index, 0xc2b2ae35);
  return AI_PERSONALITIES[(hash >>> 0) % AI_PERSONALITIES.length] ?? 'balanced';
}

export function createInitialState(
  world: World,
  roster: readonly Faction[],
  playerFactionId: string,
  seed = 1,
  difficulty: AiDifficulty = LEVEL_DIFFICULTY,
): SimState {
  const playerFactionIndex = roster.findIndex((f) => f.id === playerFactionId);
  if (playerFactionIndex < 0) throw new Error(`Unknown faction "${playerFactionId}"`);
  const neutralIndex = roster.findIndex((f) => f.neutral);
  if (neutralIndex < 0) throw new Error('Roster has no neutral faction');

  const factions: FactionState[] = roster.map((faction, index) => ({
    index,
    id: faction.id,
    alive: true,
    stock: { ...emptyLedger(), gold: faction.neutral ? 0 : STARTING_GOLD * MILLI },
    carry: emptyLedger(),
    monthlyIncome: emptyLedger(),
    cityless: 0,
    // Neither the player's realm nor the Independents is played by anyone.
    ai:
      faction.neutral || index === playerFactionIndex
        ? null
        : {
            difficulty,
            personality: faction.personality ?? rolledPersonality(seed, faction.id, index),
          },
  }));

  const tileOwner = new Int8Array(world.width * world.height).fill(-1);
  const cityByName = new Map(world.cities.map((city, index) => [city.name, index]));
  const ownerOfCity = new Int8Array(world.cities.length).fill(neutralIndex);

  for (const [factionIndex, faction] of roster.entries()) {
    if (faction.capital === null) continue;
    const cityIndex = cityByName.get(faction.capital);
    if (cityIndex === undefined) {
      throw new Error(
        `${faction.name} starts in "${faction.capital}", which is not a city on map "${world.id}"`,
      );
    }
    if (ownerOfCity[cityIndex] !== neutralIndex) {
      throw new Error(`Two factions both start in "${faction.capital}"`);
    }
    ownerOfCity[cityIndex] = factionIndex;
  }

  const cities: CityState[] = world.cities.map((city, index) => {
    const ownerIndex = ownerOfCity[index] ?? neutralIndex;
    claimStartingTerritory(world, tileOwner, city.x, city.y, ownerIndex);
    return {
      cityIndex: index,
      tileIndex: tileIndex(world, city.x, city.y),
      ownerIndex,
      tier: 1,
      population: STARTING_POPULATION,
      // Nothing is pre-built. Housing and fortification are separate lines, so a fresh
      // village gains 5 people a month until it puts up Wooden Houses, and 15 after.
      buildings: [],
      queue: [],
      recruitQueue: [],
      shipQueue: [],
      // The neutral Independents hold 47 cities; handing each one a free unit would arm them
      // to the teeth. Their settlements defend themselves like everyone else's.
      garrison: ownerIndex === neutralIndex ? {} : { [STARTING_UNIT]: 1 },
      fleet: {},
      siege: null,
    };
  });

  const tileCount = world.width * world.height;
  const state: SimState = {
    tick: 0,
    seed,
    rng: seed,
    playerFactionIndex,
    factions,
    cities,
    armies: [],
    nextArmyId: 1,
    fleets: [],
    nextFleetId: 1,
    battles: [],
    nextBattleId: 1,
    tileOwner,
    improvementKind: new Int8Array(tileCount).fill(-1),
    improvementLevel: new Uint8Array(tileCount),
    improvementMonths: new Uint8Array(tileCount),
    improvementTarget: new Uint8Array(tileCount),
    discovered: new Uint8Array(tileCount),
    events: [],
  };

  recomputeIncome(state, world);
  // A realm opens knowing its own country — otherwise the first frame of a new campaign is black
  // everywhere the capital is not looking, before a single tick has run.
  rememberGround(state, world);
  return state;
}

function claimStartingTerritory(
  world: World,
  tileOwner: Int8Array,
  x: number,
  y: number,
  ownerIndex: number,
): void {
  tileOwner[tileIndex(world, x, y)] = ownerIndex;
  for (const [dx, dy] of STARTING_CLAIM_OFFSETS) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= world.width || ny >= world.height) continue;
    if (terrainAt(world, nx, ny) === 'water') continue;
    tileOwner[tileIndex(world, nx, ny)] = ownerIndex;
  }
}

/**
 * Recalculate every faction's monthly income from what it currently owns.
 *
 * Income only changes when population or ownership changes, both of which are discrete
 * events, so this runs on month rollover rather than every tick.
 */
export function recomputeIncome(state: SimState, world: World): void {
  for (const faction of state.factions) {
    faction.monthlyIncome = emptyLedger();
  }

  // Settlements: 100 people yield 1 gold per month, plus commerce and fishing.
  for (const city of state.cities) {
    const faction = state.factions[city.ownerIndex];
    if (!faction) continue;
    // An invested settlement pays its owner nothing — no taxes leave a blockaded city. Its
    // tiles carry on paying; only the walls are cut off.
    if (city.siege) continue;
    const location = world.cities[city.cityIndex];
    const buildings = summariseBuildings(city.buildings);

    faction.monthlyIncome.gold += Math.floor(city.population / 100);
    faction.monthlyIncome.gold += buildings.goldPerMonth;

    // The naval line pays per adjacent water tile, which is what makes a coastal settlement
    // worth having: the sea it cannot farm becomes the thing it earns from.
    if (buildings.goldPerWaterTile > 0 && location) {
      faction.monthlyIncome.gold +=
        buildings.goldPerWaterTile * adjacentWaterCount(world, location.x, location.y);
    }
  }

  // Every owned tile: its improvement, or the token yield of an unimproved resource node.
  for (let index = 0; index < state.tileOwner.length; index++) {
    const ownerIndex = state.tileOwner[index] ?? -1;
    if (ownerIndex < 0) continue;
    const faction = state.factions[ownerIndex];
    if (!faction) continue;

    const x = index % world.width;
    const y = Math.floor(index / world.width);
    const feature = featureAt(world, x, y);

    const output = tileOutput({
      terrain: terrainAt(world, x, y),
      improvement: improvementAt(state, index),
      level: state.improvementLevel[index] ?? 0,
      node: feature?.kind === 'resource' ? feature.resource : null,
    });

    faction.monthlyIncome.gold += output.gold;
    faction.monthlyIncome.wood += output.wood;
    faction.monthlyIncome.iron += output.iron;
    faction.monthlyIncome.stone += output.stone;
  }

  // The tax rate, the difficulty handicap, and then upkeep.
  //
  // Both multipliers land on **gross** income, before wages, so a hard opponent is richer rather
  // than immune to its own army. Nothing else in the simulation knows about either: difficulty is
  // the one place a rival's economy differs from the player's, and at Knight it does not differ.
  for (const faction of state.factions) {
    faction.monthlyIncome.gold = taxedGold(faction.monthlyIncome.gold);

    const scale = faction.ai ? difficultyProfile(faction.ai.difficulty).incomePermille : 1000;
    if (scale !== 1000) {
      for (const resource of RESOURCES) {
        faction.monthlyIncome[resource] = Math.floor(
          (faction.monthlyIncome[resource] * scale) / 1000,
        );
      }
    }

    /**
     * **The realm's own economic bonus** — one per faction, owner-specified in 0.20.0.
     *
     * Deliberately small, and deliberately here: on gross income, before wages, alongside the
     * difficulty handicap it most resembles. Four to six per cent of one resource is a thumb on the
     * scale rather than a strategy — Castille collects a little more gold, Novgorod a little more
     * timber — which is what the owner asked for in "small bonuses that don't affect the gameplay".
     *
     * The `growth` kind is not applied here. It is people rather than money, and it belongs in
     * `cityGrowth` with the rest of the growth sum.
     */
    const economy = bonusesOf(faction.id)?.economy;
    if (economy && economy.kind !== 'growth') {
      const resource = economy.kind;
      faction.monthlyIncome[resource] += Math.floor(
        (faction.monthlyIncome[resource] * economy.permille) / 1000,
      );
    }

    faction.monthlyIncome.gold -= totalUpkeep(state, faction.index);
  }
}

/**
 * What a realm actually collects of the gold its land produces — **a quarter**, owner-authored.
 *
 * Every gold figure in the game's data is what the ground, the buildings and the people
 * *generate*; this is the share that reaches the treasury. Applied in one place, to gross income,
 * before wages and before the difficulty handicap.
 *
 * **It is one multiplier rather than thirty halved numbers on purpose.** The alternative was
 * halving the yield of every building, improvement and node in the data files, which is thirty
 * edits to undo and retune next time — and this is a number that will be retuned. It also leaves
 * the cards honest about what a building *produces*, with the tax stated once where the player
 * reads their income rather than implied in every tooltip.
 *
 * Wood, iron and stone are untouched. The problem it exists to solve is gold: a realm that clears
 * a hundred a month can field heavy cavalry indefinitely, and every realm was reaching that.
 *
 * **Halved again in 0.19.0** — owner-specified, "reduce all income by half from all sources", and
 * confirmed as the gold line alone. It bites twice now rather than once, because population growth
 * reads *net* income since the same version (`prosperityGrowth`): a smaller purse is both less gold
 * and fewer people, and a fixed wage bill is a larger share of it. That compounding is the point.
 */
export const GOLD_INCOME_PERMILLE = 250;

/** Gross gold in, collected gold out. Integer, floored — see `GOLD_INCOME_PERMILLE`. */
export function taxedGold(gross: number): number {
  return Math.floor((gross * GOLD_INCOME_PERMILLE) / 1000);
}
