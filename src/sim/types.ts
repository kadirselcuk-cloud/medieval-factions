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

/** A unit or ship being trained. */
export interface ProductionOrder {
  id: string;
  monthsRemaining: number;
}

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
  /**
   * Three independent queues. Only the head of each advances, but they advance in parallel —
   * building a barracks never blocks training, as long as the prerequisites already stand.
   */
  queue: ConstructionOrder[];
  recruitQueue: ProductionOrder[];
  shipQueue: ProductionOrder[];
  /**
   * Recruited units stationed here, by unit id — the pool an army mobilises from. It is
   * separate from the settlement's own defence, which is derived from tier and buildings,
   * costs nothing and can never leave.
   */
  garrison: Record<string, number>;
  /** Completed ships moored here, by ship id. */
  fleet: Record<string, number>;
}

/** docs/MECHANICS.md §3 — one army per tile, up to twenty units. */
export const MAX_ARMY_UNITS = 20;

/**
 * A field army.
 *
 * Movement is fixed-point. An army banks **march points** each tick and spends them entering
 * tiles; see `MARCH_PER_TILE` in `movement.ts`. Storing the remainder as an integer rather
 * than a float is what keeps a march identical across a save and a reload.
 */
export interface ArmyState {
  /** Stable across the campaign, so the UI can hold a selection through a save. */
  readonly id: number;
  ownerIndex: number;
  tileIndex: number;
  /** Units under arms, by unit id. Never empty — an army that loses its last unit is removed. */
  units: Record<string, number>;
  /** Tiles still to walk, in order, excluding the tile the army stands on. Empty when idle. */
  path: number[];
  /** Banked march points, spent on entering the next tile. */
  march: number;
}

export type EventKind =
  | 'building'
  | 'settlement'
  | 'unit'
  | 'ship'
  | 'improvement'
  | 'desertion'
  | 'army';

/** A thing that finished. Kept in state so the log survives a save. */
export interface GameEvent {
  tick: number;
  kind: EventKind;
  text: string;
  /** Where it happened, so a notification can be clicked through to the map. */
  tileIndex: number;
  factionIndex: number;
}

/** Only the most recent events are kept — this is a notification feed, not an audit trail. */
export const MAX_EVENTS = 40;

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
  armies: ArmyState[];
  /** Next army id to hand out. Monotonic — ids are never reused, so a stale selection is safe. */
  nextArmyId: number;
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

  /** Newest last. Trimmed to MAX_EVENTS. */
  events: GameEvent[];
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
