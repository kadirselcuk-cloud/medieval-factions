import type { JSX } from 'react';
import { settlementUpgradeTo, summariseBuildings, type Cost } from '../data/buildings';
import { RELIGION_LABEL, type Faction } from '../data/factions';
import { improvementCost, improvementMonths, tileOutput } from '../data/improvements';
import { TERRAIN_PROFILE, type ImprovementKind } from '../data/terrain';
import { TERRAIN_LABEL, type World } from '../data/world';
import type { TileInfo } from '../render/MapRenderer';
import {
  buildOptions,
  cancelImprovement,
  cancelOrder,
  canAfford,
  improvementAt,
  improvementCap,
  queueBuilding,
  queueImprovement,
  queueSettlementUpgrade,
} from '../sim/construction';
import type { Game } from '../sim/game';
import { MILLI, TIER_NAME, whole, type CityState, type SimState } from '../sim/types';
import { num } from './format';

interface SelectionPanelProps {
  tile: TileInfo;
  game: Game;
  state: SimState;
  world: World;
  roster: readonly Faction[];
  onClose: () => void;
}

const IMPROVEMENT_KINDS: readonly ImprovementKind[] = ['farm', 'mine', 'sawmill'];
const IMPROVEMENT_NAME: Record<ImprovementKind, string> = {
  farm: 'Farm',
  mine: 'Mine',
  sawmill: 'Sawmill',
};

function costText(cost: Cost): string {
  const parts = (['gold', 'wood', 'iron', 'stone'] as const)
    .filter((resource) => (cost[resource] ?? 0) > 0)
    .map((resource) => `${num(cost[resource] ?? 0)} ${resource}`);
  return parts.length > 0 ? parts.join(' · ') : 'free';
}

function Row({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="panel__row">
      <span className="panel__label">{label}</span>
      <span className="panel__value">{value}</span>
    </div>
  );
}

export function SelectionPanel({
  tile,
  game,
  state,
  world,
  roster,
  onClose,
}: SelectionPanelProps): JSX.Element {
  const ownerIndex = state.tileOwner[tile.index] ?? -1;
  const owner = ownerIndex >= 0 ? roster[ownerIndex] : undefined;
  const isPlayers = ownerIndex === state.playerFactionIndex;
  const player = state.playerFactionIndex;

  const cityFeature = tile.feature?.kind === 'city' ? tile.feature : undefined;
  const city = cityFeature ? state.cities.find((c) => c.tileIndex === tile.index) : undefined;

  const node = tile.feature?.kind === 'resource' ? tile.feature.resource : null;
  const kind = improvementAt(state, tile.index);
  const level = state.improvementLevel[tile.index] ?? 0;
  const monthsLeft = state.improvementMonths[tile.index] ?? 0;
  const target = state.improvementTarget[tile.index] ?? 0;
  const cap = improvementCap(state, player);
  const profile = TERRAIN_PROFILE[tile.terrain];

  const output = tileOutput({ terrain: tile.terrain, improvement: kind, level, node });
  const outputText =
    Object.entries(output)
      .filter(([, amount]) => amount > 0)
      .map(([resource, amount]) => `+${amount} ${resource}`)
      .join(', ') || '—';

  return (
    <aside className={`panel${isPlayers ? ' panel--owned' : ''}`}>
      <header className="panel__header">
        <div className="panel__title">
          {cityFeature ? cityFeature.name : `Tile ${tile.x}, ${tile.y}`}
          {isPlayers && <span className="panel__badge">Yours</span>}
        </div>
        <button type="button" className="panel__close" onClick={onClose} title="Close">
          ✕
        </button>
      </header>

      <div className="panel__body">
        {owner ? (
          <div className="panel__owner">
            <span className="swatch" style={{ background: owner.color }} aria-hidden="true" />
            <span>{owner.name}</span>
            {owner.religion !== 'none' && (
              <span className="panel__muted">· {RELIGION_LABEL[owner.religion]}</span>
            )}
          </div>
        ) : (
          <div className="panel__owner panel__muted">Unclaimed</div>
        )}

        <Row label="Terrain" value={TERRAIN_LABEL[tile.terrain]} />
        <Row label="Defence" value={`+${Math.round(profile.defence * 100)}%`} />
        {node && <Row label="Node" value={`${node[0]?.toUpperCase()}${node.slice(1)}`} />}
        <Row label="Yields" value={`${outputText} / month`} />

        {city && <CitySummary city={city} />}

        {isPlayers && profile.buildable && (
          <ImprovementSection
            kind={kind}
            level={level}
            cap={cap}
            monthsLeft={monthsLeft}
            target={target}
            canPay={(cost) => canAfford(state, player, cost)}
            onBuild={(next) =>
              game.command((s) => queueImprovement(s, world, player, tile.x, tile.y, next))
            }
            onCancel={() => game.command((s) => cancelImprovement(s, tile.index))}
          />
        )}
      </div>

      {city && isPlayers && (
        <CityActions city={city} game={game} state={state} world={world} />
      )}
    </aside>
  );
}

function CitySummary({ city }: { city: CityState }): JSX.Element {
  const buildings = summariseBuildings(city.buildings);
  return (
    <>
      <Row label="Settlement" value={TIER_NAME[city.tier]} />
      <Row label="Population" value={num(city.populationMilli / MILLI)} />
      <Row label="Housing" value={buildings.housingLevel > 0 ? `Level ${buildings.housingLevel}` : 'None'} />
      <Row label="Walls" value={buildings.defenceTenths > 0 ? `+${buildings.defenceTenths * 10}%` : 'None'} />
    </>
  );
}

interface ImprovementSectionProps {
  kind: ImprovementKind | null;
  level: number;
  cap: number;
  monthsLeft: number;
  target: number;
  canPay: (cost: Cost) => boolean;
  onBuild: (kind: ImprovementKind) => void;
  onCancel: () => void;
}

function ImprovementSection({
  kind,
  level,
  cap,
  monthsLeft,
  target,
  canPay,
  onBuild,
  onCancel,
}: ImprovementSectionProps): JSX.Element {
  if (monthsLeft > 0) {
    return (
      <div className="panel__section">
        <div className="panel__heading">Improvement</div>
        <div className="progress">
          <span>
            {kind ? IMPROVEMENT_NAME[kind] : 'Work'} → level {target}
          </span>
          <span className="panel__muted">{monthsLeft} mo</span>
        </div>
        <button type="button" className="action action--minor" onClick={onCancel}>
          Cancel · full refund
        </button>
      </div>
    );
  }

  // A tile holds one improvement, so once something is built only that line can continue.
  const choices = kind === null ? IMPROVEMENT_KINDS : [kind];
  const nextLevel = level + 1;
  const blocked = nextLevel > cap;

  return (
    <div className="panel__section">
      <div className="panel__heading">
        Improvement
        {kind !== null && (
          <span className="panel__muted">
            {' '}
            · {IMPROVEMENT_NAME[kind]} level {level}
          </span>
        )}
      </div>

      {blocked ? (
        <p className="panel__note">
          Level {nextLevel} needs a tier-{nextLevel} settlement somewhere in your realm.
          Your best is tier {cap}.
        </p>
      ) : (
        choices.map((choice) => {
          const cost = improvementCost(choice, nextLevel);
          const affordable = canPay(cost);
          return (
            <button
              key={choice}
              type="button"
              className="action"
              disabled={!affordable}
              onClick={() => onBuild(choice)}
              title={affordable ? undefined : 'Not enough resources'}
            >
              <span>
                {level === 0 ? 'Build' : 'Upgrade'} {IMPROVEMENT_NAME[choice]}
                {level > 0 ? ` ${nextLevel}` : ''}
              </span>
              <span className="action__cost">
                {costText(cost)} · {improvementMonths(nextLevel)} mo
              </span>
            </button>
          );
        })
      )}
    </div>
  );
}

function CityActions({
  city,
  game,
  state,
  world,
}: {
  city: CityState;
  game: Game;
  state: SimState;
  world: World;
}): JSX.Element {
  const options = buildOptions(world, city);
  const upgrade = settlementUpgradeTo(city.tier + 1);
  const upgradeQueued = city.queue.some((order) => order.kind === 'settlement');

  return (
    <footer className="panel__actions">
      {city.queue.length > 0 && (
        <div className="panel__section">
          <div className="panel__heading">Under construction</div>
          {city.queue.map((order, position) => (
            <div className="progress" key={`${order.kind}-${position}`}>
              <span>
                {order.kind === 'building'
                  ? (options.find((b) => b.id === order.id)?.name ?? order.id)
                  : `Upgrade to ${TIER_NAME[order.targetTier]}`}
                {position > 0 && <span className="panel__muted"> · waiting</span>}
              </span>
              <span className="panel__muted">{order.monthsRemaining} mo</span>
              <button
                type="button"
                className="panel__close"
                title="Cancel, full refund"
                onClick={() => game.command((s) => cancelOrder(s, city, position))}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {upgrade && !upgradeQueued && (
        <button
          type="button"
          className="action action--primary"
          disabled={!canAfford(state, city.ownerIndex, upgrade.cost)}
          onClick={() => game.command((s) => queueSettlementUpgrade(s, city))}
        >
          <span>Upgrade to {upgrade.name}</span>
          <span className="action__cost">
            {costText(upgrade.cost)} · {upgrade.months} mo
          </span>
        </button>
      )}

      {options.length > 0 && (
        <div className="panel__section">
          <div className="panel__heading">Build</div>
          {options.map((building) => (
            <button
              key={building.id}
              type="button"
              className="action"
              disabled={!canAfford(state, city.ownerIndex, building.cost)}
              onClick={() => game.command((s) => queueBuilding(s, world, city, building.id))}
            >
              <span>{building.name}</span>
              <span className="action__cost">
                {costText(building.cost)} · {building.months} mo
              </span>
            </button>
          ))}
        </div>
      )}

      {city.buildings.length > 0 && (
        <p className="panel__note">
          Built: {city.buildings.map((id) => id.replace(/_/g, ' ')).join(', ')}
        </p>
      )}
      <p className="panel__note">Treasury {num(whole(state.factions[city.ownerIndex]?.stock.gold ?? 0))} gold</p>
    </footer>
  );
}
