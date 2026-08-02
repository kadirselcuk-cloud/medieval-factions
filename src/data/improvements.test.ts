import { describe, expect, it } from 'vitest';
import { baseTileYield, MAX_IMPROVEMENT_LEVEL, tileOutput } from './improvements';
import { MODIFIER, TERRAIN_PROFILE } from './terrain';

describe('terrain modifiers', () => {
  // The owner restated this scale explicitly: minus is -40%, not the -50% that symmetry
  // would suggest. Pinning it here so nobody "fixes" it later.
  it('uses the owner-stated modifier scale', () => {
    expect(MODIFIER.plusPlus).toBe(2);
    expect(MODIFIER.plus).toBe(1.5);
    expect(MODIFIER.minus).toBe(0.6);
    expect(MODIFIER.minusMinus).toBe(0.2);
  });

  it('makes water unbuildable and impassable', () => {
    expect(TERRAIN_PROFILE.water.buildable).toBe(false);
    expect(TERRAIN_PROFILE.water.moveCost).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('base tile yield', () => {
  // Owner-authored, per terrain. Pinned here because these are the numbers a player feels
  // the moment they take ground, long before any improvement finishes.
  it('pays the owner-stated yield for each terrain', () => {
    expect(baseTileYield('plains')).toEqual({ gold: 10, wood: 1, iron: 0, stone: 0 });
    expect(baseTileYield('forest')).toEqual({ gold: 5, wood: 1, iron: 0, stone: 0 });
    expect(baseTileYield('steppe')).toEqual({ gold: 5, wood: 0, iron: 0, stone: 0 });
    expect(baseTileYield('tundra')).toEqual({ gold: 2, wood: 1, iron: 0, stone: 0 });
    expect(baseTileYield('desert')).toEqual({ gold: 2, wood: 0, iron: 0, stone: 0 });
    expect(baseTileYield('mountain')).toEqual({ gold: 0, wood: 0, iron: 1, stone: 1 });
    expect(baseTileYield('water')).toEqual({ gold: 0, wood: 0, iron: 0, stone: 0 });
  });

  // The base yield is the terrain's contribution already. Running it through the terrain
  // modifiers as well would count the terrain twice, and mountains would pay 2 iron.
  it('is not scaled by the terrain modifiers', () => {
    expect(tileOutput({ terrain: 'mountain', improvement: null, level: 0, node: null })).toEqual(
      baseTileYield('mountain'),
    );
    expect(tileOutput({ terrain: 'desert', improvement: null, level: 0, node: null })).toEqual(
      baseTileYield('desert'),
    );
  });
});

describe('tileOutput', () => {
  it('pays the terrain base for a bare land tile', () => {
    expect(tileOutput({ terrain: 'plains', improvement: null, level: 0, node: null })).toEqual({
      gold: 10,
      wood: 1,
      iron: 0,
      stone: 0,
    });
  });

  it('pays a token yield for owning an unmined node, on top of the base', () => {
    // Gold node, 20 base, on mountain (mines ++) -> 40. Mountain itself pays no gold.
    expect(tileOutput({ terrain: 'mountain', improvement: null, level: 0, node: 'gold' })).toMatchObject({
      gold: 40,
      iron: 1,
      stone: 1,
    });
    // The same node on plains (mines --) is worth a fifth, plus the plains' own 10.
    expect(tileOutput({ terrain: 'plains', improvement: null, level: 0, node: 'gold' })).toMatchObject({
      gold: 4 + 10,
    });
  });

  it('scales farms by terrain', () => {
    const farm = (terrain: Parameters<typeof tileOutput>[0]['terrain'], level: number) =>
      tileOutput({ terrain, improvement: 'farm', level, node: null }).gold - baseTileYield(terrain).gold;

    expect(farm('plains', 1)).toBe(20);
    expect(farm('plains', 4)).toBe(80);
    expect(farm('steppe', 1)).toBe(15);
    expect(farm('forest', 1)).toBe(10);
    expect(farm('tundra', 1)).toBe(6);
    expect(farm('desert', 1)).toBe(2);
  });

  // Wood is the scarcest resource: a Town upgrade needs 100 of it. The sawmill's own
  // contribution, above whatever the bare terrain already pays.
  it('keeps sawmill output deliberately small', () => {
    const sawmill = (terrain: Parameters<typeof tileOutput>[0]['terrain'], level: number) =>
      tileOutput({ terrain, improvement: 'sawmill', level, node: null }).wood - baseTileYield(terrain).wood;

    expect(sawmill('plains', 1)).toBe(1);
    expect(sawmill('forest', 1)).toBe(2);
    expect(sawmill('forest', 4)).toBe(8);
    expect(sawmill('tundra', 2)).toBe(4);
    // Desert at -80% floors to nothing at all.
    expect(sawmill('desert', 1)).toBe(0);
  });

  it('gives a mine on an ordinary tile both metals', () => {
    const output = tileOutput({ terrain: 'mountain', improvement: 'mine', level: 2, node: null });
    // 2 at level 2, mountain mines ++ -> 4, on top of the mountain's own 1 of each.
    expect(output.iron).toBe(5);
    expect(output.stone).toBe(5);
    expect(output.gold).toBe(0);
  });

  it('routes silver into the gold stockpile', () => {
    const output = tileOutput({ terrain: 'forest', improvement: 'mine', level: 3, node: 'silver' });
    // 100 at level 3, forest mines -- -> 20, plus the forest's own 5.
    expect(output.gold).toBe(25);
    expect(output.iron).toBe(0);
  });

  it('clamps the level to the maximum', () => {
    const capped = tileOutput({ terrain: 'plains', improvement: 'farm', level: 99, node: null });
    const max = tileOutput({
      terrain: 'plains',
      improvement: 'farm',
      level: MAX_IMPROVEMENT_LEVEL,
      node: null,
    });
    expect(capped).toEqual(max);
  });

  it('builds nothing on water', () => {
    expect(tileOutput({ terrain: 'water', improvement: 'farm', level: 4, node: null }).gold).toBe(0);
  });
});
