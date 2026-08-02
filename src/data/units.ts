import { z } from 'zod';
import rawUnits from '../../data/units.json';

/**
 * Unit and ship roster.
 *
 * HP and damage are **per soldier**, so a unit's strength is `size × hp`. The combat modifiers
 * are carried here from the design docs even though nothing reads them until combat lands in
 * 0.8.0 — keeping the roster complete means the battle model will not need a data migration.
 */

const costSchema = z
  .object({
    gold: z.number().int().nonnegative().default(0),
    wood: z.number().int().nonnegative().default(0),
    iron: z.number().int().nonnegative().default(0),
    stone: z.number().int().nonnegative().default(0),
  })
  .default({});

const unitSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  class: z.enum(['infantry', 'ranged', 'cavalry']),
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
  strategicSpeed: z.number().int().positive(),
  battleSpeed: z.number().int().positive(),
  antiCavalry: z.number().default(1),
  rangedResist: z.number().default(0),
  chargeBonus: z.number().default(0),
  chargeMultiplier: z.number().default(1),
});

const shipSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** Naval building id required to build it. */
  requires: z.string().min(1),
  cost: costSchema,
  upkeep: z.number().int().nonnegative(),
  months: z.number().int().positive(),
});

export type Unit = z.infer<typeof unitSchema>;
export type Ship = z.infer<typeof shipSchema>;

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

export function loadUnits(): readonly Unit[] {
  return data().units;
}

export function loadShips(): readonly Ship[] {
  return data().ships;
}

export function unitById(id: string): Unit | undefined {
  return loadUnits().find((u) => u.id === id);
}

export function shipById(id: string): Ship | undefined {
  return loadShips().find((s) => s.id === id);
}

/** Everything this settlement can train right now — tier reached and prerequisites standing. */
export function recruitableUnits(tier: number, buildings: readonly string[]): readonly Unit[] {
  const standing = new Set(buildings);
  return loadUnits().filter(
    (unit) => unit.minTier <= tier && unit.requires.every((id) => standing.has(id)),
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

/** Ships need their naval building; the line is a chain, so anything above it also qualifies. */
export function buildableShips(buildings: readonly string[]): readonly Ship[] {
  const standing = new Set(buildings);
  const rank = ['fishery', 'dock', 'port', 'shipyard'];
  const best = rank.reduce((highest, id) => (standing.has(id) ? rank.indexOf(id) : highest), -1);
  return loadShips().filter((ship) => rank.indexOf(ship.requires) <= best);
}
