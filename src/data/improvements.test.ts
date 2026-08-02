import { describe, expect, it } from 'vitest';
import { MAX_IMPROVEMENT_LEVEL, tileOutput } from './improvements';
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
  it('pays nothing for a bare tile with no node', () => {
    expect(tileOutput({ terrain: 'plains', improvement: null, level: 0, node: null })).toEqual({
      gold: 0,
      wood: 0,
      iron: 0,
      stone: 0,
    });
  });

  it('pays a token yield for owning an unmined node', () => {
    // Gold node, 20 base, on mountain (mines ++) -> 40.
    expect(tileOutput({ terrain: 'mountain', improvement: null, level: 0, node: 'gold' })).toMatchObject({
      gold: 40,
    });
    // The same node on plains (mines --) is worth a fifth.
    expect(tileOutput({ terrain: 'plains', improvement: null, level: 0, node: 'gold' })).toMatchObject({
      gold: 4,
    });
  });

  it('scales farms by terrain', () => {
    expect(tileOutput({ terrain: 'plains', improvement: 'farm', level: 1, node: null }).gold).toBe(20);
    expect(tileOutput({ terrain: 'plains', improvement: 'farm', level: 4, node: null }).gold).toBe(80);
    expect(tileOutput({ terrain: 'steppe', improvement: 'farm', level: 1, node: null }).gold).toBe(15);
    expect(tileOutput({ terrain: 'forest', improvement: 'farm', level: 1, node: null }).gold).toBe(10);
    expect(tileOutput({ terrain: 'tundra', improvement: 'farm', level: 1, node: null }).gold).toBe(6);
    expect(tileOutput({ terrain: 'desert', improvement: 'farm', level: 1, node: null }).gold).toBe(2);
  });

  it('gives a mine on an ordinary tile both metals', () => {
    const output = tileOutput({ terrain: 'mountain', improvement: 'mine', level: 2, node: null });
    expect(output.iron).toBe(4);
    expect(output.stone).toBe(4);
    expect(output.gold).toBe(0);
  });

  it('routes silver into the gold stockpile', () => {
    const output = tileOutput({ terrain: 'forest', improvement: 'mine', level: 3, node: 'silver' });
    // 100 base at level 3, forest mines -- -> 20.
    expect(output.gold).toBe(20);
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
