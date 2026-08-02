import { describe, expect, it } from 'vitest';
import rawEurope from '../../data/maps/europe-1350.json';
import { buildWorld, featureAt, lonLatOfTile, terrainAt } from './world';

describe('europe-1350', () => {
  const world = buildWorld(rawEurope);

  it('matches its declared dimensions', () => {
    expect(world.width).toBe(70);
    expect(world.height).toBe(35);
    expect(world.terrain).toHaveLength(70 * 35);
  });

  it('has the expected feature counts', () => {
    expect(world.cities).toHaveLength(60);
    expect(world.resources).toHaveLength(42);
  });

  it('places every city on its recorded terrain', () => {
    for (const record of rawEurope.cities) {
      const feature = featureAt(world, record.x, record.y);
      expect(feature, `${record.name} (${record.x}, ${record.y})`).toMatchObject({
        kind: 'city',
        name: record.name,
      });
      expect(terrainAt(world, record.x, record.y)).toBeTruthy();
    }
  });

  // The bounding box is the only link between tile coordinates and real geography. If this
  // drifts, every future map and any generated map silently lands in the wrong place.
  it('derives coordinates that agree with the authored lat/lon', () => {
    for (const record of [...rawEurope.cities, ...rawEurope.mines]) {
      const { lat, lon } = lonLatOfTile(world, record.x, record.y);
      expect(lat, `${record.name} lat`).toBeCloseTo(record.lat, 6);
      expect(lon, `${record.name} lon`).toBeCloseTo(record.lon, 6);
    }
  });
});

describe('buildWorld validation', () => {
  const minimal = {
    id: 'test',
    name: 'Test',
    width: 3,
    height: 2,
    bounds: { lon_min: 0, lon_max: 3, lat_min: 0, lat_max: 2 },
    legend: {},
    rows: ['...', '...'],
    cities: [],
    mines: [],
  };

  it('accepts a well-formed map', () => {
    expect(() => buildWorld(minimal)).not.toThrow();
  });

  it('rejects a row whose length disagrees with the declared width', () => {
    expect(() => buildWorld({ ...minimal, rows: ['...', '....'] })).toThrow(/row 1 has 4 columns/);
  });

  it('rejects a city glyph with no matching record', () => {
    expect(() => buildWorld({ ...minimal, rows: ['C..', '...'] })).toThrow(/no matching entry/);
  });

  it('rejects an unknown terrain glyph', () => {
    expect(() => buildWorld({ ...minimal, rows: ['..?', '...'] })).toThrow(/unknown terrain glyph/);
  });
});
