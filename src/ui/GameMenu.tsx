import { useCallback, useEffect, useState, type JSX } from 'react';
import { difficultyProfile } from '../data/ai';
import { calendarAt } from '../sim/calendar';
import type { Game } from '../sim/game';
import {
  deleteSave,
  deserialise,
  fromJSON,
  listSaves,
  readSave,
  toJSON,
  type SaveMeta,
} from '../sim/save';

const KIND_LABEL: Record<SaveMeta['kind'], string> = {
  manual: 'Manual',
  monthly: 'Autosave',
  yearly: 'Yearly',
};

/**
 * The game menu — saving, loading and options, behind one button.
 *
 * Options is deliberately thin: it holds the settings that actually exist rather than a row of
 * switches wired to nothing. It grows as the game gains things worth setting.
 */
export function GameMenu({
  game,
  onClose,
  fullscreen,
  onFullscreen,
}: {
  game: Game;
  onClose: () => void;
  fullscreen: boolean;
  onFullscreen: () => void;
}): JSX.Element {
  const [saves, setSaves] = useState<SaveMeta[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    listSaves()
      .then(setSaves)
      .catch((e: unknown) => setError(describe(e)));
  }, []);

  useEffect(refresh, [refresh]);

  const run = (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    work()
      .then(refresh)
      .catch((e: unknown) => setError(describe(e)))
      .finally(() => setBusy(false));
  };

  const load = (id: string) =>
    run(async () => {
      const file = await readSave(id);
      if (!file) throw new Error('That save is no longer there.');
      game.setSpeed(0);
      game.loadState(deserialise(file.state));
      onClose();
    });

  const exportSave = () => {
    const blob = new Blob([toJSON(game.snapshot())], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${game.describe().replace(/[^\w-]+/g, '-').toLowerCase()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const importSave = (file: File) =>
    run(async () => {
      const parsed = fromJSON(await file.text());
      game.setSpeed(0);
      game.loadState(deserialise(parsed.state));
      onClose();
    });

  return (
    <div className="overlay" role="dialog" aria-label="Menu">
      <div className="overlay__panel">
        <header className="overlay__header">
          <h2>Menu</h2>
          <button type="button" className="panel__close" onClick={onClose} title="Close">
            ✕
          </button>
        </header>

        <div className="overlay__actions">
          <button
            type="button"
            className="action"
            disabled={busy}
            onClick={() => run(() => game.save(game.describe()))}
          >
            Save now
          </button>
          <button type="button" className="action" onClick={exportSave}>
            Export to file
          </button>
          <label className="action action--file">
            Import from file
            <input
              type="file"
              accept="application/json"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) importSave(file);
                event.target.value = '';
              }}
            />
          </label>
        </div>

        {error && <p className="overlay__error">{error}</p>}

        <div className="overlay__section">
          <div className="panel__heading">Options</div>
          <label className="option-row">
            <input type="checkbox" checked={fullscreen} onChange={onFullscreen} />
            Full screen
          </label>
          <div className="panel__row">
            <span className="panel__label">Difficulty</span>
            <span className="panel__value">{difficultyProfile(game.difficulty).name}</span>
          </div>
          <p className="panel__note">
            {difficultyProfile(game.difficulty).blurb} It is fixed for the campaign — every rival
            realm was created at this level and carries it in the save.
          </p>
          {game.cheatsUnlocked && (
            <p className="panel__note">
              Maximum speed is unlocked. It is a testing cheat and will not ship.
            </p>
          )}
          {/* CHEAT — remove before release. */}
          {game.fogRevealed && (
            <p className="panel__note">
              Fog of war is off. It is a testing cheat and will not ship — the FOG button beside
              the speeds puts it back.
            </p>
          )}
        </div>

        <div className="overlay__list">
          <div className="panel__heading">Load</div>
          {saves.length === 0 && <p className="panel__note">No saves yet. Autosaves appear each month.</p>}
          {saves.map((save) => {
            const date = calendarAt(save.tick);
            return (
              <div className="save-row" key={save.id}>
                <div className="save-row__main">
                  <span className="save-row__name">{save.name}</span>
                  <span className="panel__muted">
                    {KIND_LABEL[save.kind]} · {date.monthName} {date.year}
                  </span>
                </div>
                <button type="button" className="action action--minor" disabled={busy} onClick={() => load(save.id)}>
                  Load
                </button>
                <button
                  type="button"
                  className="panel__close"
                  title="Delete"
                  disabled={busy}
                  onClick={() => run(() => deleteSave(save.id))}
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>

        <footer className="overlay__foot">
          Medieval Factions <strong>v{__APP_VERSION__}</strong>
        </footer>
      </div>
    </div>
  );
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
