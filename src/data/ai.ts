import { z } from 'zod';
import rawAi from '../../data/ai.json';
import type { AiDifficulty, AiPersonality } from '../sim/types';

/**
 * How the rival realms play, as data.
 *
 * `src/sim/ai.ts` holds no tuning constants of its own — every number it uses comes from
 * `data/ai.json`, so the whole AI can be retuned without touching code. That is the same rule
 * units, buildings and terrain already follow (docs/DESIGN.md §4).
 *
 * The literal unions live in `sim/types.ts` because they are part of a save. The schemas here
 * are pinned to those unions and the file is cross-checked at boot, so data and code cannot
 * quietly disagree about what a difficulty is called.
 */

export const AI_DIFFICULTIES: readonly AiDifficulty[] = [
  'recruit',
  'squire',
  'knight',
  'baron',
  'king',
];

export const AI_PERSONALITIES: readonly AiPersonality[] = [
  'ambitious',
  'defensive',
  'balanced',
  'peaceful',
  'honorable',
];

/** The rung with no handicap either way — the AI plays the player's economy exactly. */
export const LEVEL_DIFFICULTY: AiDifficulty = 'knight';

const difficultySchema = z.object({
  id: z.enum(['recruit', 'squire', 'knight', 'baron', 'king']),
  name: z.string().min(1),
  blurb: z.string().min(1),
  /** Gross income multiplier, per-mille. 1000 is the player's own economy. */
  incomePermille: z.number().int().positive(),
  /** Strength ratio it wants over a target before it will commit, per-mille. */
  oddsPermille: z.number().int().positive(),
  /**
   * Units a realm considers a full stack — **a target, not a ceiling.**
   *
   * There is no limit on how many armies a realm may field. It raises what it can pay for and
   * spare the people for; the limits that remain are the honest ones — the treasury, the manpower
   * ceiling and the levy floors. `maxArmies` was removed in 0.17.1 for exactly that reason.
   */
  armyUnits: z.number().int().positive(),
  /** Chance per month it simply wastes the month, per-mille. This is the "makes mistakes" lever. */
  ditherPermille: z.number().int().min(0).max(1000),
  /**
   * How far ahead it will save for something it cannot yet afford.
   *
   * The lever that decides whether a realm ever becomes a Capitol: an AI that only ever buys
   * what it can afford today buys palisades forever and never the 20,000-gold upgrade.
   */
  patienceMonths: z.number().int().nonnegative(),
  /** Whether it marches to relieve its own besieged settlements. */
  reacts: z.boolean(),
  /** Whether it develops its tiles at all. */
  improves: z.boolean(),
  /**
   * How many of this realm's armies may be detached from the main war — docs/MECHANICS.md §8.
   *
   * The difficulty decides **how many** specialists a realm can run; the personality decides how
   * big each one is and whether it wants them at all. A Recruit fields one army and it is the war;
   * a King can afford two raiding columns and two border garrisons on top of its field force.
   *
   * Detachments come out of the armies a realm already fields, so it never gets more troops for
   * having them — it gets a different shape. **[GEN]**
   */
  raidStacks: z.number().int().nonnegative(),
  guardStacks: z.number().int().nonnegative(),
  claimStacks: z.number().int().nonnegative(),
  /**
   * Tile improvements a realm may have under construction at once.
   *
   * It was one, realm-wide, for every difficulty — so a realm holding forty tiles dug roughly one
   * farm a year and its conquests stayed bare ground for a century. **[GEN]**
   */
  improvementsAtOnce: z.number().int().positive(),
});

const buildWeightsSchema = z.object({
  housing: z.number().int().nonnegative(),
  fortification: z.number().int().nonnegative(),
  commerce: z.number().int().nonnegative(),
  administration: z.number().int().nonnegative(),
  military: z.number().int().nonnegative(),
  naval: z.number().int().nonnegative(),
  /** Growing the settlement itself into its next tier. */
  expand: z.number().int().nonnegative(),
  /** Farms, mines and sawmills on the ground it holds. */
  improve: z.number().int().nonnegative(),
});

const personalitySchema = z.object({
  id: z.enum(['ambitious', 'defensive', 'balanced', 'peaceful', 'honorable']),
  name: z.string().min(1),
  blurb: z.string().min(1),
  /** Multiplies the difficulty's odds requirement. Below 1000 is braver, above it is warier. */
  aggressionPermille: z.number().int().positive(),
  /**
   * The chance, per army raised, that it rides off raiding rather than joining the war — and the
   * chance it is posted to the border instead. Per-mille; whatever is left over is a field army.
   *
   * **These replaced `reach` in 0.17.0.** Every realm now tries to conquer the world and none has
   * a distance beyond which it stops looking, so what separates one realm from another is no
   * longer *how far* it will go but **what it does with the armies it has**. Peaceful raids at 0
   * and garrisons heavily; Ambitious is the reverse.
   */
  raidPermille: z.number().int().min(0).max(1000),
  guardPermille: z.number().int().min(0).max(1000),
  /**
   * How far around each of its settlements it will fill in unclaimed ground before looking
   * further afield.
   *
   * This is what stops a realm running a one-tile-wide corridor across Europe to the first city
   * it can beat. Consolidating pays: every tile is income, and a solid border is one an army can
   * actually be brought back through.
   */
  claimRadius: z.number().int().positive(),
  /**
   * Units in one raiding column, or **0 for a realm that does not raid at all** — Peaceful.
   *
   * Small and fast on purpose: a raid is not a second field army, it is a few riders past the
   * frontier making a nuisance of themselves where the walls are not. Cavalry for preference,
   * because since 0.16.0 horse moves twice as fast as foot and depth is the whole point.
   */
  raidUnits: z.number().int().nonnegative(),
  /** Units left standing on each frontier settlement a border garrison holds. */
  guardUnits: z.number().int().positive(),
  /** Units held back in every settlement before any are sent to the field. */
  garrisonKeep: z.number().int().nonnegative(),
  /**
   * People it will always leave standing in a settlement rather than put under arms.
   *
   * Well above the survival floor on purpose. Manpower spent on a unit is spent for good and
   * flat growth never earns it back, so a realm that levies to the last hundred has sold its
   * future for one army.
   */
  levyFloor: z.number().int().nonnegative(),
  /** Willing to starve a settlement out when it cannot be stormed. False means it storms or leaves. */
  prefersSiege: z.boolean(),

  // --- Scruples. All five personalities currently share the permissive values below.
  //
  // They are the seam diplomacy plugs into. Honour was originally the difference between how two
  // realms *fought* — no starving a city out, no piling onto a realm somebody else already had by
  // the throat, no attacking one far weaker. That was the wrong place for it: how a realm fights
  // is a matter of tactics, and honour is a matter of who it will deal with. The rules stay,
  // wired and tested, so diplomacy can turn them back on for the realms they belong to.

  /** Attack a realm that somebody else already has a settlement of under siege. */
  dogpiles: z.boolean(),
  /** Make war on other realms at all, as opposed to only settling unclaimed ground. */
  attacksRealms: z.boolean(),
  /** Least a rival realm may be worth, relative to this one, before it is beneath attacking. */
  bullyFloorPermille: z.number().int().min(0),
  build: buildWeightsSchema,
  unitBias: z.object({
    infantry: z.number().int().nonnegative(),
    ranged: z.number().int().nonnegative(),
    cavalry: z.number().int().nonnegative(),
  }),
});

const fileSchema = z.object({
  difficulties: z.array(difficultySchema).length(5),
  personalities: z.array(personalitySchema).length(5),
});

export type AiDifficultyProfile = z.infer<typeof difficultySchema>;
export type AiPersonalityProfile = z.infer<typeof personalitySchema>;
export type BuildWeights = z.infer<typeof buildWeightsSchema>;
export type BuildWeightKey = keyof BuildWeights;

let parsed: z.infer<typeof fileSchema> | undefined;

function data(): z.infer<typeof fileSchema> {
  if (!parsed) {
    const file = fileSchema.parse(rawAi);

    // A missing rung would leave a campaign with no way to describe its own opponents, and a
    // duplicate would silently shadow one. Neither shows up until a save fails to load.
    for (const id of AI_DIFFICULTIES) {
      if (file.difficulties.filter((d) => d.id === id).length !== 1) {
        throw new Error(`ai.json: difficulties must name "${id}" exactly once`);
      }
    }
    for (const id of AI_PERSONALITIES) {
      if (file.personalities.filter((p) => p.id === id).length !== 1) {
        throw new Error(`ai.json: personalities must name "${id}" exactly once`);
      }
    }
    parsed = file;
  }
  return parsed;
}

export function loadDifficulties(): readonly AiDifficultyProfile[] {
  return AI_DIFFICULTIES.map((id) => difficultyProfile(id));
}

export function loadPersonalities(): readonly AiPersonalityProfile[] {
  return AI_PERSONALITIES.map((id) => personalityProfile(id));
}

export function difficultyProfile(id: AiDifficulty): AiDifficultyProfile {
  const found = data().difficulties.find((d) => d.id === id);
  if (!found) throw new Error(`ai.json has no difficulty "${id}"`);
  return found;
}

export function personalityProfile(id: AiPersonality): AiPersonalityProfile {
  const found = data().personalities.find((p) => p.id === id);
  if (!found) throw new Error(`ai.json has no personality "${id}"`);
  return found;
}
