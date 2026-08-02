import { z } from 'zod';
import rawArt from '../../data/art.json';

/**
 * Art and flavour manifest.
 *
 * CLAUDE.md working agreement 6: placeholder art now, real art later, and **all art must be
 * swappable through a manifest — never hardcode an asset path in logic.** So nothing anywhere
 * else in the codebase names an icon or an image. Everything asks here.
 *
 * `blurb` is placeholder prose and **[GEN]**. It is the owner's to rewrite. Note that no
 * number lives here: the detail window derives cost, duration, upkeep and effects from the
 * content files, so flavour text can never drift out of step with the rules.
 */

const entrySchema = z.object({
  icon: z.string().min(1),
  /** Path under `public/`, e.g. "art/buildings/barracks.png". Drawn instead of the icon. */
  image: z.string().optional(),
  blurb: z.string().default(''),
});

export type Art = z.infer<typeof entrySchema>;

const fileSchema = z.object({
  fallback: entrySchema,
  entries: z.record(z.string(), entrySchema),
});

let parsed: z.infer<typeof fileSchema> | undefined;

function data(): z.infer<typeof fileSchema> {
  parsed ??= fileSchema.parse(rawArt);
  return parsed;
}

/**
 * Art for anything with an id — a building, a unit, a ship, an improvement.
 *
 * Falls back rather than throwing. A missing entry should look obviously unfinished on screen,
 * not stop a campaign from loading.
 */
export function artFor(id: string): Art {
  return data().entries[id] ?? data().fallback;
}

/** Settlement upgrades have no id of their own, so they key off the tier they lead to. */
export function settlementArtKey(toTier: number): string {
  return `settlement_${toTier}`;
}
