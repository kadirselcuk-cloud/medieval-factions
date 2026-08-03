import { useState, type JSX } from 'react';
import { loadDifficulties, LEVEL_DIFFICULTY } from '../data/ai';
import { RELIGION_LABEL, type Faction } from '../data/factions';
import type { AiDifficulty } from '../sim/types';

interface StartScreenProps {
  playable: readonly Faction[];
  onChoose: (factionId: string, difficulty: AiDifficulty) => void;
}

/**
 * Faction and difficulty, in that order of importance.
 *
 * Difficulty is picked before the campaign starts because it is written into every rival realm
 * at creation and lives in the save — there is no mid-campaign switch, and a loaded campaign is
 * played against the opponents it was started against.
 */
export function StartScreen({ playable, onChoose }: StartScreenProps): JSX.Element {
  const [difficulty, setDifficulty] = useState<AiDifficulty>(LEVEL_DIFFICULTY);
  const levels = loadDifficulties();
  const chosen = levels.find((level) => level.id === difficulty);

  return (
    <div className="start">
      <div className="start__inner">
        <h1 className="start__title">Medieval Factions</h1>
        <p className="start__subtitle">
          Europe, January 1350. One village, 250 gold, and every other realm against you.
        </p>

        <div className="start__section">
          <div className="start__heading">Difficulty</div>
          <div className="start__levels">
            {levels.map((level) => (
              <button
                key={level.id}
                type="button"
                className={`level-chip${level.id === difficulty ? ' level-chip--on' : ''}`}
                onClick={() => setDifficulty(level.id)}
                aria-pressed={level.id === difficulty}
              >
                {level.name}
              </button>
            ))}
          </div>
          {chosen && <p className="start__note start__note--level">{chosen.blurb}</p>}
        </div>

        <div className="start__section">
          <div className="start__heading">Realm</div>
          <div className="start__factions">
            {playable.map((faction) => (
              <button
                key={faction.id}
                type="button"
                className="faction-card"
                style={{ borderColor: faction.color }}
                onClick={() => onChoose(faction.id, difficulty)}
              >
                <span className="faction-card__swatch" style={{ background: faction.color }} />
                <span className="faction-card__name">{faction.name}</span>
                <span className="faction-card__meta">
                  {RELIGION_LABEL[faction.religion]} · {faction.capital}
                </span>
              </button>
            ))}
          </div>
        </div>

        <p className="start__note">
          The remaining ten factions are AI-only for now. v{__APP_VERSION__}
        </p>
      </div>
    </div>
  );
}
