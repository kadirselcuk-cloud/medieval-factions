import { useEffect, useRef, useState, type JSX } from 'react';
import type { World } from '../data/world';
import { MapRenderer, type ArmyView, type TerritoryView, type TileInfo } from '../render/MapRenderer';

interface MapViewProps {
  world: World;
  territory: TerritoryView | null;
  armies: ArmyView | null;
  /** Fog-of-war mask, 1 per visible tile. `null` draws the whole map. */
  vision: Uint8Array | null;
  /** 1 per tile the realm has ever known. `null` leaves everything merely dim rather than black. */
  known: Uint8Array | null;
  selection: number | null;
  onHover: (tile: TileInfo | null) => void;
  onSelect: (tile: TileInfo | null) => void;
  onZoomChange: (zoom: number) => void;
  onReady: (renderer: MapRenderer | null) => void;
}

export function MapView({
  world,
  territory,
  armies,
  vision,
  known,
  selection,
  onHover,
  onSelect,
  onZoomChange,
  onReady,
}: MapViewProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [renderer, setRenderer] = useState<MapRenderer | null>(null);

  // Callbacks are read through a ref so re-rendering the shell never tears down the renderer.
  const handlers = useRef({ onHover, onSelect, onZoomChange, onReady });
  handlers.current = { onHover, onSelect, onZoomChange, onReady };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const instance = new MapRenderer(canvas, world, {
      onHover: (tile) => handlers.current.onHover(tile),
      onSelect: (tile) => handlers.current.onSelect(tile),
      onZoomChange: (zoom) => handlers.current.onZoomChange(zoom),
    });
    setRenderer(instance);
    handlers.current.onReady(instance);

    return () => {
      handlers.current.onReady(null);
      setRenderer(null);
      instance.destroy();
    };
  }, [world]);

  useEffect(() => {
    renderer?.setTerritory(territory);
  }, [renderer, territory]);

  useEffect(() => {
    renderer?.setArmies(armies);
  }, [renderer, armies]);

  useEffect(() => {
    renderer?.setVision(vision, known);
  }, [renderer, vision, known]);

  useEffect(() => {
    renderer?.setSelection(selection);
  }, [renderer, selection]);

  return <canvas ref={canvasRef} className="map-canvas" />;
}
