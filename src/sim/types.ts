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

/**
 * A settlement never falls below this, however deep the debt or how many men it has levied.
 * **[GEN]**
 */
export const MIN_POPULATION = 100;

/**
 * How well a realm is played — docs/MECHANICS.md §8. Knight is the honest rung: no handicap
 * and no assistance, the same rules the player has.
 */
export type AiDifficulty = 'recruit' | 'squire' | 'knight' | 'baron' | 'king';

/** What kind of realm it is. Decides what it builds, whom it attacks, and later how it talks. */
export type AiPersonality = 'ambitious' | 'defensive' | 'balanced' | 'peaceful' | 'honorable';

/**
 * Difficulty is one setting across every rival; personality is per realm. Part of the save,
 * because a campaign reloaded against different opponents is a different campaign.
 */
export interface AiProfile {
  difficulty: AiDifficulty;
  personality: AiPersonality;
}

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
  /**
   * Who is playing this realm, or `null` for the player and for the neutral Independents.
   *
   * The Independents deliberately have none: they hold 47 settlements and are the unclaimed
   * ground every realm expands into, not a rival with ambitions of their own.
   */
  ai: AiProfile | null;
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

/**
 * A settlement under siege — docs/MECHANICS.md §6.
 *
 * A siege is held by presence: it lasts only while the besieging realm keeps an army beside the
 * walls, and it ends the moment that army leaves or dies. While it holds, the settlement pays
 * its owner nothing, builds nothing, trains nothing and slowly starves.
 */
export interface SiegeState {
  /** The realm pressing the siege. */
  byIndex: number;
  /** Months before the defenders must sortie or surrender. Owner-authored, per tier. */
  monthsRemaining: number;
  /** Months endured so far, for the panel. */
  monthsHeld: number;
}

export interface CityState {
  /** Index into World.cities. */
  readonly cityIndex: number;
  /** Index into the tile grid. */
  readonly tileIndex: number;
  ownerIndex: number;
  tier: SettlementTier;
  /**
   * Whole people.
   *
   * Not fixed-point, unlike money: population growth is a **flat number of people per month**
   * rather than a percentage (docs/MECHANICS.md §5), so there is no fraction of a person to
   * keep and nothing to accumulate. That is the whole reason this is a plain integer.
   */
  population: number;
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
  /** Set while a hostile realm has the settlement invested. */
  siege: SiegeState | null;
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

// ------------------------------------------------------------------- battles

/** 0 attacker, 1 defender. Used as an index throughout a battle report. */
export type BattleSide = 0 | 1;

/**
 * Where a fighter came from, so survivors can be written back to the right place.
 *
 * A settlement puts three quite different things on the field: its derived `defence`, which
 * costs nothing and leaves nothing behind; its `garrison`, which is recruited units that go
 * back into the city if it holds; and an `army` standing on the tile.
 */
export type FighterSource = 'army' | 'garrison' | 'defence';

export type BattleWinner = 'attacker' | 'defender' | 'stalemate';

/** How the battle ended: one side wiped out, the 3× rout rule, or the 48-turn cap. */
export type BattleEnding = 'destroyed' | 'rout' | 'cap';

export interface BattleFighter {
  /** Index into BattleReport.fighters. Every action refers to a slot. */
  slot: number;
  side: BattleSide;
  source: FighterSource;
  unitId: string;
  /** Soldiers it started with. */
  soldiers: number;
  /** Tiles from the attacker's edge at the opening bell — 0 or FIELD_WIDTH. */
  position: number;
  /**
   * Defender's advantage this formation fought under, per-mille; 0 for attackers.
   *
   * Carried per formation because a relieving army that marched to a siege fights in the open
   * while the men on the walls beside it do not.
   */
  advantage: number;
}

export type BattleAction =
  | { kind: 'move'; slot: number; to: number }
  | { kind: 'shoot'; slot: number; target: number; casualties: number; charge: false }
  | { kind: 'strike'; slot: number; target: number; casualties: number; charge: boolean };

export interface BattleTurn {
  /** 1-based. One in-game hour; six of them make a tick. */
  turn: number;
  actions: BattleAction[];
}

/** Defender's advantage, in per-mille, split into the terms that produced it. */
export interface BattleAdvantage {
  terrain: number;
  settlement: number;
  fortification: number;
  winter: number;
  /** The sum, capped. This is the number the damage formula uses. */
  total: number;
}

/**
 * A fought battle, complete enough to replay tile by tile.
 *
 * The report is the only record: the simulation applies the outcome immediately and keeps the
 * log purely so the player can watch what already happened. Only the last few are kept.
 */
export interface BattleReport {
  id: number;
  tick: number;
  tileIndex: number;
  /** Index into World.cities when a settlement was assaulted, else -1. */
  cityIndex: number;
  attackerIndex: number;
  defenderIndex: number;
  advantage: BattleAdvantage;
  fighters: BattleFighter[];
  turns: BattleTurn[];
  winner: BattleWinner;
  ending: BattleEnding;
  /** Soldiers killed, by side. */
  losses: [number, number];
  /** Whole units fielded, by side. */
  before: [Record<string, number>, Record<string, number>];
  /** Whole units walking away, by side. */
  after: [Record<string, number>, Record<string, number>];
  /** True when the settlement changed hands. */
  captured: boolean;
}

/** Battles are heavy; only the most recent are kept, and only so they can be watched. */
export const MAX_STORED_BATTLES = 3;

export type EventKind =
  | 'building'
  | 'settlement'
  | 'unit'
  | 'ship'
  | 'improvement'
  | 'desertion'
  | 'army'
  | 'battle'
  | 'siege'
  | 'conquest';

/** A thing that finished. Kept in state so the log survives a save. */
export interface GameEvent {
  tick: number;
  kind: EventKind;
  text: string;
  /** Where it happened, so a notification can be clicked through to the map. */
  tileIndex: number;
  factionIndex: number;
  /** Set on battle events, so clicking one opens the report if it is still held. */
  battleId?: number | undefined;
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
  /** Recently fought battles, newest first, trimmed to MAX_STORED_BATTLES. */
  battles: BattleReport[];
  nextBattleId: number;
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

  /**
   * 1 per tile the **player's** realm has ever known — see vision.ts.
   *
   * The one part of fog of war that has to be remembered rather than derived, because "has anyone
   * ever stood here" is a fact about the campaign's history. Monotonic: bits are only ever set,
   * never cleared, so losing a province does not unlearn its geography.
   *
   * Player-only and write-only as far as the simulation is concerned. Nothing outside the renderer
   * reads it, the rivals do not have one, and no rule consults it — a campaign runs identically
   * whether or not it is maintained, which is what keeps it out of every determinism argument.
   */
  discovered: Uint8Array;

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
