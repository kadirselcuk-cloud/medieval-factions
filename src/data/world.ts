import { mapFileSchema, type MapFile, type TerrainGlyph } from './mapSchema';

/**
 * The map, turned from an owner-authored file into the flat, indexable form the renderer
 * and (later) the simulation consume. Nothing here is stateful — a World is immutable
 * reference data loaded once at boot.
 */

export const TERRAINS = [
  'water',
  'plains',
  'forest',
  'steppe',
  'desert',
  'tundra',
  'mountain',
] as const;

export type Terrain = (typeof TERRAINS)[number];

const TERRAIN_BY_GLYPH: Record<TerrainGlyph, Terrain> = {
  '~': 'water',
  '.': 'plains',
  '*': 'forest',
  ':': 'steppe',
  '_': 'desert',
  '%': 'tundra',
  '^': 'mountain',
};

export const TERRAIN_LABEL: Record<Terrain, string> = {
  water: 'Water',
  plains: 'Plains',
  forest: 'Forest',
  steppe: 'Steppe',
  desert: 'Desert',
  tundra: 'Tundra',
  mountain: 'Mountain',
};

export type ResourceType = 'gold' | 'silver' | 'iron' | 'stone';

const RESOURCE_BY_GLYPH = {
  G: 'gold',
  S: 'silver',
  I: 'iron',
  T: 'stone',
} as const satisfies Record<string, ResourceType>;

export interface City {
  readonly kind: 'city';
  readonly name: string;
  readonly region: string;
  readonly x: number;
  readonly y: number;
  readonly index: number;
}

export interface ResourceNode {
  readonly kind: 'resource';
  readonly resource: ResourceType;
  readonly x: number;
  readonly y: number;
  readonly index: number;
}

export type Feature = City | ResourceNode;

export interface World {
  readonly id: string;
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly bounds: MapFile['bounds'];
  /** Underlying terrain of every tile, as an index into TERRAINS. */
  readonly terrain: Uint8Array;
  /** Feature occupying each tile, or undefined. Parallel to `terrain`. */
  readonly features: readonly (Feature | undefined)[];
  readonly cities: readonly City[];
  readonly resources: readonly ResourceNode[];
}

export function tileIndex(world: { width: number }, x: number, y: number): number {
  return y * world.width + x;
}

export function inBounds(world: World, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < world.width && y < world.height;
}

export function terrainAt(world: World, x: number, y: number): Terrain {
  const raw = world.terrain[tileIndex(world, x, y)];
  const terrain = raw === undefined ? undefined : TERRAINS[raw];
  if (terrain === undefined) {
    throw new RangeError(`terrainAt: tile (${x}, ${y}) is outside the map`);
  }
  return terrain;
}

export function featureAt(world: World, x: number, y: number): Feature | undefined {
  return world.features[tileIndex(world, x, y)];
}

/** All eight neighbours. "Around the tile" means this everywhere in the game. */
export const ADJACENT_8: readonly (readonly [number, number])[] = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];

/** The four orthogonal neighbours — used for starting territory, not for adjacency. */
export const ADJACENT_4: readonly (readonly [number, number])[] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

export function adjacentWaterCount(world: World, x: number, y: number): number {
  let count = 0;
  for (const [dx, dy] of ADJACENT_8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!inBounds(world, nx, ny)) continue;
    if (terrainAt(world, nx, ny) === 'water') count += 1;
  }
  return count;
}

export interface TileInfo {
  x: number;
  y: number;
  /** Flat index into the tile grid. */
  index: number;
  terrain: Terrain;
  feature: Feature | undefined;
  lat: number;
  lon: number;
}

/** Everything the UI needs to describe a tile, independent of any renderer or viewport. */
export function describeTile(world: World, x: number, y: number): TileInfo {
  const { lat, lon } = lonLatOfTile(world, x, y);
  return {
    x,
    y,
    index: tileIndex(world, x, y),
    terrain: terrainAt(world, x, y),
    feature: featureAt(world, x, y),
    lat,
    lon,
  };
}

/** Geographic centre of a tile, derived from the map's bounding box. */
export function lonLatOfTile(world: World, x: number, y: number): { lon: number; lat: number } {
  const { lon_min, lon_max, lat_min, lat_max } = world.bounds;
  return {
    lon: lon_min + ((x + 0.5) / world.width) * (lon_max - lon_min),
    lat: lat_max - ((y + 0.5) / world.height) * (lat_max - lat_min),
  };
}

/**
 * Parse and validate a map file, then flatten it into a World.
 *
 * Beyond the schema this enforces the cross-references the schema cannot see: that the grid
 * matches its declared dimensions, that every feature glyph has a matching record, and that
 * every record sits on the glyph it claims. These are exactly the mistakes hand-editing a map
 * produces, and every one of them is silent corruption if it reaches the simulation.
 */
export function buildWorld(raw: unknown): World {
  const file = mapFileSchema.parse(raw);
  const { width, height } = file;
  const problems: string[] = [];

  if (file.rows.length !== height) {
    problems.push(`declared height ${height} but found ${file.rows.length} rows`);
  }
  file.rows.forEach((row, y) => {
    if (row.length !== width) {
      problems.push(`row ${y} has ${row.length} columns, expected ${width}`);
    }
  });

  const terrain = new Uint8Array(width * height);
  const features: (Feature | undefined)[] = new Array<Feature | undefined>(width * height).fill(
    undefined,
  );
  const cities: City[] = [];
  const resources: ResourceNode[] = [];

  // Records are keyed by position so a feature glyph can find the terrain beneath it.
  const cityByPos = new Map(file.cities.map((c) => [`${c.x},${c.y}`, c]));
  const mineByPos = new Map(file.mines.map((m) => [`${m.x},${m.y}`, m]));

  for (let y = 0; y < Math.min(height, file.rows.length); y++) {
    const row = file.rows[y] ?? '';
    for (let x = 0; x < Math.min(width, row.length); x++) {
      const glyph = row[x] as string;
      const index = y * width + x;
      const key = `${x},${y}`;
      let terrainGlyph: string | undefined;

      if (glyph === 'C') {
        const record = cityByPos.get(key);
        if (!record) {
          problems.push(`city glyph at (${x}, ${y}) has no matching entry in "cities"`);
          continue;
        }
        terrainGlyph = record.terrain;
        const city: City = {
          kind: 'city',
          name: record.name,
          region: record.region,
          x,
          y,
          index,
        };
        features[index] = city;
        cities.push(city);
      } else if (glyph in RESOURCE_BY_GLYPH) {
        const record = mineByPos.get(key);
        if (!record) {
          problems.push(`resource glyph '${glyph}' at (${x}, ${y}) has no matching entry in "mines"`);
          continue;
        }
        if (record.type !== glyph) {
          problems.push(`resource at (${x}, ${y}) is '${record.type}' in "mines" but '${glyph}' on the grid`);
        }
        terrainGlyph = record.terrain;
        const node: ResourceNode = {
          kind: 'resource',
          resource: RESOURCE_BY_GLYPH[glyph as keyof typeof RESOURCE_BY_GLYPH],
          x,
          y,
          index,
        };
        features[index] = node;
        resources.push(node);
      } else {
        terrainGlyph = glyph;
      }

      const resolved = TERRAIN_BY_GLYPH[terrainGlyph as TerrainGlyph];
      if (resolved === undefined) {
        problems.push(`unknown terrain glyph '${terrainGlyph}' at (${x}, ${y})`);
        continue;
      }
      terrain[index] = TERRAINS.indexOf(resolved);
    }
  }

  for (const record of [...file.cities, ...file.mines]) {
    if (record.x >= width || record.y >= height) {
      problems.push(`"${record.name}" at (${record.x}, ${record.y}) is outside the ${width}x${height} grid`);
    }
  }

  if (problems.length > 0) {
    throw new Error(
      `Map "${file.id}" failed validation:\n` + problems.map((p) => `  - ${p}`).join('\n'),
    );
  }

  return {
    id: file.id,
    name: file.name,
    width,
    height,
    bounds: file.bounds,
    terrain,
    features,
    cities,
    resources,
  };
}
