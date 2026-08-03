import { createContext, useContext, useState, type JSX, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { artFor } from '../data/art';
import type { Cost } from '../data/buildings';
import { num } from './format';

/**
 * The square-tile picker, and the detail box beside it.
 *
 * Everything a settlement can build, recruit or launch is presented the same way: a square
 * carrying a picture and a name, three to a row. The square says nothing else — no cost, no
 * duration. Clicking one opens a **box of its own alongside the settlement panel** with the
 * description, the numbers and the order button.
 *
 * Two consequences worth keeping: the grid stays scannable however many entries it holds, and
 * every refusal has somewhere to explain itself instead of a greyed-out button and no reason.
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
  /** Long text for the detail box. */
  blurb?: string | undefined;
  /** Rows of fact → value, rendered as a table in the detail box. */
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

/**
 * Which square is open, shared across every grid in a panel.
 *
 * Lifted out of the individual grids so that only one detail box exists at a time — a
 * settlement shows City Buildings and Fief Buildings together, and two windows open at once
 * would be two boxes fighting for the same space.
 */
const OpenTile = createContext<{
  open: string | null;
  setOpen: (key: string | null) => void;
}>({ open: null, setOpen: () => {} });

/**
 * Owns the open square for everything inside it.
 *
 * Closing the settlement panel unmounts this, which is what makes the detail box close with it
 * — there is no second thing to remember to close.
 */
export function BuildGridScope({ children }: { children: ReactNode }): JSX.Element {
  const [open, setOpen] = useState<string | null>(null);
  return <OpenTile.Provider value={{ open, setOpen }}>{children}</OpenTile.Provider>;
}

export function BuildGrid({
  heading,
  note,
  tiles,
}: {
  heading: string;
  note?: ReactNode;
  tiles: readonly BuildTile[];
}): JSX.Element | null {
  const { open, setOpen } = useContext(OpenTile);
  if (tiles.length === 0) return null;

  // Keyed by grid as well as by tile, so two grids can never both think they are the open one.
  const keyOf = (id: string) => `${heading}:${id}`;
  const detail = tiles.find((tile) => keyOf(tile.id) === open);

  return (
    <div className="panel__section">
      <div className="panel__heading">{heading}</div>
      <div className="tile-grid">
        {tiles.map((tile) => {
          const art = artFor(tile.id);
          const selected = keyOf(tile.id) === open;
          return (
            <button
              key={tile.id}
              type="button"
              className={`build-tile build-tile--${tile.state}${selected ? ' build-tile--open' : ''}`}
              onClick={() => setOpen(selected ? null : keyOf(tile.id))}
              title={tile.name}
              aria-expanded={selected}
            >
              <span className="build-tile__art" aria-hidden="true">
                {art.image ? (
                  <img src={art.image} alt="" className="build-tile__image" />
                ) : (
                  art.icon
                )}
              </span>
              <span className="build-tile__name">{tile.name}</span>
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

/**
 * The detail box.
 *
 * A panel in its own right, sitting beside the settlement's rather than on top of it, so the
 * numbers and the city they belong to are readable at the same time.
 */
function BuildDetail({ tile, onClose }: { tile: BuildTile; onClose: () => void }): JSX.Element {
  const art = artFor(tile.id);

  // Portalled to the map stage rather than nested in the settlement panel: it has to sit
  // *beside* that panel, and the panel clips its own overflow.
  const stage = typeof document === 'undefined' ? null : document.querySelector('.stage');

  const box = (
    <aside className="panel panel--detail" aria-label={tile.name}>
      <header className="panel__header">
        <div className="panel__title detail__title">
          <span className="detail__art" aria-hidden="true">
            {art.image ? <img src={art.image} alt="" className="detail__image" /> : art.icon}
          </span>
          {tile.name}
        </div>
        <button type="button" className="panel__close" onClick={onClose} title="Close">
          ✕
        </button>
      </header>

      <div className="panel__body detail__body">
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
    </aside>
  );

  return stage ? createPortal(box, stage) : box;
}
