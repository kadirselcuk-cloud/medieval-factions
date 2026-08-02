import { summariseBuildings } from '../data/buildings';
import type { Faction } from '../data/factions';
import { tileOutput } from '../data/improvements';
import {
  adjacentWaterCount,
  featureAt,
  terrainAt,
  tileIndex,
  type World,
} from '../data/world';
import { improvementAt, totalUpkeep } from './construction';
import {
  emptyLedger,
  MILLI,
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

export function createInitialState(
  world: World,
  roster: readonly Faction[],
  playerFactionId: string,
  seed = 1,
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
      populationMilli: STARTING_POPULATION * MILLI,
      // Nothing is pre-built. Housing and fortification are separate lines, so a fresh
      // village grows at 0.2%/month until it puts up Wooden Houses.
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
    battles: [],
    nextBattleId: 1,
    tileOwner,
    improvementKind: new Int8Array(tileCount).fill(-1),
    improvementLevel: new Uint8Array(tileCount),
    improvementMonths: new Uint8Array(tileCount),
    improvementTarget: new Uint8Array(tileCount),
    events: [],
  };

  recomputeIncome(state, world);
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

    faction.monthlyIncome.gold += Math.floor(city.populationMilli / MILLI / 100);
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

  // Upkeep is netted off income, so the top bar shows what a faction actually banks.
  for (const faction of state.factions) {
    faction.monthlyIncome.gold -= totalUpkeep(state, faction.index);
  }
}
