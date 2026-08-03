import { useRef, type JSX } from 'react';
import { TERRAIN_LABEL } from '../data/world';
import type { TileInfo } from '../render/MapRenderer';
import { calendarAt } from '../sim/calendar';
import { MAX_SPEED, SPEEDS, type Speed } from '../sim/game';
import type { GameEvent, SimState } from '../sim/types';

interface BottomBarProps {
  state: SimState;
  speed: Speed;
  autoPaused: boolean;
  onSpeedChange: (speed: Speed) => void;
  /** Takes the whole event, not just its tile: a battle notification opens the battle. */
  onSelectEvent: (event: GameEvent) => void;
  hovered: TileInfo | null;
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  onFullscreen: () => void;
  fullscreen: boolean;
  /** CHEAT — remove before release. */
  cheatsUnlocked: boolean;
  /** CHEAT — remove before release. */
  onUnlockCheats: () => void;
}

/**
 * CHEAT — remove before release. See docs/OWED.md.
 *
 * Three clicks on Pause, then three on 10x, and a Max button appears. Written as a sequence
 * rather than a key combination so it survives on a touchscreen, where the game will live.
 */
const CHEAT_SEQUENCE: readonly Speed[] = [0, 0, 0, 10, 10, 10];

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
  army: '🏳',
  battle: '⚔',
  siege: '⛨',
  conquest: '⚑',
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
  onSelect: (event: GameEvent) => void;
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
          className={`notification${event.kind === 'desertion' ? ' notification--bad' : ''}${
            event.battleId ? ' notification--battle' : ''
          }`}
          key={`${event.tick}-${event.text}`}
          onClick={() => onSelect(event)}
          title={event.battleId ? 'Watch the battle' : 'Show on map'}
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
  onFullscreen,
  fullscreen,
  cheatsUnlocked,
  onUnlockCheats,
}: BottomBarProps): JSX.Element {
  const date = calendarAt(state.tick);

  // CHEAT — remove before release.
  const recent = useRef<Speed[]>([]);
  const press = (value: Speed) => {
    recent.current = [...recent.current, value].slice(-CHEAT_SEQUENCE.length);
    if (recent.current.every((v, i) => v === CHEAT_SEQUENCE[i]) && recent.current.length === CHEAT_SEQUENCE.length) {
      onUnlockCheats();
    }
    onSpeedChange(value);
  };

  const speeds: Speed[] = cheatsUnlocked ? [...SPEEDS, MAX_SPEED] : [...SPEEDS];

  return (
    <footer className="bar bar--bottom">
      <div className="bar__group" role="group" aria-label="Game speed">
        {speeds.map((value) => (
          <button
            key={value}
            type="button"
            className={`speed-button${speed === value ? ' speed-button--active' : ''}${value === MAX_SPEED ? ' speed-button--cheat' : ''}`}
            aria-pressed={speed === value}
            onClick={() => press(value)}
            title={value === 0 ? 'Pause' : value === MAX_SPEED ? 'Maximum speed — a cheat' : `${value}× speed`}
          >
            {value === 0 ? '❚❚' : value === MAX_SPEED ? 'MAX' : `${value}×`}
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
        <button
          type="button"
          className="icon-button"
          onClick={onFullscreen}
          title={fullscreen ? 'Leave full screen' : 'Full screen'}
          aria-label={fullscreen ? 'Leave full screen' : 'Full screen'}
          aria-pressed={fullscreen}
        >
          {fullscreen ? '⤡' : '⤢'}
        </button>
      </div>
    </footer>
  );
}
