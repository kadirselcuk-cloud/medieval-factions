import { beforeEach, describe, expect, it } from 'vitest';
import rawEurope from '../../data/maps/europe-1350.json';
import { buildWorld } from '../data/world';
import { Camera } from './camera';

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

  it('keeps the map edges pinned to the viewport when panning', () => {
    camera.setZoom(40, VIEW_W, VIEW_H);
    camera.panByPixels(100_000, 100_000, VIEW_W, VIEW_H);

    const topLeft = camera.worldToScreen(0, 0, VIEW_W, VIEW_H);
    expect(topLeft.x).toBeLessThanOrEqual(0);
    expect(topLeft.y).toBeLessThanOrEqual(0);

    camera.panByPixels(-100_000, -100_000, VIEW_W, VIEW_H);
    const bottomRight = camera.worldToScreen(world.width, world.height, VIEW_W, VIEW_H);
    expect(bottomRight.x).toBeGreaterThanOrEqual(VIEW_W);
    expect(bottomRight.y).toBeGreaterThanOrEqual(VIEW_H);
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
