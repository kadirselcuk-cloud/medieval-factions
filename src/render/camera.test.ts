import { beforeEach, describe, expect, it } from 'vitest';
import rawEurope from '../../data/maps/europe-1350.json';
import { buildWorld } from '../data/world';
import { Camera, OVERSCROLL_TILES } from './camera';

const world = buildWorld(rawEurope);

// 1400x700 over a 70x35 map means the fit zoom is exactly 20 px/tile, which keeps the
// arithmetic in these tests readable.
const VIEW_W = 1400;
const VIEW_H = 700;

describe('Camera', () => {
  let camera: Camera;

  beforeEach(() => {
    camera = new Camera(world);
  });

  it('fits the whole map and centres it', () => {
    camera.fit(VIEW_W, VIEW_H);
    expect(camera.zoom).toBe(20);
    expect(camera.centerX).toBe(35);
    expect(camera.centerY).toBe(17.5);

    const topLeft = camera.worldToScreen(0, 0, VIEW_W, VIEW_H);
    const bottomRight = camera.worldToScreen(world.width, world.height, VIEW_W, VIEW_H);
    expect(topLeft).toEqual({ x: 0, y: 0 });
    expect(bottomRight).toEqual({ x: VIEW_W, y: VIEW_H });
  });

  it('round-trips between screen and world space', () => {
    camera.setZoom(31, VIEW_W, VIEW_H);
    const world1 = camera.screenToWorld(613, 217, VIEW_W, VIEW_H);
    const screen = camera.worldToScreen(world1.x, world1.y, VIEW_W, VIEW_H);
    expect(screen.x).toBeCloseTo(613, 9);
    expect(screen.y).toBeCloseTo(217, 9);
  });

  it('holds the anchored tile still while zooming', () => {
    camera.setZoom(40, VIEW_W, VIEW_H);
    const before = camera.screenToWorld(400, 300, VIEW_W, VIEW_H);
    camera.zoomAt(1.2, 400, 300, VIEW_W, VIEW_H);
    const after = camera.screenToWorld(400, 300, VIEW_W, VIEW_H);

    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
    expect(camera.zoom).toBeCloseTo(48, 9);
  });

  it('never zooms out past the fit zoom, and never past the hard ceiling', () => {
    camera.setZoom(1, VIEW_W, VIEW_H);
    expect(camera.zoom).toBe(20);

    camera.setZoom(9999, VIEW_W, VIEW_H);
    expect(camera.zoom).toBe(48);
  });

  /**
   * The bars and the settlement panel sit over the map, so a coastal city at the edge would be
   * permanently underneath them if the map could not be pulled past its own coastline. Panning
   * therefore runs out exactly `OVERSCROLL_TILES` beyond each edge — no more, and no less.
   */
  it('pans up to ten tiles past each edge, and no further', () => {
    camera.setZoom(40, VIEW_W, VIEW_H);
    const slack = OVERSCROLL_TILES * camera.zoom;

    camera.panByPixels(100_000, 100_000, VIEW_W, VIEW_H);
    const topLeft = camera.worldToScreen(0, 0, VIEW_W, VIEW_H);
    expect(topLeft.x).toBeCloseTo(slack, 6);
    expect(topLeft.y).toBeCloseTo(slack, 6);

    camera.panByPixels(-100_000, -100_000, VIEW_W, VIEW_H);
    const bottomRight = camera.worldToScreen(world.width, world.height, VIEW_W, VIEW_H);
    expect(bottomRight.x).toBeCloseTo(VIEW_W - slack, 6);
    expect(bottomRight.y).toBeCloseTo(VIEW_H - slack, 6);
  });

  it('still gives slack at the fit zoom, where a panel would otherwise trap a coastline', () => {
    camera.fit(VIEW_W, VIEW_H);
    camera.panByPixels(100_000, 0, VIEW_W, VIEW_H);
    // The whole map is on screen, and it can still be shoved out from under the panel.
    expect(world.width / 2 - camera.centerX).toBeCloseTo(OVERSCROLL_TILES, 6);
  });

  it('centres an axis that has nowhere to pan to at all', () => {
    // A viewport more than twice the overscroll wider than the map: the range collapses.
    const wide = world.width * 40 + OVERSCROLL_TILES * 80;
    camera.setZoom(40, wide, VIEW_H);
    camera.panByPixels(100_000, 0, wide, VIEW_H);
    expect(camera.centerX).toBe(world.width / 2);
  });

  it('reports a visible-tile range that covers the viewport', () => {
    camera.fit(VIEW_W, VIEW_H);
    const all = camera.visibleTiles(VIEW_W, VIEW_H);
    expect(all).toEqual({ x0: 0, y0: 0, x1: world.width - 1, y1: world.height - 1 });

    camera.setZoom(48, VIEW_W, VIEW_H);
    camera.centerX = 35;
    camera.centerY = 17.5;
    const zoomed = camera.visibleTiles(VIEW_W, VIEW_H);
    expect(zoomed.x1 - zoomed.x0).toBeLessThan(world.width - 1);
    expect(zoomed.x0).toBeLessThanOrEqual(Math.floor(35 - VIEW_W / 48 / 2));
    expect(zoomed.x1).toBeGreaterThanOrEqual(Math.ceil(35 + VIEW_W / 48 / 2));
  });
});
