import type { JSX } from 'react';
import { RELIGION_LABEL, type Faction } from '../data/factions';

interface StartScreenProps {
  playable: readonly Faction[];
  onChoose: (factionId: string) => void;
}

export function StartScreen({ playable, onChoose }: StartScreenProps): JSX.Element {
  return (
    <div className="start">
      <div className="start__inner">
        <h1 className="start__title">Medieval Factions</h1>
        <p className="start__subtitle">
          Europe, January 1350. One village, 250 gold, and every other realm against you.
        </p>

        <div className="start__factions">
          {playable.map((faction) => (
            <button
              key={faction.id}
              type="button"
              className="faction-card"
              style={{ borderColor: faction.color }}
              onClick={() => onChoose(faction.id)}
            >
              <span className="faction-card__swatch" style={{ background: faction.color }} />
              <span className="faction-card__name">{faction.name}</span>
              <span className="faction-card__meta">
                {RELIGION_LABEL[faction.religion]} · {faction.capital}
              </span>
            </button>
          ))}
        </div>

        <p className="start__note">
          The remaining ten factions are AI-only for now. v{__APP_VERSION__}
        </p>
      </div>
    </div>
  );
}
