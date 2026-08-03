import { TERRAINS, type ResourceType, type Terrain } from '../data/world';

/**
 * Placeholder art. Every colour here is temporary and will be replaced by the owner's 2D
 * tileset — nothing outside this module should know what a terrain looks like.
 */

export const TERRAIN_COLOR: Record<Terrain, string> = {
  water: '#16324a',
  plains: '#7f8d52',
  forest: '#3d5b3a',
  steppe: '#9c9457',
  desert: '#c2a877',
  tundra: '#93a5a8',
  mountain: '#6f6558',
};

export const RESOURCE_COLOR: Record<ResourceType, string> = {
  gold: '#e8c04a',
  silver: '#dfe6ee',
  iron: '#9aa0a6',
  stone: '#b9a68c',
};

export const RESOURCE_GLYPH: Record<ResourceType, string> = {
  gold: 'G',
  silver: 'S',
  iron: 'I',
  stone: 'T',
};

export const CITY_FILL = '#f2e6cf';
export const CITY_STROKE = '#1d1610';
export const LABEL_COLOR = '#f6efe1';
export const LABEL_SHADOW = 'rgba(12, 9, 6, 0.85)';
export const GRID_COLOR = 'rgba(10, 8, 5, 0.16)';
export const VOID_COLOR = '#0d0b08';

/**
 * The fog-of-war shroud, laid over everything out of sight.
 *
 * A wash, not a blackout: the terrain beneath stays readable enough to navigate by, which is
 * what keeps the map a map. What must genuinely be hidden — ownership, armies, whose city that
 * is — is withheld before this is drawn rather than painted and covered over.
 */
export const FOG_COLOR = 'rgba(8, 7, 5, 0.62)';

const SHADE_STEPS = 4;

/**
 * Flat colour fields read as dead space at this scale, so each tile gets a small, stable
 * brightness offset. Stable is the point: it is derived from the coordinates, never random,
 * so the map looks identical every frame and every session.
 */
function shade(hex: string, factor: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const r = clamp(((n >> 16) & 0xff) * factor);
  const g = clamp(((n >> 8) & 0xff) * factor);
  const b = clamp((n & 0xff) * factor);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

/** `TERRAIN_SHADES[terrainIndex * SHADE_STEPS + variant]` — precomputed to keep the draw loop allocation-free. */
export const TERRAIN_SHADES: readonly string[] = TERRAINS.flatMap((terrain) =>
  Array.from({ length: SHADE_STEPS }, (_, i) =>
    shade(TERRAIN_COLOR[terrain], 0.94 + (i / (SHADE_STEPS - 1)) * 0.12),
  ),
);

export const SHADE_COUNT = SHADE_STEPS;

/** Deterministic per-tile variant index. */
export function shadeVariant(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) % SHADE_STEPS;
}
