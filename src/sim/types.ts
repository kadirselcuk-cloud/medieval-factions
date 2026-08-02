/**
 * Simulation state.
 *
 * Every number in here is an integer. Money and population are stored in thousandths
 * (`MILLI`) so per-tick accrual is exact and two saves that have run the same ticks are
 * byte-identical. No floats, no dates, no object references into world data — a SimState is
 * meant to be structurally cloned and written straight to disk.
 */

export const MILLI = 1000;

export type Resource = 'gold' | 'wood' | 'iron' | 'stone';
export const RESOURCES: readonly Resource[] = ['gold', 'wood', 'iron', 'stone'];

/** Village 1 → Town 2 → City 3 → Capitol 4. */
export type SettlementTier = 1 | 2 | 3 | 4;

export const TIER_NAME: Record<SettlementTier, string> = {
  1: 'Village',
  2: 'Town',
  3: 'City',
  4: 'Capitol',
};

export type ResourceLedger = Record<Resource, number>;

export interface FactionState {
  /** Index into SimState.factions — also the value stored in SimState.tileOwner. */
  readonly index: number;
  readonly id: string;
  alive: boolean;
  /** Thousandths of a unit held. */
  stock: ResourceLedger;
  /** Sub-tick remainder, 0..TICKS_PER_MONTH-1. Keeps accrual lossless. */
  carry: ResourceLedger;
  /** Whole units per month. Recomputed on month rollover and on ownership change. */
  monthlyIncome: ResourceLedger;
}

/** Work in progress in a settlement. Durations count down in whole months. */
export type ConstructionOrder =
  | { kind: 'building'; id: string; monthsRemaining: number }
  | { kind: 'settlement'; targetTier: SettlementTier; monthsRemaining: number };

export interface CityState {
  /** Index into World.cities. */
  readonly cityIndex: number;
  /** Index into the tile grid. */
  readonly tileIndex: number;
  ownerIndex: number;
  tier: SettlementTier;
  /** Thousandths of a person. */
  populationMilli: number;
  /** Ids of completed buildings. */
  buildings: string[];
  /** Only the head of the queue makes progress. Buildings and units queue separately. */
  queue: ConstructionOrder[];
}

/** Tile improvement kinds, as stored in SimState.improvementKind. -1 means none. */
export const IMPROVEMENT_KINDS = ['farm', 'mine', 'sawmill'] as const;
export type ImprovementIndex = 0 | 1 | 2;

export interface SimState {
  /** Ticks since the campaign began. The only representation of time that exists. */
  tick: number;
  seed: number;
  /** Current PRNG state — part of the save, so a reloaded campaign rolls the same numbers. */
  rng: number;
  playerFactionIndex: number;
  factions: FactionState[];
  cities: CityState[];
  /** Owning faction index per tile, or -1. Parallel to World.terrain. */
  tileOwner: Int8Array;

  // Tile improvements, held as parallel typed arrays rather than objects: 2,450 tiles of
  // mostly-empty state, and they serialise into a save without any conversion.
  /** Index into IMPROVEMENT_KINDS, or -1 for none. */
  improvementKind: Int8Array;
  /** Completed level, 0 if nothing is finished yet. */
  improvementLevel: Uint8Array;
  /** Months left on this tile's current work, 0 when idle. */
  improvementMonths: Uint8Array;
  /** Level being built toward while work is in progress. */
  improvementTarget: Uint8Array;
}

export function emptyLedger(): ResourceLedger {
  return { gold: 0, wood: 0, iron: 0, stone: 0 };
}

/** Whole units, for display. */
export function whole(milli: number): number {
  return Math.floor(milli / MILLI);
}

/**
 * mulberry32. Small, fast, and fully determined by an integer state that lives in the save.
 * Nothing in the simulation may use Math.random.
 */
export function nextRandom(state: SimState): number {
  state.rng = (state.rng + 0x6d2b79f5) | 0;
  let t = state.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Uniform integer in [0, bound). */
export function nextRandomInt(state: SimState, bound: number): number {
  return Math.floor(nextRandom(state) * bound);
}
