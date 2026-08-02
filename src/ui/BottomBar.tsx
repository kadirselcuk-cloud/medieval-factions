import type { JSX } from 'react';
import { TERRAIN_LABEL } from '../data/world';
import type { TileInfo } from '../render/MapRenderer';
import { calendarAt } from '../sim/calendar';
import { SPEEDS, type Speed } from '../sim/game';
import type { GameEvent, SimState } from '../sim/types';

interface BottomBarProps {
  state: SimState;
  speed: Speed;
  autoPaused: boolean;
  onSpeedChange: (speed: Speed) => void;
  onSelectEvent: (tileIndex: number) => void;
  hovered: TileInfo | null;
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
}

function describe(tile: TileInfo | null): JSX.Element {
  if (!tile) return <span className="readout__hint">Click a tile or city · drag to pan</span>;

  const geo = `${Math.abs(tile.lat).toFixed(1)}°${tile.lat >= 0 ? 'N' : 'S'} ${Math.abs(tile.lon).toFixed(1)}°${tile.lon >= 0 ? 'E' : 'W'}`;

  return (
    <>
      <span className="readout__coords">
        {tile.x}, {tile.y}
      </span>
      <span className="readout__terrain">{TERRAIN_LABEL[tile.terrain]}</span>
      {tile.feature?.kind === 'city' && (
        <span className="readout__feature">{tile.feature.name}</span>
      )}
      {tile.feature?.kind === 'resource' && (
        <span className="readout__feature readout__feature--resource">
          {tile.feature.resource[0]?.toUpperCase()}
          {tile.feature.resource.slice(1)}
        </span>
      )}
      <span className="readout__geo">{geo}</span>
    </>
  );
}

const EVENT_ICON: Record<GameEvent['kind'], string> = {
  building: '⚒',
  settlement: '⌂',
  unit: '⚔',
  ship: '⛵',
  improvement: '✦',
  desertion: '⚠',
};

/** How long a completion stays on screen, in ticks — one in-game week. */
const NOTIFICATION_TICKS = 28;

/**
 * Recent completions, newest first.
 *
 * Driven by the tick counter rather than wall-clock time, so notifications last the same
 * in-game duration at every speed instead of blinking past at 10x.
 */
function Notifications({
  state,
  onSelect,
}: {
  state: SimState;
  onSelect: (tileIndex: number) => void;
}): JSX.Element {
  const recent = state.events
    .filter(
      (event) =>
        event.factionIndex === state.playerFactionIndex &&
        state.tick - event.tick < NOTIFICATION_TICKS,
    )
    .slice(-3)
    .reverse();

  return (
    <div className="notifications" aria-live="polite">
      {recent.map((event) => (
        <button
          type="button"
          className={`notification${event.kind === 'desertion' ? ' notification--bad' : ''}`}
          key={`${event.tick}-${event.text}`}
          onClick={() => onSelect(event.tileIndex)}
          title="Show on map"
        >
          <span className="notification__icon" aria-hidden="true">
            {EVENT_ICON[event.kind]}
          </span>
          <span className="notification__text">{event.text}</span>
        </button>
      ))}
    </div>
  );
}

export function BottomBar({
  state,
  speed,
  autoPaused,
  onSpeedChange,
  onSelectEvent,
  hovered,
  zoom,
  onZoomIn,
  onZoomOut,
  onFit,
}: BottomBarProps): JSX.Element {
  const date = calendarAt(state.tick);

  return (
    <footer className="bar bar--bottom">
      <div className="bar__group" role="group" aria-label="Game speed">
        {SPEEDS.map((value) => (
          <button
            key={value}
            type="button"
            className={`speed-button${speed === value ? ' speed-button--active' : ''}`}
            aria-pressed={speed === value}
            onClick={() => onSpeedChange(value)}
            title={value === 0 ? 'Pause' : `${value}× speed`}
          >
            {value === 0 ? '❚❚' : `${value}×`}
          </button>
        ))}
      </div>

      {/* One month is 120 ticks; the gauge is the only place the "turn" is still visible. */}
      <div className="gauge" title={`${date.monthName} ${date.year}`}>
        <div className="gauge__fill" style={{ width: `${date.monthProgress * 100}%` }} />
        <span className="gauge__label">
          {autoPaused ? 'Paused — tab inactive' : `${date.monthName} ${date.year}`}
        </span>
      </div>

      <Notifications state={state} onSelect={onSelectEvent} />

      <div className="readout">{describe(hovered)}</div>

      <div className="bar__group bar__group--end" role="group" aria-label="Map zoom">
        <button type="button" className="icon-button" onClick={onZoomOut} title="Zoom out">
          −
        </button>
        <button type="button" className="icon-button" onClick={onZoomIn} title="Zoom in">
          +
        </button>
        <button
          type="button"
          className="icon-button icon-button--wide"
          onClick={onFit}
          title={`Fit map to screen (${zoom.toFixed(1)} px/tile)`}
        >
          Fit
        </button>
      </div>
    </footer>
  );
}
