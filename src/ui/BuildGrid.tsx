import { useState, type JSX, type ReactNode } from 'react';
import { artFor } from '../data/art';
import type { Cost } from '../data/buildings';
import { num } from './format';

/**
 * The square-tile picker, and the detail window behind it.
 *
 * Everything a settlement can build, recruit or launch is presented the same way: a square
 * carrying a picture and a name, two to a row. Nothing is ordered from the square itself —
 * clicking one opens a window with the full description and the numbers, and the order is
 * given there. That keeps the grid scannable however many entries it holds, and gives every
 * refusal somewhere to explain itself instead of a greyed-out button and no reason.
 *
 * Icons come from `data/art.json` and nothing here knows what they are. When the owner's real
 * art arrives, that file gains `image` paths and this file does not change.
 */

export type TileState = 'available' | 'blocked' | 'built' | 'queued';

export interface BuildTile {
  /** Key into the art manifest, and React's list key. */
  id: string;
  name: string;
  state: TileState;
  /** Shown under the name on the square — a cost, a duration, a count. */
  footnote?: string | undefined;
  /** Long text for the detail window. */
  blurb?: string | undefined;
  /** Rows of fact → value, rendered as a table in the detail window. */
  facts: { label: string; value: string }[];
  /** Why it cannot be ordered. Shown in place of the button. */
  reason?: string | undefined;
  /** Label for the action button. Absent means there is nothing to order. */
  action?: string | undefined;
  onAction?: (() => void) | undefined;
}

export function costText(cost: Cost): string {
  const parts = (['gold', 'wood', 'iron', 'stone'] as const)
    .filter((resource) => (cost[resource] ?? 0) > 0)
    .map((resource) => `${num(cost[resource] ?? 0)} ${resource}`);
  return parts.length > 0 ? parts.join(' · ') : 'free';
}

const STATE_MARK: Record<TileState, string> = {
  available: '',
  blocked: '',
  built: '✓',
  queued: '⏳',
};

export function BuildGrid({
  heading,
  note,
  tiles,
}: {
  heading: string;
  note?: ReactNode;
  tiles: readonly BuildTile[];
}): JSX.Element | null {
  const [open, setOpen] = useState<string | null>(null);
  if (tiles.length === 0) return null;

  const detail = tiles.find((tile) => tile.id === open);

  return (
    <div className="panel__section">
      <div className="panel__heading">{heading}</div>
      <div className="tile-grid">
        {tiles.map((tile) => {
          const art = artFor(tile.id);
          return (
            <button
              key={tile.id}
              type="button"
              className={`build-tile build-tile--${tile.state}`}
              onClick={() => setOpen(tile.id)}
              title={tile.name}
            >
              <span className="build-tile__art" aria-hidden="true">
                {art.image ? (
                  <img src={art.image} alt="" className="build-tile__image" />
                ) : (
                  art.icon
                )}
              </span>
              <span className="build-tile__name">{tile.name}</span>
              {tile.footnote && <span className="build-tile__foot">{tile.footnote}</span>}
              {STATE_MARK[tile.state] && (
                <span className="build-tile__mark" aria-hidden="true">
                  {STATE_MARK[tile.state]}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {note && <p className="panel__note">{note}</p>}

      {detail && <BuildDetail tile={detail} onClose={() => setOpen(null)} />}
    </div>
  );
}

function BuildDetail({ tile, onClose }: { tile: BuildTile; onClose: () => void }): JSX.Element {
  const art = artFor(tile.id);

  return (
    <div className="overlay" role="dialog" aria-label={tile.name} onClick={onClose}>
      <div className="overlay__panel detail" onClick={(event) => event.stopPropagation()}>
        <header className="overlay__header">
          <h2 className="detail__title">
            <span className="detail__art" aria-hidden="true">
              {art.image ? <img src={art.image} alt="" className="detail__image" /> : art.icon}
            </span>
            {tile.name}
          </h2>
          <button type="button" className="panel__close" onClick={onClose} title="Close">
            ✕
          </button>
        </header>

        <div className="detail__body">
          {tile.blurb && <p className="detail__blurb">{tile.blurb}</p>}

          {tile.facts.map((fact) => (
            <div className="panel__row" key={fact.label}>
              <span className="panel__label">{fact.label}</span>
              <span className="panel__value">{fact.value}</span>
            </div>
          ))}

          {tile.state === 'built' && <p className="panel__note">Already standing here.</p>}
          {tile.state === 'queued' && <p className="panel__note">Already under way.</p>}
          {tile.reason && <p className="detail__reason">{tile.reason}</p>}

          {tile.action && tile.onAction && !tile.reason && (
            <button
              type="button"
              className="action action--primary detail__action"
              onClick={() => {
                tile.onAction?.();
                onClose();
              }}
            >
              {tile.action}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
