import { useEffect, useMemo, useState, type JSX } from 'react';
import { artFor } from '../data/art';
import type { Faction } from '../data/factions';
import { unitById } from '../data/units';
import type { World } from '../data/world';
import { ATTACKER, BATTLE_TURNS_PER_TICK, DEFENDER, FIELD_WIDTH } from '../sim/battle';
import type { BattleReport, BattleSide } from '../sim/types';

/**
 * The battle viewer — docs/DESIGN.md decision 10, "auto-resolve is watchable".
 *
 * It replays a report rather than driving the simulation: the battle was fought the moment the
 * armies met, and what is on screen is the log of it. Every frame is derived by replaying the
 * log from the opening bell, so scrubbing backwards is exact and there is no second model of
 * the fight that could disagree with the first.
 */

/** One battle turn is an in-game hour, six to a tick — so six a second at 1×. */
const MS_PER_TURN = 1000 / BATTLE_TURNS_PER_TICK;

const PLAYBACK_SPEEDS = [1, 2, 5] as const;

interface Frame {
  /** Tiles from the attacker's edge, by slot. */
  position: number[];
  /** Soldiers left, by slot. */
  soldiers: number[];
}

/**
 * Every state the field passed through, replayed from the log.
 *
 * Frame 0 is the opening line-up; frame N is the field after turn N has been fought.
 */
function replay(report: BattleReport): Frame[] {
  const position = report.fighters.map((f) => f.position);
  const soldiers = report.fighters.map((f) => f.soldiers);
  const frames: Frame[] = [{ position: [...position], soldiers: [...soldiers] }];

  for (const turn of report.turns) {
    for (const action of turn.actions) {
      if (action.kind === 'move') {
        position[action.slot] = action.to;
      } else {
        soldiers[action.target] = Math.max(0, (soldiers[action.target] ?? 0) - action.casualties);
      }
    }
    frames.push({ position: [...position], soldiers: [...soldiers] });
  }
  return frames;
}

function percent(value: number): string {
  return `${(value / FIELD_WIDTH) * 100}%`;
}

/** The defender's advantage, written out as the terms that produced it. */
function advantageText(report: BattleReport): string {
  const parts: string[] = [`terrain ${report.advantage.terrain / 10}%`];
  if (report.advantage.settlement > 0) parts.push(`settlement ${report.advantage.settlement / 10}%`);
  if (report.advantage.fortification > 0) parts.push(`walls ${report.advantage.fortification / 10}%`);
  if (report.advantage.winter > 0) parts.push(`winter ${report.advantage.winter / 10}%`);
  return `${parts.join(' + ')} = ${report.advantage.total / 10}%`;
}

const SOURCE_LABEL: Record<string, string> = {
  army: 'Army',
  garrison: 'Garrison',
  defence: 'Defenders',
};

function outcomeText(report: BattleReport, attacker: string, defender: string): string {
  if (report.winner === 'stalemate') {
    return report.ending === 'cap'
      ? 'Stalemate — the day ran out and both armies withdrew'
      : 'Both armies were destroyed';
  }
  const winner = report.winner === 'attacker' ? attacker : defender;
  const loser = report.winner === 'attacker' ? defender : attacker;
  const how = report.ending === 'rout' ? `broke ${loser}` : `destroyed ${loser}`;
  return `${winner} ${how}${report.captured ? ' and took the settlement' : ''}`;
}

export function BattleView({
  report,
  world,
  roster,
  onClose,
}: {
  report: BattleReport;
  world: World;
  roster: readonly Faction[];
  onClose: () => void;
}): JSX.Element {
  const frames = useMemo(() => replay(report), [report]);
  const [turn, setTurn] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState<(typeof PLAYBACK_SPEEDS)[number]>(1);

  // One timer per turn rather than one interval for the battle, so scrubbing the slider and
  // changing speed both take effect on the next hour instead of fighting the running clock.
  useEffect(() => {
    if (!playing) return;
    if (turn >= frames.length - 1) {
      setPlaying(false);
      return;
    }
    const handle = window.setTimeout(() => setTurn((current) => current + 1), MS_PER_TURN / speed);
    return () => window.clearTimeout(handle);
  }, [playing, speed, turn, frames.length]);

  const frame = frames[turn] ?? frames[0];
  const actions = turn > 0 ? (report.turns[turn - 1]?.actions ?? []) : [];
  const acting = new Set(actions.map((a) => a.slot));
  const struck = new Set(actions.filter((a) => a.kind !== 'move').map((a) => a.target));

  const nameOf = (index: number) => roster[index]?.name ?? 'Unknown';
  const colourOf = (index: number) => roster[index]?.color ?? '#888';
  const where =
    report.cityIndex >= 0
      ? (world.cities[report.cityIndex]?.name ?? 'a settlement')
      : `${report.tileIndex % world.width}, ${Math.floor(report.tileIndex / world.width)}`;

  const finished = turn >= frames.length - 1;

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Battle">
      <div className="overlay__panel overlay__panel--battle">
        <header className="overlay__header battle__head">
          <div>
            <h2>
              <span style={{ color: colourOf(report.attackerIndex) }}>
                {nameOf(report.attackerIndex)}
              </span>
              <span className="battle__vs">attacks</span>
              <span style={{ color: colourOf(report.defenderIndex) }}>
                {nameOf(report.defenderIndex)}
              </span>
            </h2>
            <p className="battle__where">
              {where} · behind the walls {advantageText(report)}
              {sortied(report) && ' · the defenders came out, so nobody has them'}
            </p>
          </div>
          <button type="button" className="panel__close" onClick={onClose} title="Close">
            ✕
          </button>
        </header>

        <div className="battle__field">
          {([ATTACKER, DEFENDER] as const).map((side) => (
            <div className="battle__side" key={side}>
              <h3 className="battle__side-name" style={{ color: colourOf(sideFaction(report, side)) }}>
                {nameOf(sideFaction(report, side))}
                <span className="battle__side-role">{side === ATTACKER ? 'attacking' : 'defending'}</span>
              </h3>

              {report.fighters
                .filter((f) => f.side === side)
                .map((fighter) => {
                  const unit = unitById(fighter.unitId);
                  const left = frame?.soldiers[fighter.slot] ?? 0;
                  const alive = left > 0;
                  return (
                    <div
                      className={`battle__row${alive ? '' : ' battle__row--dead'}`}
                      key={fighter.slot}
                    >
                      <span
                        className="battle__unit"
                        title={`${SOURCE_LABEL[fighter.source]}${
                          fighter.advantage > 0
                            ? ` · fighting with ${fighter.advantage / 10}% of the ground`
                            : ''
                        }`}
                      >
                        <span aria-hidden="true">{artFor(fighter.unitId).icon}</span>
                        {unit?.name ?? fighter.unitId}
                        {fighter.advantage > 0 && (
                          <span className="battle__ground">+{fighter.advantage / 10}%</span>
                        )}
                      </span>

                      <span className="battle__track">
                        <span
                          className={`battle__chip${acting.has(fighter.slot) ? ' battle__chip--acting' : ''}${
                            struck.has(fighter.slot) ? ' battle__chip--hit' : ''
                          }`}
                          style={{
                            left: percent(frame?.position[fighter.slot] ?? fighter.position),
                            background: colourOf(sideFaction(report, side)),
                          }}
                        />
                      </span>

                      <span className="battle__strength">
                        <span
                          className="battle__strength-bar"
                          style={{ width: `${(left / fighter.soldiers) * 100}%` }}
                        />
                        <span className="battle__strength-text">
                          {left}/{fighter.soldiers}
                        </span>
                      </span>
                    </div>
                  );
                })}
            </div>
          ))}
        </div>

        <div className="battle__ticker">
          {turn === 0 && <p>The lines form up {FIELD_WIDTH} tiles apart.</p>}
          {actions
            .filter((a) => a.kind !== 'move')
            .map((action, i) => (
              <p key={i}>
                <strong>{unitById(report.fighters[action.slot]?.unitId ?? '')?.name}</strong>
                {action.kind === 'shoot' ? ' looses on ' : action.charge ? ' charges ' : ' strikes '}
                <strong>{unitById(report.fighters[action.target]?.unitId ?? '')?.name}</strong>
                {` — ${action.casualties} dead`}
              </p>
            ))}
          {actions.length > 0 && actions.every((a) => a.kind === 'move') && <p>The lines close.</p>}
        </div>

        {finished && (
          <p className="battle__outcome">
            {outcomeText(report, nameOf(report.attackerIndex), nameOf(report.defenderIndex))}.{' '}
            {nameOf(report.attackerIndex)} lost {report.losses[ATTACKER]} men,{' '}
            {nameOf(report.defenderIndex)} lost {report.losses[DEFENDER]}.
          </p>
        )}

        <footer className="battle__controls">
          <button type="button" onClick={() => setPlaying((p) => !p)} disabled={finished}>
            {playing ? '❚❚ Pause' : '▶ Play'}
          </button>
          <input
            type="range"
            min={0}
            max={frames.length - 1}
            value={turn}
            onChange={(event) => {
              setPlaying(false);
              setTurn(Number(event.target.value));
            }}
            aria-label="Battle turn"
          />
          <span className="battle__turn">
            Hour {turn} / {frames.length - 1}
          </span>
          <div className="bar__group">
            {PLAYBACK_SPEEDS.map((value) => (
              <button
                key={value}
                type="button"
                className={`speed-button${speed === value ? ' speed-button--active' : ''}`}
                onClick={() => setSpeed(value)}
              >
                {value}×
              </button>
            ))}
          </div>
          <button type="button" onClick={() => setTurn(frames.length - 1)}>
            Skip to end
          </button>
        </footer>
      </div>
    </div>
  );
}

function sideFaction(report: BattleReport, side: BattleSide): number {
  return side === ATTACKER ? report.attackerIndex : report.defenderIndex;
}

/**
 * Whether this was a sortie — a starved-out garrison forced into the open.
 *
 * Read off the field rather than stored: if the settlement's own troops are fighting on less
 * ground than the walls would give them, they are not behind the walls.
 */
function sortied(report: BattleReport): boolean {
  if (report.cityIndex < 0 || report.advantage.fortification === 0) return false;
  return report.fighters.some(
    (f) => f.source === 'defence' && f.advantage < report.advantage.total,
  );
}
