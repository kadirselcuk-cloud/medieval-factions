import { describe, expect, it } from 'vitest';
import { loadEurope1350 } from '../data/maps';
import { tileIndex, type World } from '../data/world';
import {
  landmassOf,
  reachedIn,
  sameLandmass,
  UNREACHABLE,
  walkingDistanceFrom,
} from './geography';

/**
 * Land geography.
 *
 * The case that matters is the owner's: two tiles a single diagonal step apart, with no orthogonal
 * route between them that is not a long walk around the water. Straight-line distance calls that
 * 1; an army calls it 8; and an AI that believes the 1 pins itself on a target forever.
 */

/** Build a world from an ASCII picture. `L` is land, `W` is water. */
function pictureWorld(rows: readonly string[]): World {
  const height = rows.length;
  const width = rows[0]!.length;
  const terrain = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // 0 is water and 1 is plains, per TERRAINS in data/world.ts.
      terrain[y * width + x] = rows[y]![x] === 'W' ? 0 : 1;
    }
  }
  return {
    id: 'test',
    name: 'test',
    width,
    height,
    bounds: { lon_min: 0, lon_max: 1, lat_min: 0, lat_max: 1 },
    terrain,
    features: new Array<undefined>(width * height).fill(undefined),
    cities: [],
    resources: [],
  } as World;
}

describe('land geography', () => {
  // The owner's picture. P is the army, T the target it keeps trying to walk to.
  const rows = [
    'LLLLLL', //
    'LLPWWL',
    'WWWTLL',
  ];
  const world = pictureWorld(rows);
  const P = tileIndex(world, 2, 1);
  const T = tileIndex(world, 3, 2);

  it('measures the walk, not the straight line', () => {
    const from = walkingDistanceFrom(world, [P]);

    // One diagonal step apart, and eight tiles of walking around the water to get there.
    expect(reachedIn(from, T)).toBe(8);
    expect(reachedIn(from, tileIndex(world, 1, 1))).toBe(1); // the neighbour it can actually reach
  });

  it('never routes through water', () => {
    const from = walkingDistanceFrom(world, [P]);
    expect(from[tileIndex(world, 3, 1)]).toBe(UNREACHABLE); // the strait itself
    expect(from[tileIndex(world, 0, 2)]).toBe(UNREACHABLE); // sea in the corner
  });

  it('knows P and T are on the same landmass, the long way round', () => {
    expect(sameLandmass(world, P, T)).toBe(true);
    expect(landmassOf(world, tileIndex(world, 3, 1))).toBe(0); // water belongs to none
  });

  it('separates a genuine island, and water is never connected to anything', () => {
    const island = pictureWorld([
      'LLWWLL', //
      'LLWWLL',
    ]);
    const west = tileIndex(island, 0, 0);
    const east = tileIndex(island, 5, 0);
    const sea = tileIndex(island, 2, 0);

    expect(sameLandmass(island, west, east)).toBe(false);
    expect(sameLandmass(island, sea, sea)).toBe(false);
    expect(reachedIn(walkingDistanceFrom(island, [west]), east)).toBe(Number.POSITIVE_INFINITY);
  });

  it('sweeps from every source at once, taking the nearest', () => {
    const from = walkingDistanceFrom(world, [P, tileIndex(world, 5, 2)]);
    // T is 8 tiles from P but 2 from the second source, and the sweep takes the nearer.
    expect(reachedIn(from, T)).toBe(2);
  });

  it('finds Europe genuinely disconnected, which is what the AI kept walking into', () => {
    const europe = loadEurope1350();
    const paris = europe.cities.find((c) => c.name === 'Paris');
    expect(paris).toBeDefined();

    const from = walkingDistanceFrom(europe, [paris!.index]);
    const unreachable = europe.cities.filter(
      (city) => reachedIn(from, city.index) === Number.POSITIVE_INFINITY,
    );

    // Britain, Ireland, Scandinavia, the islands and Africa — the naval phase's whole reason for
    // existing, and until now the AI treated them as ordinary neighbours.
    expect(unreachable.length).toBeGreaterThan(0);
    console.log(
      'unreachable from Paris on foot:',
      unreachable.map((c) => c.name).join(', '),
    );
  });
});
