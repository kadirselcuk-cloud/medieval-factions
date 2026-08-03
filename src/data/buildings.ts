import { z } from 'zod';
import rawBuildings from '../../data/buildings.json';

/**
 * City buildings.
 *
 * Six lines. Housing and fortification are built separately from the settlement tier, so a
 * Town that never builds Stone Houses keeps growing at its Wooden Houses rate — upgrading a
 * settlement unlocks the better building, it does not grant it.
 *
 * Lines other than `military` are upgrade chains: only the next level can be built, and it
 * replaces the one below.
 */

const costSchema = z
  .object({
    gold: z.number().int().nonnegative().default(0),
    wood: z.number().int().nonnegative().default(0),
    iron: z.number().int().nonnegative().default(0),
    stone: z.number().int().nonnegative().default(0),
  })
  .default({});

const buildingSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  line: z.enum(['housing', 'fortification', 'commerce', 'administration', 'military', 'naval']),
  /** Position within its line. Lines are upgrade chains; military is a set of parallel level-1 buildings. */
  level: z.number().int().min(1).max(4),
  /** Lowest settlement tier that may build it. 1 Village … 4 Capitol. */
  minTier: z.number().int().min(1).max(4),
  months: z.number().int().positive(),
  cost: costSchema,
  /** Commerce line: flat gold per month. */
  goldPerMonth: z.number().int().nonnegative().default(0),
  /**
   * Housing and administration: **whole people per month**.
   *
   * Population growth is flat, never a percentage — see docs/MECHANICS.md §5. That is what
   * makes this figure directly comparable to `goldPerMonth` on the card beside it, and what
   * stops a settlement compounding into the billions given long enough.
   */
  growthPeople: z.number().int().nonnegative().default(0),
  /**
   * Fortification line: defender's advantage, **as a percentage**. 15 means +15%.
   *
   * Percent rather than the tenths this used to be, because 0.13.0 halved every defence bonus
   * in the game and half of "3 tenths" is not a whole number of tenths.
   */
  defencePercent: z.number().int().nonnegative().default(0),
  /** Naval line: gold per month for every water tile adjacent to the settlement. */
  goldPerWaterTile: z.number().int().nonnegative().default(0),
  /** Requires the settlement to border water. */
  coastal: z.boolean().default(false),
});

export type Building = z.infer<typeof buildingSchema>;
export type BuildingLine = Building['line'];
export type Cost = z.infer<typeof costSchema>;

/** Lines where a building replaces the one below it, rather than sitting alongside. */
export const CHAIN_LINES: readonly BuildingLine[] = [
  'housing',
  'fortification',
  'commerce',
  'administration',
  'naval',
];

const settlementUpgradeSchema = z.object({
  toTier: z.number().int().min(2).max(4),
  name: z.string().min(1),
  /** People the settlement must already hold before it can grow into this tier. */
  minPopulation: z.number().int().nonnegative().default(0),
  /** A faction may hold only one settlement at this tier. */
  unique: z.boolean().default(false),
  months: z.number().int().positive(),
  cost: costSchema,
});

export type SettlementUpgrade = z.infer<typeof settlementUpgradeSchema>;

const fileSchema = z.object({
  /** Months a settlement of each tier can hold out once it is invested. Owner-authored. */
  siegeMonths: z.record(z.string(), z.number().int().positive()),
  settlementUpgrades: z.array(settlementUpgradeSchema).length(3),
  buildings: z.array(buildingSchema).min(1),
});

let parsed: z.infer<typeof fileSchema> | undefined;

function data(): z.infer<typeof fileSchema> {
  if (!parsed) {
    const file = fileSchema.parse(rawBuildings);

    const ids = new Set<string>();
    for (const building of file.buildings) {
      if (ids.has(building.id)) throw new Error(`Duplicate building id "${building.id}"`);
      ids.add(building.id);

      // A building the settlement can never reach is a data entry mistake, not a design.
      if (building.line !== 'military' && building.level > building.minTier) {
        throw new Error(
          `"${building.name}" is level ${building.level} of the ${building.line} line but needs only tier ${building.minTier}`,
        );
      }
    }

    // A tier with no stated endurance would hold out forever, which is the sort of thing that
    // only shows up when a campaign stalls at a wall it can never take.
    for (const tier of ['1', '2', '3', '4']) {
      if (!file.siegeMonths[tier]) {
        throw new Error(`buildings.json: siegeMonths is missing tier ${tier}`);
      }
    }
    parsed = file;
  }
  return parsed;
}

/**
 * Months this settlement can hold out once it is invested — Village 1, Town 3, City 6,
 * Capitol 12. Owner-authored.
 */
export function siegeMonths(tier: number): number {
  return data().siegeMonths[String(tier)] ?? 1;
}

export function loadBuildings(): readonly Building[] {
  return data().buildings;
}

/** The upgrade that takes a settlement to the given tier, or undefined at Capitol. */
export function settlementUpgradeTo(tier: number): SettlementUpgrade | undefined {
  return data().settlementUpgrades.find((u) => u.toTier === tier);
}

export function buildingsForTier(tier: number): readonly Building[] {
  return loadBuildings().filter((b) => b.minTier <= tier);
}

export function buildingById(id: string): Building | undefined {
  return loadBuildings().find((b) => b.id === id);
}

export interface BuildingSummary {
  /** Highest level reached in the housing chain. 0 if the settlement has no housing at all. */
  housingLevel: number;
  /** People per month from housing and administration together. */
  growthPeople: number;
  /** Gold per month from commerce. */
  goldPerMonth: number;
  /** Defender's advantage from fortification, as a percentage. */
  defencePercent: number;
  /** Gold per month per adjacent water tile, from the naval line. */
  goldPerWaterTile: number;
}

/** Roll a settlement's completed buildings up into the numbers the simulation needs. */
export function summariseBuildings(ids: readonly string[]): BuildingSummary {
  const summary: BuildingSummary = {
    housingLevel: 0,
    growthPeople: 0,
    goldPerMonth: 0,
    defencePercent: 0,
    goldPerWaterTile: 0,
  };

  for (const id of ids) {
    const building = buildingById(id);
    if (!building) continue;
    // Chain lines replace rather than stack, so take the best rather than the sum.
    summary.defencePercent = Math.max(summary.defencePercent, building.defencePercent);
    summary.goldPerMonth = Math.max(summary.goldPerMonth, building.goldPerMonth);
    summary.goldPerWaterTile = Math.max(summary.goldPerWaterTile, building.goldPerWaterTile);
    if (building.line === 'housing') {
      summary.housingLevel = Math.max(summary.housingLevel, building.level);
    }
    // Growth is the exception: housing and halls **accumulate**. A city with Wooden Houses,
    // Stone Houses and Villas standing has all three, and the roofs of all three.
    summary.growthPeople += building.growthPeople;
  }
  return summary;
}

/**
 * What a settlement may start building right now.
 *
 * Chain lines offer only the next level up, and only if the settlement tier allows it, so the
 * list is always short and never shows a building that is already superseded.
 */
export function availableBuildings(options: {
  tier: number;
  built: readonly string[];
  queued: readonly string[];
  coastal: boolean;
}): readonly Building[] {
  const { tier, built, queued, coastal } = options;
  const claimed = new Set([...built, ...queued]);

  const levelInLine = new Map<BuildingLine, number>();
  for (const id of claimed) {
    const building = buildingById(id);
    if (!building) continue;
    levelInLine.set(building.line, Math.max(levelInLine.get(building.line) ?? 0, building.level));
  }

  return loadBuildings().filter((building) => {
    if (building.minTier > tier) return false;
    if (building.coastal && !coastal) return false;
    if (claimed.has(building.id)) return false;
    if (!CHAIN_LINES.includes(building.line)) return true;
    return building.level === (levelInLine.get(building.line) ?? 0) + 1;
  });
}
