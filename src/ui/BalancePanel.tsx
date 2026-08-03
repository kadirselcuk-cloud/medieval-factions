import { useState, type JSX } from 'react';
import type { Faction } from '../data/factions';
import type { World } from '../data/world';
import {
  growthBreakdown,
  incomeBreakdown,
  monthsToAfford,
  monthsToNextTier,
  project,
  totalDefenders,
  type Projection,
} from '../sim/balance';
import { settlementUpgradeTo } from '../data/buildings';
import { calendarAt } from '../sim/calendar';
import { TIER_NAME, whole, type SimState } from '../sim/types';
import { num } from './format';

/**
 * The balance panel — a developer tool, not part of the game.
 *
 * It exists because tuning an economy from guesses is how an economy gets tuned badly. Every
 * number here is broken into the terms that produced it, and the projections run the **real
 * simulation** forward on a copy rather than modelling it a second time, so what the panel
 * says is what the game will actually do.
 *
 * Any faction can be inspected, not only the player's — comparing your realm against an
 * untouched rival is the fastest way to see whether a rule is doing what it should.
 */
export function BalancePanel({
  state,
  world,
  roster,
  onClose,
}: {
  state: SimState;
  world: World;
  roster: readonly Faction[];
  onClose: () => void;
}): JSX.Element {
  const [factionIndex, setFaction] = useState(state.playerFactionIndex);
  const [projections, setProjections] = useState<Projection[]>([]);
  const [running, setRunning] = useState(false);

  const faction = state.factions[factionIndex];
  const income = incomeBreakdown(state, world, factionIndex);
  const cities = state.cities.filter((city) => city.ownerIndex === factionIndex);
  const date = calendarAt(state.tick);

  const runProjections = () => {
    setRunning(true);
    // Deferred a frame so the button can show it is working: 25 years is 36,000 ticks.
    setTimeout(() => {
      setProjections([1, 5, 10, 25].map((years) => project(state, world, factionIndex, years)));
      setRunning(false);
    }, 0);
  };

  return (
    <div className="overlay" role="dialog" aria-label="Balance">
      <div className="overlay__panel balance">
        <header className="overlay__header">
          <h2>⚖ Balance</h2>
          <button type="button" className="panel__close" onClick={onClose} title="Close">
            ✕
          </button>
        </header>

        <div className="balance__body">
          <div className="balance__pickers">
            <select
              value={factionIndex}
              onChange={(event) => {
                setFaction(Number(event.target.value));
                setProjections([]);
              }}
            >
              {roster.map((f, index) => (
                <option key={f.id} value={index}>
                  {f.name}
                  {index === state.playerFactionIndex ? ' (you)' : ''}
                </option>
              ))}
            </select>
            <span className="panel__muted">
              {date.monthName} {date.year} · tick {num(state.tick)}
            </span>
          </div>

          <Section title="Realm">
            <Fact label="Treasury" value={`${num(whole(faction?.stock.gold ?? 0))} gold`} />
            <Fact label="Wood / iron / stone" value={
              `${num(whole(faction?.stock.wood ?? 0))} / ${num(whole(faction?.stock.iron ?? 0))} / ${num(whole(faction?.stock.stone ?? 0))}`
            } />
            <Fact label="Settlements" value={String(cities.length)} />
            <Fact
              label="Tiles held"
              value={String([...state.tileOwner].filter((o) => o === factionIndex).length)}
            />
            <Fact label="Armies" value={String(state.armies.filter((a) => a.ownerIndex === factionIndex).length)} />
            <Fact label="Free defenders" value={String(totalDefenders(state, factionIndex))} />
          </Section>

          <Section title="Income, per month">
            <Fact label="Population" value={signed(income.population)} />
            <Fact label="Commerce" value={signed(income.commerce)} />
            <Fact label="Fishing" value={signed(income.fishing)} />
            <Fact label="Land, bare" value={signed(income.land)} />
            <Fact label="Improvements" value={signed(income.improvements)} />
            <Fact label="Upkeep" value={signed(income.upkeep)} />
            <Fact label="Net gold" value={signed(income.net)} strong />
            <Fact
              label="Wood / iron / stone"
              value={`${signed(income.wood)} / ${signed(income.iron)} / ${signed(income.stone)}`}
            />
            {faction && income.net !== faction.monthlyIncome.gold && (
              <p className="detail__reason">
                Breakdown disagrees with the simulation ({num(faction.monthlyIncome.gold)}). That is
                a bug in the balance panel, not in the campaign.
              </p>
            )}
          </Section>

          <Section title="Settlements">
            <div className="balance__scroll">
              <table className="balance__table">
                <thead>
                  <tr>
                    <th>Settlement</th>
                    <th>Tier</th>
                    <th>People</th>
                    <th>Growth</th>
                    <th>Next month</th>
                    <th>Next tier</th>
                  </tr>
                </thead>
                <tbody>
                  {cities.map((city) => {
                    const growth = growthBreakdown(state, city);
                    const months = monthsToNextTier(state, city);
                    const next = settlementUpgradeTo(city.tier + 1);
                    return (
                      <tr key={city.cityIndex}>
                        <td>{world.cities[city.cityIndex]?.name ?? city.cityIndex}</td>
                        <td>{TIER_NAME[city.tier]}</td>
                        <td>{num(city.population)}</td>
                        <td
                          title={
                            growth.besieged
                              ? 'Under siege — it starves, and nothing it has built counts'
                              : `base ${growth.base} · treasury ${growth.treasury} · tier ${growth.tier} · buildings ${growth.buildings}`
                          }
                        >
                          {signed(growth.total)}
                        </td>
                        <td>{growth.besieged ? 'besieged' : num(city.population + growth.total)}</td>
                        <td>
                          {!next
                            ? '—'
                            : months === null
                              ? 'never'
                              : months === 0
                                ? `${next.name}, ready`
                                : `${next.name}, ${duration(months)}`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="panel__note">
              Growth is broken down in each cell's tooltip. "Next tier" assumes the current rate
              holds, so it is a ceiling on the wait rather than a forecast — the rate itself
              climbs as the treasury does.
            </p>
          </Section>

          <Section title="Time to afford, at current net income">
            {[
              ['Wooden Houses', 120],
              ['Cottage Shops', 150],
              ['Barracks', 500],
              ['Expand to Town', settlementUpgradeTo(2)?.cost.gold ?? 0],
              ['Expand to City', settlementUpgradeTo(3)?.cost.gold ?? 0],
              ['Expand to Capitol', settlementUpgradeTo(4)?.cost.gold ?? 0],
            ].map(([label, gold]) => {
              const months = monthsToAfford(state, factionIndex, gold as number);
              return (
                <Fact
                  key={label as string}
                  label={`${label} · ${num(gold as number)}g`}
                  value={months === null ? 'never at this rate' : months === 0 ? 'affordable now' : duration(months)}
                />
              );
            })}
          </Section>

          <Section title="If nothing changes">
            {projections.length === 0 ? (
              <>
                <p className="panel__note">
                  Runs the real simulation forward on a copy of this campaign. The live game is
                  not touched.
                </p>
                <button type="button" className="action action--primary" onClick={runProjections} disabled={running}>
                  {running ? 'Running…' : 'Project 1, 5, 10 and 25 years'}
                </button>
              </>
            ) : (
              <div className="balance__scroll">
                <table className="balance__table">
                  <thead>
                    <tr>
                      <th>In</th>
                      <th>Gold</th>
                      <th>People</th>
                      <th>Settlements</th>
                      <th>Best tier</th>
                    </tr>
                  </thead>
                  <tbody>
                    {projections.map((p) => (
                      <tr key={p.years}>
                        <td>{p.years} {p.years === 1 ? 'year' : 'years'}</td>
                        <td>{num(p.gold)}</td>
                        <td>{num(p.population)}</td>
                        <td>{p.cities}</td>
                        <td>{p.bestTier > 0 ? TIER_NAME[p.bestTier as 1 | 2 | 3 | 4] : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          <p className="panel__note">
            A developer tool. Nothing here changes the campaign — press <kbd>B</kbd> to open and
            close it.
          </p>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="panel__section">
      <div className="panel__heading">{title}</div>
      {children}
    </div>
  );
}

function Fact({ label, value, strong }: { label: string; value: string; strong?: boolean }): JSX.Element {
  return (
    <div className="panel__row">
      <span className="panel__label">{label}</span>
      <span className={`panel__value${strong ? ' balance__strong' : ''}`}>{value}</span>
    </div>
  );
}

function signed(value: number): string {
  return value >= 0 ? `+${num(value)}` : num(value);
}

/** Months, said the way a player would say them. */
function duration(months: number): string {
  if (months < 24) return `${months} mo`;
  const years = months / 12;
  return years < 10 ? `${years.toFixed(1)} yrs` : `${Math.round(years)} yrs`;
}
