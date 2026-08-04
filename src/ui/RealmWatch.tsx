import type { JSX } from 'react';
import type { Faction } from '../data/factions';
import { aiSummary } from '../sim/ai';
import { totalUpkeep } from '../sim/construction';
import { personalityProfile } from '../data/ai';
import { whole, type SimState } from '../sim/types';
import { num, signed } from './format';

/**
 * Every realm's economy at a glance, while the map is revealed.
 *
 * The same figures the balance panel reports under `B`, put on screen rather than behind a key,
 * because the question they answer — *why is everyone fielding heavy cavalry?* — is one you ask
 * while watching a century run, not one you pause to look up.
 *
 * Shown whenever the fog is off: the **cheat** (Pause ×5 then 1× ×5) or **observer mode** after
 * defeat. Read-only and derived, like everything in the balance panel: nothing here is stored and
 * nothing the simulation does depends on it.
 *
 * **Gross and upkeep are split out on purpose.** `monthlyIncome.gold` is already net of wages
 * (see `recomputeIncome`), so a realm with a large army shows a healthy gross and a net near zero
 * — and that gap is the thing worth watching. A realm whose upkeep is most of its income has
 * stopped building and is only feeding troops.
 */
export function RealmWatch({
  state,
  roster,
}: {
  state: SimState;
  roster: readonly Faction[];
}): JSX.Element {
  const rows = state.factions
    .filter((faction) => faction.alive)
    .map((faction) => {
      const summary = aiSummary(state, faction.index);
      const upkeep = totalUpkeep(state, faction.index);
      const net = faction.monthlyIncome.gold;
      return {
        faction,
        name: roster[faction.index]?.name ?? faction.id,
        color: roster[faction.index]?.color ?? '#888',
        character:
          faction.index === state.playerFactionIndex
            ? 'you'
            : faction.ai
              ? personalityProfile(faction.ai.personality).name
              : '—',
        gold: whole(faction.stock.gold),
        gross: net + upkeep,
        upkeep,
        net,
        ...summary,
      };
    })
    // Richest first: the realm running away with the campaign is the one worth looking at.
    .sort((a, b) => b.gold - a.gold);

  return (
    <aside className="realm-watch">
      <div className="realm-watch__title">Realms — the fog is off</div>
      <div className="realm-watch__scroll">
        <table className="realm-watch__table">
          <thead>
            <tr>
              <th>Realm</th>
              <th>Bent</th>
              <th>Cities</th>
              <th>Gold</th>
              <th>Gross</th>
              <th>Upkeep</th>
              <th>Net</th>
              <th>Armies</th>
              <th>Units</th>
              <th>Soldiers</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.faction.id}>
                <td>
                  <span
                    className="swatch swatch--small"
                    style={{ background: row.color }}
                    aria-hidden="true"
                  />
                  {row.name}
                </td>
                <td className="realm-watch__muted">{row.character}</td>
                <td>{row.cities}</td>
                <td className={row.gold < 0 ? 'realm-watch__bad' : undefined}>{num(row.gold)}</td>
                <td>{num(row.gross)}</td>
                <td className="realm-watch__muted">−{num(row.upkeep)}</td>
                <td className={row.net < 0 ? 'realm-watch__bad' : 'realm-watch__good'}>
                  {signed(row.net)}
                </td>
                <td>{row.armies}</td>
                <td>{row.units}</td>
                <td>{num(row.soldiers)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </aside>
  );
}
