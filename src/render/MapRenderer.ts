import { describeTile, TERRAINS, tileIndex, type TileInfo, type World } from '../data/world';
import { Camera } from './camera';
import {
  CITY_FILL,
  CITY_STROKE,
  GRID_COLOR,
  LABEL_COLOR,
  LABEL_SHADOW,
  RESOURCE_COLOR,
  RESOURCE_GLYPH,
  SHADE_COUNT,
  TERRAIN_SHADES,
  VOID_COLOR,
  shadeVariant,
} from './palette';

export type { TileInfo };

export interface MapRendererOptions {
  onHover?: (tile: TileInfo | null) => void;
  onZoomChange?: (zoom: number) => void;
  onSelect?: (tile: TileInfo | null) => void;
}

export interface TerritoryView {
  /** Owning faction index per tile, or -1. */
  owner: Int8Array;
  /** Colour per faction index. */
  colors: readonly string[];
}

/** A drag beyond this many pixels is a pan, not a click. */
const CLICK_SLOP = 5;

/** Zoom thresholds, in pixels per tile. */
const SHOW_GRID_AT = 11;
const SHOW_LABELS_AT = 15;
const SHOW_RESOURCE_GLYPH_AT = 17;

/**
 * Draws the campaign map and owns all camera interaction.
 *
 * 70x35 is 2,450 tiles, so the map is redrawn wholesale from the tile array rather than
 * cached to an offscreen bitmap — it costs well under a millisecond and stays crisp at every
 * zoom level. Frames are only produced when something actually changed, which matters on a
 * phone where this will eventually run beside a live simulation.
 */
export class MapRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly camera: Camera;
  private readonly shades: Uint8Array;
  private readonly resizeObserver: ResizeObserver;

  private viewW = 0;
  private viewH = 0;
  private dpr = 1;
  private dirty = true;
  private frameHandle = 0;
  private disposed = false;

  private readonly pointers = new Map<number, { x: number; y: number }>();
  private pinchDistance = 0;
  private hoveredIndex = -1;
  private hasFitOnce = false;

  private territory: TerritoryView | null = null;
  private selectedIndex: number | null = null;
  private pressOrigin: { x: number; y: number } | null = null;
  private pressMoved = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly world: World,
    private readonly options: MapRendererOptions = {},
  ) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('MapRenderer: 2D canvas context unavailable');
    this.ctx = ctx;
    this.camera = new Camera(world);

    this.shades = new Uint8Array(world.width * world.height);
    for (let y = 0; y < world.height; y++) {
      for (let x = 0; x < world.width; x++) {
        this.shades[tileIndex(world, x, y)] = shadeVariant(x, y);
      }
    }

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
    this.attachInput();
    this.frameHandle = requestAnimationFrame(this.frame);
  }

  destroy(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frameHandle);
    this.resizeObserver.disconnect();
    this.detachInput();
  }

  get zoom(): number {
    return this.camera.zoom;
  }

  fit(): void {
    this.camera.fit(this.viewW, this.viewH);
    this.invalidate();
  }

  zoomBy(factor: number): void {
    this.camera.zoomAt(factor, this.viewW / 2, this.viewH / 2, this.viewW, this.viewH);
    this.invalidate();
  }

  /** Ownership overlay. The array is read live each frame, so mutating it in place is fine. */
  setTerritory(territory: TerritoryView | null): void {
    this.territory = territory;
    this.dirty = true;
  }

  setSelection(tileIndex: number | null): void {
    if (this.selectedIndex === tileIndex) return;
    this.selectedIndex = tileIndex;
    this.dirty = true;
  }

  centerOn(x: number, y: number): void {
    this.camera.centerX = x + 0.5;
    this.camera.centerY = y + 0.5;
    this.camera.clamp(this.viewW, this.viewH);
    this.invalidate();
  }

  // ---------------------------------------------------------------- lifecycle

  private invalidate(): void {
    this.dirty = true;
    this.options.onZoomChange?.(this.camera.zoom);
  }

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.viewW = rect.width;
    this.viewH = rect.height;
    this.canvas.width = Math.round(rect.width * this.dpr);
    this.canvas.height = Math.round(rect.height * this.dpr);

    if (!this.hasFitOnce) {
      this.camera.fit(this.viewW, this.viewH);
      this.hasFitOnce = true;
    } else {
      this.camera.setZoom(this.camera.zoom, this.viewW, this.viewH);
    }
    this.invalidate();
  }

  private readonly frame = (): void => {
    if (this.disposed) return;
    if (this.dirty) {
      this.dirty = false;
      this.draw();
    }
    this.frameHandle = requestAnimationFrame(this.frame);
  };

  // ------------------------------------------------------------------ drawing

  private draw(): void {
    const { ctx, world, camera, viewW, viewH } = this;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = VOID_COLOR;
    ctx.fillRect(0, 0, viewW, viewH);

    const { x0, y0, x1, y1 } = camera.visibleTiles(viewW, viewH);
    const zoom = camera.zoom;
    const origin = camera.worldToScreen(x0, y0, viewW, viewH);
    // Overdraw by a fraction of a pixel so rounding never leaves seams between tiles.
    const size = Math.ceil(zoom) + 1;

    for (let y = y0; y <= y1; y++) {
      const sy = Math.floor(origin.y + (y - y0) * zoom);
      for (let x = x0; x <= x1; x++) {
        const index = y * world.width + x;
        const terrain = world.terrain[index] ?? 0;
        const variant = this.shades[index] ?? 0;
        ctx.fillStyle = TERRAIN_SHADES[terrain * SHADE_COUNT + variant] ?? '#000';
        ctx.fillRect(Math.floor(origin.x + (x - x0) * zoom), sy, size, size);
      }
    }

    if (this.territory) this.drawTerritory(x0, y0, x1, y1, origin, zoom, this.territory);
    if (zoom >= SHOW_GRID_AT) this.drawGrid(x0, y0, x1, y1, origin, zoom);
    this.drawFeatures(x0, y0, x1, y1, zoom);
    this.drawSelection(zoom);
  }

  /**
   * Owned tiles get a colour wash; edges between different owners get a hard line. The wash
   * alone is too weak to read as a border at low zoom, and the line alone leaves the interior
   * ambiguous — together they answer "what is mine" at a glance, which is the whole point.
   */
  private drawTerritory(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    origin: { x: number; y: number },
    zoom: number,
    territory: TerritoryView,
  ): void {
    const { ctx, world } = this;
    const size = Math.ceil(zoom) + 1;

    ctx.globalAlpha = 0.34;
    for (let y = y0; y <= y1; y++) {
      const sy = Math.floor(origin.y + (y - y0) * zoom);
      for (let x = x0; x <= x1; x++) {
        const owner = territory.owner[y * world.width + x] ?? -1;
        if (owner < 0) continue;
        ctx.fillStyle = territory.colors[owner] ?? '#fff';
        ctx.fillRect(Math.floor(origin.x + (x - x0) * zoom), sy, size, size);
      }
    }
    ctx.globalAlpha = 1;

    ctx.lineWidth = Math.max(1.5, zoom * 0.1);
    ctx.lineCap = 'square';
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const owner = territory.owner[y * world.width + x] ?? -1;
        if (owner < 0) continue;
        const left = Math.floor(origin.x + (x - x0) * zoom);
        const top = Math.floor(origin.y + (y - y0) * zoom);
        ctx.strokeStyle = territory.colors[owner] ?? '#fff';

        const right = x + 1 < world.width ? (territory.owner[y * world.width + x + 1] ?? -1) : -1;
        const below = y + 1 < world.height ? (territory.owner[(y + 1) * world.width + x] ?? -1) : -1;
        const above = y > 0 ? (territory.owner[(y - 1) * world.width + x] ?? -1) : -1;
        const leftOwner = x > 0 ? (territory.owner[y * world.width + x - 1] ?? -1) : -1;

        ctx.beginPath();
        if (right !== owner) {
          ctx.moveTo(left + zoom, top);
          ctx.lineTo(left + zoom, top + zoom);
        }
        if (below !== owner) {
          ctx.moveTo(left, top + zoom);
          ctx.lineTo(left + zoom, top + zoom);
        }
        if (above !== owner) {
          ctx.moveTo(left, top);
          ctx.lineTo(left + zoom, top);
        }
        if (leftOwner !== owner) {
          ctx.moveTo(left, top);
          ctx.lineTo(left, top + zoom);
        }
        ctx.stroke();
      }
    }
  }

  private drawSelection(zoom: number): void {
    if (this.selectedIndex === null) return;
    const { ctx, world, camera, viewW, viewH } = this;
    const x = this.selectedIndex % world.width;
    const y = Math.floor(this.selectedIndex / world.width);
    const p = camera.worldToScreen(x, y, viewW, viewH);

    ctx.lineWidth = Math.max(2, zoom * 0.12);
    ctx.strokeStyle = '#0f0c08';
    ctx.strokeRect(p.x, p.y, zoom, zoom);
    ctx.lineWidth = Math.max(1, zoom * 0.07);
    ctx.strokeStyle = '#ffe9a8';
    ctx.strokeRect(p.x, p.y, zoom, zoom);
  }

  private drawGrid(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    origin: { x: number; y: number },
    zoom: number,
  ): void {
    const { ctx } = this;
    ctx.strokeStyle = GRID_COLOR;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = x0; x <= x1 + 1; x++) {
      const sx = Math.floor(origin.x + (x - x0) * zoom) + 0.5;
      ctx.moveTo(sx, origin.y);
      ctx.lineTo(sx, origin.y + (y1 - y0 + 1) * zoom);
    }
    for (let y = y0; y <= y1 + 1; y++) {
      const sy = Math.floor(origin.y + (y - y0) * zoom) + 0.5;
      ctx.moveTo(origin.x, sy);
      ctx.lineTo(origin.x + (x1 - x0 + 1) * zoom, sy);
    }
    ctx.stroke();
  }

  private drawFeatures(x0: number, y0: number, x1: number, y1: number, zoom: number): void {
    const { ctx, world, camera, viewW, viewH } = this;
    const radius = Math.max(2.5, Math.min(9, zoom * 0.28));

    for (const node of world.resources) {
      if (node.x < x0 || node.x > x1 || node.y < y0 || node.y > y1) continue;
      const p = camera.worldToScreen(node.x + 0.5, node.y + 0.5, viewW, viewH);
      ctx.fillStyle = RESOURCE_COLOR[node.resource];
      ctx.strokeStyle = CITY_STROKE;
      ctx.lineWidth = 1;
      const s = radius * 1.5;
      ctx.beginPath();
      ctx.rect(p.x - s / 2, p.y - s / 2, s, s);
      ctx.fill();
      ctx.stroke();

      if (zoom >= SHOW_RESOURCE_GLYPH_AT) {
        ctx.fillStyle = CITY_STROKE;
        ctx.font = `700 ${Math.round(s * 0.8)}px ui-sans-serif, system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(RESOURCE_GLYPH[node.resource], p.x, p.y + 0.5);
      }
    }

    for (const city of world.cities) {
      if (city.x < x0 || city.x > x1 || city.y < y0 || city.y > y1) continue;
      const p = camera.worldToScreen(city.x + 0.5, city.y + 0.5, viewW, viewH);
      const owner = this.territory?.owner[city.index] ?? -1;

      // A city is drawn in its owner's colour inside a light ring, so ownership reads even
      // where the territory wash is hidden under a border or a label.
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = owner >= 0 ? (this.territory?.colors[owner] ?? CITY_FILL) : CITY_FILL;
      ctx.fill();
      ctx.lineWidth = Math.max(1, radius * 0.34);
      ctx.strokeStyle = CITY_FILL;
      ctx.stroke();
      ctx.lineWidth = Math.max(1, radius * 0.16);
      ctx.strokeStyle = CITY_STROKE;
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius + Math.max(1, radius * 0.34) / 2, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (zoom < SHOW_LABELS_AT) return;

    ctx.font = `600 ${Math.round(Math.min(14, zoom * 0.62))}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const city of world.cities) {
      if (city.x < x0 || city.x > x1 || city.y < y0 || city.y > y1) continue;
      const p = camera.worldToScreen(city.x + 0.5, city.y + 0.5, viewW, viewH);
      const ty = p.y + radius + 2;
      ctx.lineWidth = 3;
      ctx.strokeStyle = LABEL_SHADOW;
      ctx.strokeText(city.name, p.x, ty);
      ctx.fillStyle = LABEL_COLOR;
      ctx.fillText(city.name, p.x, ty);
    }
  }

  // -------------------------------------------------------------------- input

  private attachInput(): void {
    const c = this.canvas;
    c.addEventListener('pointerdown', this.onPointerDown);
    c.addEventListener('pointermove', this.onPointerMove);
    c.addEventListener('pointerup', this.onPointerUp);
    c.addEventListener('pointercancel', this.onPointerUp);
    c.addEventListener('pointerleave', this.onPointerLeave);
    c.addEventListener('wheel', this.onWheel, { passive: false });
  }

  private detachInput(): void {
    const c = this.canvas;
    c.removeEventListener('pointerdown', this.onPointerDown);
    c.removeEventListener('pointermove', this.onPointerMove);
    c.removeEventListener('pointerup', this.onPointerUp);
    c.removeEventListener('pointercancel', this.onPointerUp);
    c.removeEventListener('pointerleave', this.onPointerLeave);
    c.removeEventListener('wheel', this.onWheel);
  }

  private localPoint(e: PointerEvent | WheelEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  private readonly onPointerDown = (e: PointerEvent): void => {
    this.canvas.setPointerCapture(e.pointerId);
    const point = this.localPoint(e);
    this.pointers.set(e.pointerId, point);
    this.canvas.style.cursor = 'grabbing';

    if (this.pointers.size === 1) {
      this.pressOrigin = point;
      this.pressMoved = false;
    } else {
      // A second finger means pinch-zoom, never a click.
      this.pressOrigin = null;
      this.pinchDistance = this.currentPinchDistance();
    }
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    const point = this.localPoint(e);
    const previous = this.pointers.get(e.pointerId);

    if (!previous) {
      this.updateHover(point);
      return;
    }
    this.pointers.set(e.pointerId, point);

    if (this.pressOrigin && !this.pressMoved) {
      const drift = Math.hypot(point.x - this.pressOrigin.x, point.y - this.pressOrigin.y);
      if (drift > CLICK_SLOP) this.pressMoved = true;
    }

    if (this.pointers.size >= 2) {
      const distance = this.currentPinchDistance();
      if (this.pinchDistance > 0 && distance > 0) {
        const mid = this.pinchMidpoint();
        this.camera.zoomAt(distance / this.pinchDistance, mid.x, mid.y, this.viewW, this.viewH);
        this.invalidate();
      }
      this.pinchDistance = distance;
      return;
    }

    this.camera.panByPixels(point.x - previous.x, point.y - previous.y, this.viewW, this.viewH);
    this.invalidate();
    this.updateHover(point);
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    const origin = this.pressOrigin;
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinchDistance = 0;
    if (this.pointers.size === 0) this.canvas.style.cursor = 'grab';

    if (origin && !this.pressMoved && this.pointers.size === 0) {
      this.options.onSelect?.(this.tileAt(this.localPoint(e)));
    }
    if (this.pointers.size === 0) this.pressOrigin = null;
  };

  private readonly onPointerLeave = (): void => {
    this.hoveredIndex = -1;
    this.options.onHover?.(null);
  };

  private readonly onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const point = this.localPoint(e);
    const factor = Math.exp(-e.deltaY * 0.0015);
    this.camera.zoomAt(factor, point.x, point.y, this.viewW, this.viewH);
    this.invalidate();
    this.updateHover(point);
  };

  private currentPinchDistance(): number {
    const [a, b] = [...this.pointers.values()];
    if (!a || !b) return 0;
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  private pinchMidpoint(): { x: number; y: number } {
    const [a, b] = [...this.pointers.values()];
    if (!a || !b) return { x: this.viewW / 2, y: this.viewH / 2 };
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  /** Resolve a viewport point to a tile, or null if it fell outside the map. */
  private tileAt(point: { x: number; y: number }): TileInfo | null {
    const position = this.camera.screenToWorld(point.x, point.y, this.viewW, this.viewH);
    const x = Math.floor(position.x);
    const y = Math.floor(position.y);
    if (x < 0 || y < 0 || x >= this.world.width || y >= this.world.height) return null;
    return describeTile(this.world, x, y);
  }

  /** Emits only when the pointer crosses into a different tile, so React re-renders stay rare. */
  private updateHover(point: { x: number; y: number }): void {
    const { onHover } = this.options;
    if (!onHover) return;

    const tile = this.tileAt(point);
    const index = tile?.index ?? -1;
    if (index === this.hoveredIndex) return;
    this.hoveredIndex = index;
    onHover(tile);
  }
}

export { TERRAINS };
