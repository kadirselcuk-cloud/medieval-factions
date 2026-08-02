import type { World } from '../data/world';

/**
 * Camera over the tile grid.
 *
 * `zoom` is pixels per tile — using it directly rather than an abstract scale factor keeps
 * every "is this readable yet?" decision in the renderer honest and unit-ful.
 */
export class Camera {
  centerX = 0;
  centerY = 0;
  zoom = 16;

  private minZoom = 4;
  private readonly maxZoom = 48;

  constructor(private readonly world: World) {
    this.centerX = world.width / 2;
    this.centerY = world.height / 2;
  }

  /** Zoom at which the whole map fits — also the floor, so the map can never shrink into a speck. */
  fitZoom(viewW: number, viewH: number): number {
    return Math.min(viewW / this.world.width, viewH / this.world.height);
  }

  fit(viewW: number, viewH: number): void {
    this.zoom = this.fitZoom(viewW, viewH);
    this.centerX = this.world.width / 2;
    this.centerY = this.world.height / 2;
    this.clamp(viewW, viewH);
  }

  setZoom(next: number, viewW: number, viewH: number): void {
    this.minZoom = this.fitZoom(viewW, viewH);
    this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, next));
    this.clamp(viewW, viewH);
  }

  /** Zoom while holding the tile under (screenX, screenY) in place. */
  zoomAt(factor: number, screenX: number, screenY: number, viewW: number, viewH: number): void {
    const before = this.screenToWorld(screenX, screenY, viewW, viewH);
    this.setZoom(this.zoom * factor, viewW, viewH);
    const after = this.screenToWorld(screenX, screenY, viewW, viewH);
    this.centerX += before.x - after.x;
    this.centerY += before.y - after.y;
    this.clamp(viewW, viewH);
  }

  panByPixels(dx: number, dy: number, viewW: number, viewH: number): void {
    this.centerX -= dx / this.zoom;
    this.centerY -= dy / this.zoom;
    this.clamp(viewW, viewH);
  }

  /**
   * Keep the map anchored to the viewport. When an axis is smaller than the viewport the map
   * is centred on it; otherwise the centre is clamped so the edge never pulls inside the frame.
   */
  clamp(viewW: number, viewH: number): void {
    const halfW = viewW / this.zoom / 2;
    const halfH = viewH / this.zoom / 2;
    const { width, height } = this.world;

    this.centerX =
      width <= halfW * 2 ? width / 2 : Math.max(halfW, Math.min(width - halfW, this.centerX));
    this.centerY =
      height <= halfH * 2 ? height / 2 : Math.max(halfH, Math.min(height - halfH, this.centerY));
  }

  worldToScreen(wx: number, wy: number, viewW: number, viewH: number): { x: number; y: number } {
    return {
      x: (wx - this.centerX) * this.zoom + viewW / 2,
      y: (wy - this.centerY) * this.zoom + viewH / 2,
    };
  }

  screenToWorld(sx: number, sy: number, viewW: number, viewH: number): { x: number; y: number } {
    return {
      x: (sx - viewW / 2) / this.zoom + this.centerX,
      y: (sy - viewH / 2) / this.zoom + this.centerY,
    };
  }

  /** Tile range covering the viewport, with a one-tile margin so partial tiles still draw. */
  visibleTiles(viewW: number, viewH: number): { x0: number; y0: number; x1: number; y1: number } {
    const topLeft = this.screenToWorld(0, 0, viewW, viewH);
    const bottomRight = this.screenToWorld(viewW, viewH, viewW, viewH);
    return {
      x0: Math.max(0, Math.floor(topLeft.x) - 1),
      y0: Math.max(0, Math.floor(topLeft.y) - 1),
      x1: Math.min(this.world.width - 1, Math.ceil(bottomRight.x) + 1),
      y1: Math.min(this.world.height - 1, Math.ceil(bottomRight.y) + 1),
    };
  }
}
