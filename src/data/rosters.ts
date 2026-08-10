import { z } from 'zod';
import rawRosters from '../../data/rosters.json';
import { loadShips, loadUnits, unitById, type Unit } from './units';

/**
 * What each realm calls its troops, what that costs it, and the two bonuses it plays with.
 *
 * Owner-specified in 0.20.0. Three rules shape the whole file, and every one of them is there to
 * keep identity from becoming imbalance:
 *
 * **Only combat and marching stats may vary** — `hp`, `damage`, `strategicSpeed`. Cost, `size`,
 * upkeep and build time are identical in every realm. A Longbowman and a Toxotes take the same
 * hundred gold, the same sixty people and the same four months, so no faction is quietly richer or
 * more populous for its roster. What differs is how the men fight, which is the only thing a name
 * ought to promise.
 *
 * **Every renaming is a trade.** A unit that gains hit points loses damage and the other way about,
 * owner-specified: *"if you change the unit's name, give some advantages and matching
 * disadvantages."* A few units are given a small net gain or loss where the history plainly asks for
 * it — a Landsknecht is simply good — but nothing is a free upgrade of its base.
 *
 * **Deltas, not absolutes.** Each figure is added to the base in `data/units.json`, so retuning a
 * base unit carries through to all fourteen rosters at once and no faction silently keeps an old
 * number. It also makes the trade legible: `hp +10, damage -2` says what it is.
 *
 * **Names are English, or the accepted English form** — Longbowman, Gendarme, Cataphract, Bardiche
 * Axeman, Mountain Spearman. A native word survives only where it is what English actually calls the
 * thing: Azab, Jinete, Akinci, Coustillier, Stradiot, Druzhina. Names are shared across realms
 * wherever sharing is honest, so no category has thirteen different words for the same job — but no
 * realm is all-generic either, which was the fault of 0.20.1 and the owner's second correction.
 *
 * **Exactly one land unit per realm is its `unique` one** (0.20.2): the Longbowman, the Janissary,
 * the Gendarme, the Almogavar, the Bardiche Axeman, the Mountain Spearman. It is the signature a
 * player picks the faction to field and carries the largest trade in that realm's roster.
 *
 * **The skirmisher line throws things.** It is range 30 at accuracy 0.3 — a javelin, a sling, a dart.
 * Javelineer, Slinger, Peltast, Kern, Bedouin Skirmisher. The handgunner and naphtha thrower 0.20.1
 * put there were simply the wrong weapon and are gone.
 */

const deltaSchema = z.object({
  name: z.string().min(1),
  /**
   * The realm's **one signature unit** — owner-specified in 0.20.2.
   *
   * Exactly one land unit per realm carries it: the thing a player picks the faction to field, and
   * the largest trade in that realm's roster. Never a ship; the owner asked for a unique land unit.
   */
  unique: z.boolean().default(false),
  /** Added to the base unit's hit points per soldier. */
  hp: z.number().int().default(0),
  /** Added to the base unit's damage per soldier. */
  damage: z.number().int().default(0),
  /** Added to the base unit's strategic speed, in hundredths of a tile per month. */
  strategicSpeed: z.number().int().default(0),
});

export type UnitDelta = z.infer<typeof deltaSchema>;

const economyBonusSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.enum(['gold', 'wood', 'iron', 'stone']),
    permille: z.number().int(),
    text: z.string().min(1),
  }),
  z.object({ kind: z.literal('growth'), people: z.number().int(), text: z.string().min(1) }),
]);

const militaryBonusSchema = z.object({
  kind: z.enum(['hp', 'damage', 'march']),
  permille: z.number().int(),
  text: z.string().min(1),
});

export type EconomyBonus = z.infer<typeof economyBonusSchema>;
export type MilitaryBonus = z.infer<typeof militaryBonusSchema>;

const rosterSchema = z.object({
  bonus: z.object({ economy: economyBonusSchema, military: militaryBonusSchema }),
  units: z.record(z.string(), deltaSchema),
  ships: z.record(z.string(), deltaSchema),
});

export type FactionRoster = z.infer<typeof rosterSchema>;

/** Keys beginning `_` are commentary for whoever edits the file, not data. */
const fileSchema = z.record(z.string(), z.union([z.string(), rosterSchema]));

let cache: Record<string, FactionRoster> | null = null;

function rosters(): Record<string, FactionRoster> {
  if (cache) return cache;
  const parsed = fileSchema.parse(rawRosters);
  const out: Record<string, FactionRoster> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (key.startsWith('_') || typeof value === 'string') continue;
    out[key] = value;
  }
  cache = out;
  return out;
}

/** Every faction id the roster file names. Sorted, so anything built from it is stable. */
export function rosteredFactions(): readonly string[] {
  return Object.keys(rosters()).sort();
}

export function rosterOf(factionId: string): FactionRoster | undefined {
  return rosters()[factionId];
}

/**
 * The two bonuses a realm plays with, or `undefined` for one with no roster.
 *
 * Exposed for the UI as much as for the simulation — the owner asked that what each nation was
 * given be recorded so a faction-selection screen can read it out. `text` is the line to show.
 */
export function bonusesOf(factionId: string): FactionRoster['bonus'] | undefined {
  return rosterOf(factionId)?.bonus;
}

/**
 * The realm's signature unit — its id and how the realm names it, or `undefined` for a realm with
 * no roster. Read by the recruit card, and by anything that wants to say what a faction is *for*.
 */
export function uniqueUnitOf(
  factionId: string,
): { id: string; name: string } | undefined {
  const roster = rosterOf(factionId);
  if (!roster) return undefined;
  for (const [id, delta] of Object.entries(roster.units)) {
    if (delta.unique) return { id, name: delta.name };
  }
  return undefined;
}

/** Whether this realm's version of the unit is its signature one. */
export function isUniqueUnit(factionId: string, unitId: string): boolean {
  return rosterOf(factionId)?.units[unitId]?.unique === true;
}

/** What this realm calls the unit, falling back to the roster's own name. */
export function unitNameFor(factionId: string, unitId: string): string {
  const roster = rosterOf(factionId);
  const named = roster?.units[unitId] ?? roster?.ships[unitId];
  return named?.name ?? unitById(unitId)?.name ?? unitId;
}

/**
 * **The one seam that gives a faction its own version of a unit.**
 *
 * Everything that decides a fight reads a `Unit` — `muster` in battle.ts turns ids into fighters,
 * `armySpeed` asks how fast a stack marches, the AI scores what it can build. Routing all of them
 * through here is what makes a Gendarme different from a Sipahi without a second combat path, a
 * per-faction unit table, or `factionIndex` threaded through forty call sites.
 *
 * Three things are folded in, in order:
 *
 * 1. The base unit from `data/units.json`.
 * 2. The faction's **named delta** — its trade for the name.
 * 3. The faction's **military bonus**, a per-mille on hit points, damage or marching speed, which is
 *    applied to every unit the realm fields rather than to one of them.
 *
 * Floors at 1 for hit points and speed and at 0 for damage, so no combination of a negative delta
 * and a small base can produce a unit that cannot exist. Integer throughout — this feeds the
 * simulation, and a float in a battle would break replay from a save.
 *
 * A faction with no roster entry, or an id the roster does not name, gets the base unit unchanged.
 * That is the Independents, and it is also every faction on a save written before 0.20.0.
 */
export function unitFor(factionId: string, unitId: string): Unit | undefined {
  const base = unitById(unitId);
  if (!base) return undefined;

  const roster = rosterOf(factionId);
  if (!roster) return base;

  const delta = roster.units[unitId] ?? roster.ships[unitId];
  const bonus = roster.bonus.military;

  let hp = base.hp + (delta?.hp ?? 0);
  let damage = base.damage + (delta?.damage ?? 0);
  let speed = base.strategicSpeed + (delta?.strategicSpeed ?? 0);

  if (bonus.kind === 'hp') hp += Math.floor((hp * bonus.permille) / 1000);
  if (bonus.kind === 'damage') damage += Math.floor((damage * bonus.permille) / 1000);
  if (bonus.kind === 'march') speed += Math.floor((speed * bonus.permille) / 1000);

  return {
    ...base,
    name: delta?.name ?? base.name,
    hp: Math.max(1, hp),
    damage: Math.max(0, damage),
    strategicSpeed: Math.max(1, speed),
  };
}

/**
 * Every land unit as this realm fields it, in the roster's own order.
 *
 * The recruit panel reads this so the player sees what *their* Archer is worth rather than the
 * table's, which is what the owner asked for: "show directly those new stats in recruit and other
 * screens."
 */
export function unitsFor(factionId: string): readonly Unit[] {
  return loadUnits()
    .map((unit) => unitFor(factionId, unit.id))
    .filter((unit): unit is Unit => unit !== undefined);
}

/** The same for hulls, for the navy panel. */
export function shipsFor(factionId: string): readonly Unit[] {
  return loadShips()
    .map((ship) => unitFor(factionId, ship.id))
    .filter((unit): unit is Unit => unit !== undefined);
}
