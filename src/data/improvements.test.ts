import { describe, expect, it } from 'vitest';
import { BASE_TILE_GOLD, MAX_IMPROVEMENT_LEVEL, tileOutput } from './improvements';
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

describe('tileOutput', () => {
  // Holding ground pays BASE_TILE_GOLD on its own; improvements add on top of it.
  it('pays the base tile gold for a bare land tile', () => {
    expect(tileOutput({ terrain: 'plains', improvement: null, level: 0, node: null })).toEqual({
      gold: BASE_TILE_GOLD,
      wood: 0,
      iron: 0,
      stone: 0,
    });
  });

  it('pays a token yield for owning an unmined node, on top of the base', () => {
    // Gold node, 20 base, on mountain (mines ++) -> 40, plus the tile's own 10.
    expect(tileOutput({ terrain: 'mountain', improvement: null, level: 0, node: 'gold' })).toMatchObject({
      gold: 40 + BASE_TILE_GOLD,
    });
    // The same node on plains (mines --) is worth a fifth.
    expect(tileOutput({ terrain: 'plains', improvement: null, level: 0, node: 'gold' })).toMatchObject({
      gold: 4 + BASE_TILE_GOLD,
    });
  });

  it('scales farms by terrain', () => {
    const farm = (terrain: Parameters<typeof tileOutput>[0]['terrain'], level: number) =>
      tileOutput({ terrain, improvement: 'farm', level, node: null }).gold - BASE_TILE_GOLD;

    expect(farm('plains', 1)).toBe(20);
    expect(farm('plains', 4)).toBe(80);
    expect(farm('steppe', 1)).toBe(15);
    expect(farm('forest', 1)).toBe(10);
    expect(farm('tundra', 1)).toBe(6);
    expect(farm('desert', 1)).toBe(2);
  });

  // Wood is the scarcest resource: a Town upgrade needs 100 of it and nothing else makes any.
  it('keeps sawmill output deliberately small', () => {
    expect(tileOutput({ terrain: 'plains', improvement: 'sawmill', level: 1, node: null }).wood).toBe(1);
    expect(tileOutput({ terrain: 'forest', improvement: 'sawmill', level: 1, node: null }).wood).toBe(2);
    expect(tileOutput({ terrain: 'forest', improvement: 'sawmill', level: 4, node: null }).wood).toBe(8);
    expect(tileOutput({ terrain: 'tundra', improvement: 'sawmill', level: 2, node: null }).wood).toBe(4);
    // Desert at -80% floors to nothing at all.
    expect(tileOutput({ terrain: 'desert', improvement: 'sawmill', level: 1, node: null }).wood).toBe(0);
  });

  it('gives a mine on an ordinary tile both metals', () => {
    const output = tileOutput({ terrain: 'mountain', improvement: 'mine', level: 2, node: null });
    expect(output.iron).toBe(4);
    expect(output.stone).toBe(4);
    expect(output.gold).toBe(BASE_TILE_GOLD);
  });

  it('routes silver into the gold stockpile', () => {
    const output = tileOutput({ terrain: 'forest', improvement: 'mine', level: 3, node: 'silver' });
    // 100 at level 3, forest mines -- -> 20, plus the tile's own base.
    expect(output.gold).toBe(20 + BASE_TILE_GOLD);
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
