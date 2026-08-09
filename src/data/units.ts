import { z } from 'zod';
import rawUnits from '../../data/units.json';

/**
 * Unit and ship roster.
 *
 * HP and damage are **per soldier**, so a unit's strength is `size × hp`. The combat modifiers
 * are carried here from the design docs even though nothing reads them until combat lands in
 * 0.8.0 — keeping the roster complete means the battle model will not need a data migration.
 *
 * **Since 0.18.0 a ship is a unit** (docs/DESIGN.md decision 121). Its crew is its `size` and its
 * HP and damage are per crewman, so the loader widens every ship into the same `Unit` shape a
 * land unit has. That is what let naval combat reuse the shipped auto-resolve outright rather
 * than growing a second one: `fightBattle`, `stackUpkeep`, `stackSoldiers` and the manpower
 * ceiling all read a fleet through the helpers they already read an army through.
 *
 * The seam is `unitById`, which resolves land units **and** ships. `loadUnits()` stays land-only,
 * so nothing that offers the player something to recruit can accidentally offer a Flagship.
 */

const costSchema = z
  .object({
    gold: z.number().int().nonnegative().default(0),
    wood: z.number().int().nonnegative().default(0),
    iron: z.number().int().nonnegative().default(0),
    stone: z.number().int().nonnegative().default(0),
  })
  .default({});

/**
 * `naval` joins the three land classes so a ship can be a `Unit`.
 *
 * Nothing in the damage formula branches on it — the only class the resolver asks about is
 * `cavalry`, for the spear's matchup — so adding it changes no land outcome. It exists for the
 * UI and for the AI, which need to tell a hull from a horse.
 */
const unitSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  class: z.enum(['infantry', 'ranged', 'cavalry', 'naval']),
  minTier: z.number().int().min(1).max(4),
  /** Building ids that must all be standing in the settlement. */
  requires: z.array(z.string()).default([]),
  cost: costSchema,
  /** Gold per month while the unit exists. */
  upkeep: z.number().int().nonnegative(),
  months: z.number().int().positive(),
  hp: z.number().int().positive(),
  damage: z.number().int().nonnegative(),
  size: z.number().int().positive(),
  range: z.number().int().nonnegative().default(0),
  /**
   * Share of a volley that finds a target — owner-authored, ranged units only.
   *
   * Applied as a straight multiplier on the damage a volley does, not as a hit-or-miss roll
   * per shot: a hundred men loosing at once average out, and an auto-resolve that swung on a
   * coin flip would be worse to watch, not better. **[GEN]** interpretation.
   */
  accuracy: z.number().min(0).max(1).default(1),
  /**
   * Campaign-map speed, authored in **tiles per month** and stored in hundredths of one.
   *
   * Fractions are the point: since 0.16.0 foot troops cross a tile every two months (`0.5`) and
   * horse manages one a month (`1`). The scaling happens here, once, so `Unit.strategicSpeed` is
   * always the integer the simulation wants and no float ever reaches a save — see `SPEED_SCALE`
   * in sim/movement.ts.
   *
   * Authored to two decimal places at most; anything finer is rounded and would be a lie.
   */
  strategicSpeed: z
    .number()
    .positive()
    .transform((tilesPerMonth) => Math.round(tilesPerMonth * 100)),
  battleSpeed: z.number().int().positive(),
  antiCavalry: z.number().default(1),
  rangedResist: z.number().default(0),
  chargeBonus: z.number().default(0),
  chargeMultiplier: z.number().default(1),
});

/**
 * A ship, authored as a hull and widened into a `Unit` on the way in.
 *
 * The transform is the whole trick. What the data file says — crew, one required building — is
 * what a shipwright would say; what the simulation gets is a `Unit` with `size`, a `requires`
 * array and every combat modifier at its neutral value. Ships have no `range`, so they close and
 * fight in melee; no charge, no anti-cavalry bonus and no shield against arrows, because none of
 * those mean anything at sea.
 *
 * `minTier` is fixed at 1 deliberately: a ship is gated by its **building**, never by the
 * settlement's tier, and `requiresBuilding` is the field that does that work.
 */
const shipSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    /** Naval building id required to build it — a Dock, Port or Shipyard. */
    requires: z.string().min(1),
    cost: costSchema,
    upkeep: z.number().int().nonnegative(),
    months: z.number().int().positive(),
    /** Men aboard. Becomes the ship's `size`, so it counts against the manpower ceiling. */
    crew: z.number().int().positive(),
    /** Per crewman, exactly as for a land unit. */
    hp: z.number().int().positive(),
    damage: z.number().int().nonnegative(),
    /** Berths for land units. Only the Transport has any — warships escort, they do not haul. */
    carries: z.number().int().nonnegative().default(0),
    /** Tiles of open sea per month, scaled to hundredths like every other speed. */
    strategicSpeed: z
      .number()
      .positive()
      .transform((tilesPerMonth) => Math.round(tilesPerMonth * 100)),
    battleSpeed: z.number().int().positive(),
  })
  .transform((ship) => ({
    ...ship,
    class: 'naval' as const,
    minTier: 1 as const,
    size: ship.crew,
    /** The building, kept as a string — `requires` has to be an array to satisfy `Unit`. */
    requiresBuilding: ship.requires,
    requires: [ship.requires],
    range: 0,
    accuracy: 1,
    antiCavalry: 1,
    rangedResist: 0,
    chargeBonus: 0,
    chargeMultiplier: 1,
  }));

export type Unit = z.infer<typeof unitSchema>;
export type Ship = z.infer<typeof shipSchema>;

// A ship must be usable anywhere a unit is, or the shared auto-resolve is a lie. Checked at
// compile time rather than trusted: the transform above is easy to break by hand.
const _shipIsAUnit: (ship: Ship) => Unit = (ship) => ship;
void _shipIsAUnit;

const defenceSchema = z.object({
  /** Settlement tier as a string key, because JSON object keys are strings. */
  byTier: z.record(z.string(), z.array(z.string())),
  byBuilding: z.record(z.string(), z.string()),
});

const fileSchema = z.object({
  units: z.array(unitSchema).min(1),
  ships: z.array(shipSchema).min(1),
  defence: defenceSchema,
});

let parsed: z.infer<typeof fileSchema> | undefined;

function data(): z.infer<typeof fileSchema> {
  if (!parsed) {
    const file = fileSchema.parse(rawUnits);
    const ids = new Set<string>();
    for (const entry of [...file.units, ...file.ships]) {
      if (ids.has(entry.id)) throw new Error(`Duplicate unit or ship id "${entry.id}"`);
      ids.add(entry.id);
    }

    // A defence table naming a unit that does not exist would leave a settlement quietly
    // undefended, which is exactly the sort of thing nobody notices until a capital falls.
    const unitIds = new Set(file.units.map((unit) => unit.id));
    for (const tier of ['1', '2', '3', '4']) {
      const roster = file.defence.byTier[tier];
      if (!roster) throw new Error(`units.json: defence.byTier is missing tier ${tier}`);
      for (const id of roster) {
        if (!unitIds.has(id)) throw new Error(`units.json: defence.byTier.${tier} names unknown unit "${id}"`);
      }
    }
    for (const [building, id] of Object.entries(file.defence.byBuilding)) {
      if (!unitIds.has(id)) {
        throw new Error(`units.json: defence.byBuilding.${building} names unknown unit "${id}"`);
      }
    }

    parsed = file;
  }
  return parsed;
}

/** **Land units only.** Everything that offers the player something to recruit goes through this. */
export function loadUnits(): readonly Unit[] {
  return data().units;
}

export function loadShips(): readonly Ship[] {
  return data().ships;
}

/**
 * Any combatant by id — a land unit **or a ship**.
 *
 * The single seam that made naval combat free. Every caller that asks "how many men is this, what
 * does it cost to keep, how hard does it hit" gets a straight answer whether the id names a
 * spearman or a flagship, so `fightBattle`, `stackUpkeep`, `stackSoldiers`, the desertion roll and
 * the manpower ceiling all handle fleets without knowing fleets exist.
 *
 * Land units are searched first. Ids are proven unique across both rosters at load, so the order
 * only decides which array is walked first, never which entry is found.
 */
export function unitById(id: string): Unit | undefined {
  return loadUnits().find((u) => u.id === id) ?? loadShips().find((s) => s.id === id);
}

export function shipById(id: string): Ship | undefined {
  return loadShips().find((s) => s.id === id);
}

/** Whether an id names a hull rather than a soldier. */
export function isShip(id: string): boolean {
  return loadShips().some((s) => s.id === id);
}

/** Berths a bag of ships offers. Only Transports have any — CONTENT §4. */
export function fleetCapacity(ships: UnitStack): number {
  return Object.entries(ships).reduce(
    (berths, [id, count]) => berths + (shipById(id)?.carries ?? 0) * count,
    0,
  );
}

/** Hulls in this bag that carry anything. Capped per fleet — see `MAX_FLEET_TRANSPORTS`. */
export function transportsIn(ships: UnitStack): number {
  return Object.entries(ships).reduce(
    (n, [id, count]) => n + ((shipById(id)?.carries ?? 0) > 0 ? count : 0),
    0,
  );
}

/**
 * True if this bag of ships can force an interception.
 *
 * A warship is exactly a ship that carries nothing — "warships escort, they do not haul" read
 * backwards. Two convoys with no escort between them pass each other untouched, which is the
 * point of the rule: a battle between two merchantmen is two merchantmen staring.
 */
export function hasWarship(ships: UnitStack): boolean {
  return Object.entries(ships).some(
    ([id, count]) => count > 0 && shipById(id) !== undefined && shipById(id)?.carries === 0,
  );
}

/** A unit that can stand on land. Since ships became units, the distinction has to be sayable. */
export type LandClass = Exclude<Unit['class'], 'naval'>;
export type LandUnit = Unit & { class: LandClass };

/**
 * Everything this settlement can train right now — tier reached and prerequisites standing.
 *
 * **Land only, in the type as well as in fact.** Ships live in their own roster and are ordered
 * through `buildableShips`, and saying so here is what lets the AI index its per-class unit bias
 * without a naval case it would never reach.
 */
export function recruitableUnits(tier: number, buildings: readonly string[]): readonly LandUnit[] {
  const standing = new Set(buildings);
  return loadUnits().filter(
    (unit): unit is LandUnit =>
      unit.class !== 'naval' && unit.minTier <= tier && unit.requires.every((id) => standing.has(id)),
  );
}

/** A bag of units, by unit id. Armies, garrisons and city defence all share this shape. */
export type UnitStack = Record<string, number>;

/**
 * The units a settlement defends itself with, from its tier and its buildings.
 *
 * These are **not** owned in the way a recruited unit is: they cost nothing, draw no upkeep,
 * and can never be mobilised into an army. They are the reason a settlement has to be fought
 * for. Derived, never stored — so a settlement that gains a tier or a barracks is stronger the
 * moment the work finishes, and a save can never disagree with the rules.
 */
export function cityDefence(tier: number, buildings: readonly string[]): UnitStack {
  const stack: UnitStack = {};
  const add = (id: string) => {
    stack[id] = (stack[id] ?? 0) + 1;
  };

  for (const id of data().defence.byTier[String(tier)] ?? []) add(id);
  for (const building of buildings) {
    const id = data().defence.byBuilding[building];
    if (id) add(id);
  }
  return stack;
}

/** Building ids that add a permanent defender to the settlement that holds them. */
export function defenceBuildings(): readonly string[] {
  return Object.keys(data().defence.byBuilding);
}

/** The naval building chain, weakest first. A settlement's best rung unlocks everything below it. */
export const NAVAL_BUILDINGS = ['fishery', 'dock', 'port', 'shipyard'] as const;

/** Ships need their naval building; the line is a chain, so anything above it also qualifies. */
export function buildableShips(buildings: readonly string[]): readonly Ship[] {
  const standing = new Set(buildings);
  const rank: readonly string[] = NAVAL_BUILDINGS;
  const best = rank.reduce((highest, id) => (standing.has(id) ? rank.indexOf(id) : highest), -1);
  return loadShips().filter((ship) => rank.indexOf(ship.requiresBuilding) <= best);
}

/**
 * Can an army board here? **Owner-specified: a Dock or better** (docs/DESIGN.md decision 124).
 *
 * A Fishery is not a harbour — it is a boat and a jetty, and the chain starts there for income
 * rather than for shipping. Loading an army wants the rung that can build a hull.
 */
export function canEmbarkFrom(buildings: readonly string[]): boolean {
  const standing = new Set(buildings);
  return standing.has('dock') || standing.has('port') || standing.has('shipyard');
}
