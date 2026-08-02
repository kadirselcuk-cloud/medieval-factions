import { z } from 'zod';
import rawUnits from '../../data/units.json';

/**
 * Unit and ship roster.
 *
 * HP and damage are **per soldier**, so a unit's strength is `size × hp`. The combat modifiers
 * are carried here from the design docs even though nothing reads them until combat lands in
 * 0.7.0 — keeping the roster complete means the battle model will not need a data migration.
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

const fileSchema = z.object({
  units: z.array(unitSchema).min(1),
  ships: z.array(shipSchema).min(1),
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

/** Ships need their naval building; the line is a chain, so anything above it also qualifies. */
export function buildableShips(buildings: readonly string[]): readonly Ship[] {
  const standing = new Set(buildings);
  const rank = ['fishery', 'dock', 'port', 'shipyard'];
  const best = rank.reduce((highest, id) => (standing.has(id) ? rank.indexOf(id) : highest), -1);
  return loadShips().filter((ship) => rank.indexOf(ship.requires) <= best);
}
