import { z } from 'zod';

/**
 * Schema for the owner-authored map files in `data/maps/`.
 *
 * These files are hand-edited, so validation is deliberately strict and the errors are
 * meant to be read by a human tuning the game — not swallowed. A typo in a balance table
 * should fail loudly at boot, not surface as NaN gold three hours into a campaign.
 */

const featureGlyph = z.enum(['C', 'G', 'S', 'I', 'T']);
const terrainGlyph = z.enum(['~', '.', '*', ':', '_', '%', '^']);

export type TerrainGlyph = z.infer<typeof terrainGlyph>;
export type FeatureGlyph = z.infer<typeof featureGlyph>;

const cityRecord = z.object({
  name: z.string().min(1),
  region: z.string().min(1),
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  terrain: terrainGlyph,
  lat: z.number(),
  lon: z.number(),
});

const mineRecord = z.object({
  name: z.string().min(1),
  type: z.enum(['G', 'S', 'I', 'T']),
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  terrain: terrainGlyph,
  lat: z.number(),
  lon: z.number(),
});

export const mapFileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  bounds: z.object({
    lon_min: z.number(),
    lon_max: z.number(),
    lat_min: z.number(),
    lat_max: z.number(),
  }),
  legend: z.record(z.string()),
  rows: z.array(z.string()),
  cities: z.array(cityRecord),
  mines: z.array(mineRecord),
});

export type MapFile = z.infer<typeof mapFileSchema>;
export type CityRecord = z.infer<typeof cityRecord>;
export type MineRecord = z.infer<typeof mineRecord>;
