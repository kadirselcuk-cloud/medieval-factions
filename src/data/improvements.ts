import { z } from 'zod';
import rawImprovements from '../../data/improvements.json';
import { TERRAIN_PROFILE, type ImprovementKind } from './terrain';
import type { ResourceType, Terrain } from './world';

/**
 * Tile improvement economics. docs/MECHANICS.md §5.
 *
 * A tile carries **at most one** improvement — a farm, a mine or a sawmill. It is built at
 * level 1 and upgraded up to three more times, and the realm's highest settlement tier caps
 * how far it can go. So a Village-only faction is stuck at level 1 everywhere, and a Capitol
 * unlocks level 4 across the whole realm.
 *
 * Yields are owner-authored. Costs are **[GEN]** proposals, living in
 * `data/improvements.json` so they can be retuned without touching code.
 */

const costSchema = z
  .object({
    gold: z.number().int().nonnegative().default(0),
    wood: z.number().int().nonnegative().default(0),
    iron: z.number().int().nonnegative().default(0),
    stone: z.number().int().nonnegative().default(0),
  })
  .default({});

export type Cost = z.infer<typeof costSchema>;

const kindSchema = z.object({
  name: z.string().min(1),
  /** Indexed by level; index 0 is "not built". */
  yield: z.array(z.number().int().nonnegative()),
  cost: z.array(costSchema),
});

const nodeSchema = z.object({
  resource: z.enum(['gold', 'iron', 'stone']),
  yield: z.array(z.number().int().nonnegative()),
});

const fileSchema = z.object({
  maxLevel: z.number().int().min(1),
  buildMonths: z.array(z.number().int().nonnegative()),
  demolishMonths: z.number().int().nonnegative(),
  baseTileGold: z.number().int().nonnegative(),
  kinds: z.object({
    farm: kindSchema,
    sawmill: kindSchema,
    mine: kindSchema,
  }),
  nodes: z.object({
    gold: nodeSchema,
    silver: nodeSchema,
    iron: nodeSchema,
    stone: nodeSchema,
  }),
});

function load() {
  const data = fileSchema.parse(rawImprovements);
  const expected = data.maxLevel + 1;

  const check = (values: readonly unknown[], what: string) => {
    if (values.length !== expected) {
      throw new Error(`improvements.json: ${what} needs ${expected} entries (level 0..${data.maxLevel}), found ${values.length}`);
    }
  };

  check(data.buildMonths, 'buildMonths');
  for (const [name, kind] of Object.entries(data.kinds)) {
    check(kind.yield, `kinds.${name}.yield`);
    check(kind.cost, `kinds.${name}.cost`);
  }
  for (const [name, node] of Object.entries(data.nodes)) {
    check(node.yield, `nodes.${name}.yield`);
  }
  return data;
}

const DATA = load();

export const MAX_IMPROVEMENT_LEVEL = DATA.maxLevel;
export const DEMOLISH_MONTHS = DATA.demolishMonths;

/**
 * Gold per month for holding a land tile, before any improvement.
 *
 * Territory pays for itself, so taking ground is worth something the month it happens rather
 * than only after twelve months of construction. Flat, and not scaled by terrain — this is
 * the spoils of holding ground, not what the ground grows. **[GEN]**
 */
export const BASE_TILE_GOLD = DATA.baseTileGold;

/** Months to build or upgrade to the given level. */
export function improvementMonths(level: number): number {
  return DATA.buildMonths[clampLevel(level)] ?? 0;
}

/** Cost to build or upgrade to the given level. */
export function improvementCost(kind: ImprovementKind, level: number): Cost {
  return DATA.kinds[kind].cost[clampLevel(level)] ?? { gold: 0, wood: 0, iron: 0, stone: 0 };
}

export function improvementName(kind: ImprovementKind): string {
  return DATA.kinds[kind].name;
}

export interface TileOutput {
  gold: number;
  wood: number;
  iron: number;
  stone: number;
}

const NO_OUTPUT: TileOutput = { gold: 0, wood: 0, iron: 0, stone: 0 };

/**
 * Monthly output of a single tile.
 *
 * Terrain scales every improvement, including mines on resource nodes — a gold mine in the
 * mountains is worth double, a mine on open plains a fifth. Results are floored so the
 * simulation stays in integers.
 */
export function tileOutput(options: {
  terrain: Terrain;
  improvement: ImprovementKind | null;
  level: number;
  /** The resource node on this tile, if any. */
  node: ResourceType | null;
}): TileOutput {
  const { terrain, improvement, node } = options;
  const profile = TERRAIN_PROFILE[terrain];
  const level = clampLevel(options.level);
  if (!profile.buildable) return { ...NO_OUTPUT };

  // Every held land tile pays its base gold, improved or not.
  const base: TileOutput = { ...NO_OUTPUT, gold: BASE_TILE_GOLD };

  if (improvement === null) {
    return node === null ? base : add(base, nodeOutput(node, 0, profile.output.mine));
  }

  switch (improvement) {
    case 'farm':
      return add(base, {
        ...NO_OUTPUT,
        gold: scale(DATA.kinds.farm.yield[level] ?? 0, profile.output.farm),
      });
    case 'sawmill':
      return add(base, {
        ...NO_OUTPUT,
        wood: scale(DATA.kinds.sawmill.yield[level] ?? 0, profile.output.sawmill),
      });
    case 'mine': {
      if (node !== null) return add(base, nodeOutput(node, level, profile.output.mine));
      // A mine on ordinary ground produces both metals.
      const amount = scale(DATA.kinds.mine.yield[level] ?? 0, profile.output.mine);
      return add(base, { ...NO_OUTPUT, iron: amount, stone: amount });
    }
  }
}

function add(a: TileOutput, b: TileOutput): TileOutput {
  return {
    gold: a.gold + b.gold,
    wood: a.wood + b.wood,
    iron: a.iron + b.iron,
    stone: a.stone + b.stone,
  };
}

function nodeOutput(node: ResourceType, level: number, modifier: number): TileOutput {
  const spec = DATA.nodes[node];
  return { ...NO_OUTPUT, [spec.resource]: scale(spec.yield[level] ?? 0, modifier) };
}

function clampLevel(level: number): number {
  return Math.max(0, Math.min(MAX_IMPROVEMENT_LEVEL, Math.floor(level)));
}

function scale(amount: number, modifier: number): number {
  return Math.floor(amount * modifier);
}
