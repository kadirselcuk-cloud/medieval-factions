import { z } from 'zod';
import rawFactions from '../../data/factions.json';

/**
 * Faction roster. Colours are placeholder art. `playable` is a data flag on purpose — premium
 * faction unlocks must never require a code change (docs/DESIGN.md §4).
 */

const factionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  adjective: z.string().min(1),
  religion: z.enum(['catholic', 'orthodox', 'muslim', 'none']),
  /** Name of the city this faction starts in, matched against the map. Null for Independents. */
  capital: z.string().min(1).nullable(),
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
  /**
   * The line a realm-s border is drawn in — owner-specified in 0.18.9.
   *
   * Two colours rather than one because a wash at a third opacity flattens everything warm into the
   * same beige: Castille, the Golden Horde and the Mamluks were indistinguishable on the map. The
   * fill says whose ground it is at a glance; the border, drawn solid and darker, is what separates
   * two realms whose fills are neighbours on the wheel.
   *
   * Defaulted to the fill so a roster that has not been given one still renders.
   */
  borderColor: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .optional(),
  playable: z.boolean(),
  neutral: z.boolean(),
  /**
   * The character this realm is played with, if the owner has authored one.
   *
   * Absent everywhere for now, and rolled from the campaign seed instead — deciding that the
   * Golden Horde is Ambitious and Byzantium Defensive is a design call, not one to invent.
   * **[OPEN]**, see docs/OPEN-QUESTIONS.md. Filling this field in is a data-only change.
   */
  personality: z
    .enum(['ambitious', 'defensive', 'balanced', 'peaceful', 'honorable'])
    .optional(),
});

const rosterSchema = z.object({ factions: z.array(factionSchema).min(1) });

export type Faction = z.infer<typeof factionSchema>;
export type Religion = Faction['religion'];

export const RELIGION_LABEL: Record<Religion, string> = {
  catholic: 'Catholic',
  orthodox: 'Orthodox',
  muslim: 'Muslim',
  none: '—',
};

let roster: readonly Faction[] | undefined;

export function loadFactions(): readonly Faction[] {
  if (!roster) {
    const parsed = rosterSchema.parse(rawFactions).factions;

    const ids = new Set<string>();
    for (const faction of parsed) {
      if (ids.has(faction.id)) throw new Error(`Duplicate faction id "${faction.id}"`);
      ids.add(faction.id);
    }
    const neutrals = parsed.filter((f) => f.neutral);
    if (neutrals.length !== 1) {
      throw new Error(`Expected exactly one neutral faction, found ${neutrals.length}`);
    }
    roster = parsed;
  }
  return roster;
}

export function neutralFaction(): Faction {
  const neutral = loadFactions().find((f) => f.neutral);
  if (!neutral) throw new Error('Roster has no neutral faction');
  return neutral;
}

export function playableFactions(): readonly Faction[] {
  return loadFactions().filter((f) => f.playable);
}
