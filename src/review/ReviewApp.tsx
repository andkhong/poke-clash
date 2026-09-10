import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { buildMoveCatalog, type ReviewMove } from './moveCatalog';
import {
  countMarked,
  isMarked,
  loadMarks,
  marksToMarkdown,
  parseMarks,
  saveMarks,
  serializeMarks,
  setMark,
  type ReviewMarks,
} from './reviewStore';
import { ReviewStage } from './ReviewStage';
import type { PlaybackSpeed, ReviewLayout, ReviewPlaybackOptions, ReviewScene, ReviewStageStatus } from './ReviewScene';
import { hasPmdSprite, listAllSpecies, type SpeciesSummary } from '../data/loader';
import { getMoveTypeColor } from '../render/vfx/typeColor';
import { animationSheetUrl } from '../data/moveAnimationFormat';
import { MOVE_ANIM_ASSET_VERSION } from '../render/vfx/anim/moveAnimLoader';
import { frameDurationMs } from '../render/vfx/anim/AnimPlayer';
import { POST_ATTACK_HOLD_MS } from '../sim/constants';
import type { MoveCategory, PokemonTypeName } from '../sim/types';

// The move-VFX review page: browse every move, watch it play on the stage
// exactly as a match would show it, and mark the ones whose effect should
// change (with a note). Marks live in localStorage and export as Markdown
// or JSON — see reviewStore.ts.

const TYPE_NAMES: PokemonTypeName[] = [
  'normal', 'fire', 'water', 'electric', 'grass', 'ice', 'fighting', 'poison', 'ground',
  'flying', 'psychic', 'bug', 'rock', 'ghost', 'dragon', 'dark', 'steel', 'fairy',
];
const CATEGORY_SHORT: Record<MoveCategory, string> = { physical: 'PHYS', special: 'SPEC', status: 'STAT' };
const SPEED_LABELS: Record<PlaybackSpeed, string> = {
  arena: 'Arena speed (2x, as in a match)',
  native: 'Native speed (1x)',
  slow: 'Slow (0.5x)',
};
const PREFS_STORAGE_KEY = 'poke-clash.vfx-review.prefs.v1';
const TOAST_MS = 2500;
const LOOP_GAP_MS = 350;
const PREFETCH_AHEAD = 6;

type SourceFilter = 'all' | 'pack' | 'family';
type MarkFilter = 'all' | 'marked' | 'unmarked';

interface Filters {
  query: string;
  type: 'all' | PokemonTypeName;
  category: 'all' | MoveCategory;
  source: SourceFilter;
  mark: MarkFilter;
}

interface ReviewPrefs {
  attackerSpeciesId: number;
  targetSpeciesId: number;
  options: ReviewPlaybackOptions & { loop: boolean; autoplay: boolean };
  layout: ReviewLayout;
}

const DEFAULT_PREFS: ReviewPrefs = {
  attackerSpeciesId: 25, // Pikachu
  targetSpeciesId: 4, // Charmander
  options: { speed: 'arena', sound: true, miss: false, loop: false, autoplay: true },
  layout: { distance: 220, angleDeg: 0 },
};

function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function loadPrefs(species: readonly SpeciesSummary[]): ReviewPrefs {
  let prefs = DEFAULT_PREFS;
  try {
    const raw = safeStorage()?.getItem(PREFS_STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<ReviewPrefs>;
      prefs = {
        ...DEFAULT_PREFS,
        ...saved,
        options: { ...DEFAULT_PREFS.options, ...saved.options },
        layout: { ...DEFAULT_PREFS.layout, ...saved.layout },
      };
    }
  } catch {
    // corrupt or blocked storage: defaults
  }
  const valid = new Set(species.map((s) => s.id));
  const fallback = species.map((s) => s.id);
  if (!valid.has(prefs.attackerSpeciesId)) prefs = { ...prefs, attackerSpeciesId: fallback[0] ?? 0 };
  if (!valid.has(prefs.targetSpeciesId)) prefs = { ...prefs, targetSpeciesId: fallback[1] ?? fallback[0] ?? 0 };
  return prefs;
}

function savePrefs(prefs: ReviewPrefs): void {
  try {
    safeStorage()?.setItem(PREFS_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // fine — prefs are a convenience
  }
}

function typeHex(type: PokemonTypeName): string {
  return `#${getMoveTypeColor(type).toString(16).padStart(6, '0')}`;
}

function matchesFilters(entry: ReviewMove, filters: Filters, marks: ReviewMarks, query: string): boolean {
  const { move, source } = entry;
  if (filters.type !== 'all' && move.type !== filters.type) return false;
  if (filters.category !== 'all' && move.category !== filters.category) return false;
  if (filters.source !== 'all' && source.kind !== filters.source) return false;
  if (filters.mark !== 'all') {
    const marked = isMarked(marks[String(move.id)]);
    if (filters.mark === 'marked' ? !marked : marked) return false;
  }
  if (query && !move.name.toLowerCase().includes(query) && String(move.id) !== query) return false;
  return true;
}

export function ReviewApp() {
  const catalog = useMemo(buildMoveCatalog, []);
  const byId = useMemo(() => new Map(catalog.map((entry) => [entry.move.id, entry])), [catalog]);
  const species = useMemo(
    () => listAllSpecies().filter((s) => hasPmdSprite(s.id)).sort((a, b) => a.name.localeCompare(b.name)),
    []
  );

  const [prefs, setPrefs] = useState<ReviewPrefs>(() => loadPrefs(species));
  const [marks, setMarks] = useState<ReviewMarks>(() => loadMarks(safeStorage()));
  const [filters, setFilters] = useState<Filters>({ query: '', type: 'all', category: 'all', source: 'all', mark: 'all' });
  const [selectedId, setSelectedId] = useState<number>(() => catalog[0]?.move.id ?? 0);
  const [scene, setScene] = useState<ReviewScene | null>(null);
  const [status, setStatus] = useState<ReviewStageStatus>({ kind: 'booting' });
  const [toast, setToast] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const noteRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef(new Map<number, HTMLButtonElement>());
  const initialSceneData = useRef({
    attackerSpeciesId: prefs.attackerSpeciesId,
    targetSpeciesId: prefs.targetSpeciesId,
    layout: prefs.layout,
  });

  useEffect(() => saveMarks(safeStorage(), marks), [marks]);
  useEffect(() => savePrefs(prefs), [prefs]);

  // Stage wiring: status feed, fighters, layout.
  useEffect(() => scene?.subscribe(setStatus), [scene]);
  useEffect(() => scene?.setSpecies(prefs.attackerSpeciesId, prefs.targetSpeciesId), [scene, prefs.attackerSpeciesId, prefs.targetSpeciesId]);
  useEffect(() => scene?.setLayout(prefs.layout), [scene, prefs.layout]);

  const query = filters.query.trim().toLowerCase();
  const filtered = useMemo(
    () => catalog.filter((entry) => matchesFilters(entry, filters, marks, query)),
    [catalog, filters, marks, query]
  );
  const selected = byId.get(selectedId) ?? null;
  const selectedMark = marks[String(selectedId)];
  const markedCount = useMemo(() => countMarked(marks), [marks]);

  // Refs so the keyboard handler and stage callbacks never go stale.
  const sceneRef = useRef(scene);
  sceneRef.current = scene;
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const filteredRef = useRef(filtered);
  filteredRef.current = filtered;
  const optionsRef = useRef(prefs.options);
  optionsRef.current = prefs.options;

  const play = useCallback((moveId: number) => {
    const { speed, sound, miss } = optionsRef.current;
    void sceneRef.current?.playMove(moveId, { speed, sound, miss });
  }, []);
  const replay = useCallback(() => play(selectedIdRef.current), [play]);

  // Autoplay whenever the selection changes (and once, when the stage is up).
  const stageReady = status.kind !== 'booting';
  useEffect(() => {
    if (stageReady && optionsRef.current.autoplay) play(selectedId);
  }, [stageReady, selectedId, play]);

  // Loop: replay once a playback ends, after a short gap.
  const previousStatus = useRef(status.kind);
  useEffect(() => {
    const previous = previousStatus.current;
    previousStatus.current = status.kind;
    if (previous !== 'playing' || status.kind !== 'idle' || !optionsRef.current.loop) return;
    const timer = window.setTimeout(replay, LOOP_GAP_MS);
    return () => window.clearTimeout(timer);
  }, [status, replay]);

  // Keep the next few moves' pack animations downloading in the background.
  useEffect(() => {
    if (!scene) return;
    const index = filtered.findIndex((entry) => entry.move.id === selectedId);
    const ahead = filtered.slice(Math.max(0, index + 1), Math.max(0, index + 1) + PREFETCH_AHEAD);
    if (ahead.length > 0) scene.prefetch(ahead.map((entry) => entry.move.id));
  }, [scene, filtered, selectedId]);

  useEffect(() => {
    rowRefs.current.get(selectedId)?.scrollIntoView({ block: 'nearest' });
  }, [selectedId]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const step = useCallback((delta: number) => {
    const list = filteredRef.current;
    if (list.length === 0) return;
    const index = list.findIndex((entry) => entry.move.id === selectedIdRef.current);
    const next = index < 0 ? (delta > 0 ? 0 : list.length - 1) : Math.min(list.length - 1, Math.max(0, index + delta));
    setSelectedId(list[next].move.id);
  }, []);

  const toggleChange = useCallback(() => {
    setMarks((current) => {
      const id = selectedIdRef.current;
      return setMark(current, id, { change: !current[String(id)]?.change });
    });
  }, []);
  const setNote = useCallback((note: string) => {
    setMarks((current) => setMark(current, selectedIdRef.current, { note }));
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      const typing = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT');
      if (typing) {
        if (event.key === 'Escape') target.blur();
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      switch (event.key) {
        case 'ArrowDown':
        case 'j':
          step(1);
          break;
        case 'ArrowUp':
        case 'k':
          step(-1);
          break;
        case ' ':
        case 'Enter':
          replay();
          break;
        case 'm':
        case 'M':
          toggleChange();
          break;
        case 'n':
        case 'N':
          noteRef.current?.focus();
          break;
        default:
          return;
      }
      event.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [step, replay, toggleChange]);

  const updateOptions = (patch: Partial<ReviewPrefs['options']>): void =>
    setPrefs((current) => ({ ...current, options: { ...current.options, ...patch } }));
  const updateLayout = (patch: Partial<ReviewLayout>): void =>
    setPrefs((current) => ({ ...current, layout: { ...current.layout, ...patch } }));

  const copyMarkdown = async (): Promise<void> => {
    const markdown = marksToMarkdown(marks, catalog);
    try {
      await navigator.clipboard.writeText(markdown);
      setToast(`Copied ${markedCount} marked move${markedCount === 1 ? '' : 's'} as Markdown`);
    } catch {
      setToast('Clipboard unavailable — use Download JSON');
    }
  };
  const downloadJson = (): void => {
    const blob = new Blob([serializeMarks(marks)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `vfx-review-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  const importJson = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    void file.text().then((text) => {
      try {
        const imported = parseMarks(text);
        setMarks((current) => ({ ...current, ...imported }));
        setToast(`Imported ${Object.keys(imported).length} mark${Object.keys(imported).length === 1 ? '' : 's'}`);
      } catch (error) {
        setToast(`Import failed: ${(error as Error).message}`);
      }
    });
  };
  const clearMarks = (): void => {
    if (!confirmClear) {
      setConfirmClear(true);
      window.setTimeout(() => setConfirmClear(false), 4000);
      return;
    }
    setMarks({});
    setConfirmClear(false);
    setToast('All marks cleared');
  };

  const statusText = describeStatus(status, byId);

  return (
    <div className="app">
      <header className="header">
        <h1>Move VFX Review</h1>
        <span className="count">
          <strong>{markedCount}</strong> marked · {catalog.length} moves
        </span>
        <span className="spacer" />
        {toast && <span className="toast">{toast}</span>}
        <button className="btn" onClick={() => void copyMarkdown()} disabled={markedCount === 0} title="Copy the marked moves as a Markdown table">
          Copy Markdown
        </button>
        <button className="btn" onClick={downloadJson} disabled={markedCount === 0}>
          Download JSON
        </button>
        <button className="btn" onClick={() => fileInputRef.current?.click()}>
          Import JSON
        </button>
        <input ref={fileInputRef} type="file" accept="application/json,.json" hidden onChange={importJson} />
        <button className="btn danger" onClick={clearMarks} disabled={markedCount === 0}>
          {confirmClear ? 'Really clear all marks?' : 'Clear marks'}
        </button>
      </header>

      <div className="body">
        <aside className="list-panel">
          <div className="filters">
            <input
              type="search"
              placeholder="Search moves… (name or id)"
              value={filters.query}
              onChange={(e) => setFilters({ ...filters, query: e.target.value })}
            />
            <div className="row">
              <select value={filters.type} onChange={(e) => setFilters({ ...filters, type: e.target.value as Filters['type'] })}>
                <option value="all">All types</option>
                {TYPE_NAMES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
              <select value={filters.category} onChange={(e) => setFilters({ ...filters, category: e.target.value as Filters['category'] })}>
                <option value="all">All categories</option>
                <option value="physical">Physical</option>
                <option value="special">Special</option>
                <option value="status">Status</option>
              </select>
            </div>
            <div className="row">
              <select value={filters.source} onChange={(e) => setFilters({ ...filters, source: e.target.value as SourceFilter })}>
                <option value="all">Any animation source</option>
                <option value="pack">Sprite pack animation</option>
                <option value="family">Arena family VFX</option>
              </select>
              <select value={filters.mark} onChange={(e) => setFilters({ ...filters, mark: e.target.value as MarkFilter })}>
                <option value="all">Marked or not</option>
                <option value="marked">Marked only</option>
                <option value="unmarked">Unmarked only</option>
              </select>
            </div>
            <span className="hint" style={{ color: 'var(--muted)', fontSize: 11 }}>
              {filtered.length} of {catalog.length} shown
            </span>
          </div>
          <div className="list">
            {filtered.length === 0 && <div className="empty">No moves match these filters.</div>}
            {filtered.map((entry) => {
              const { move, source } = entry;
              const marked = isMarked(marks[String(move.id)]);
              return (
                <button
                  key={move.id}
                  ref={(el) => {
                    if (el) rowRefs.current.set(move.id, el);
                    else rowRefs.current.delete(move.id);
                  }}
                  className={`move-row${move.id === selectedId ? ' selected' : ''}${marked ? ' marked' : ''}`}
                  onClick={() => setSelectedId(move.id)}
                >
                  <span className="chip type" style={{ background: typeHex(move.type) }}>
                    {move.type.slice(0, 3)}
                  </span>
                  <span className="name">{move.name}</span>
                  <span className="meta">{CATEGORY_SHORT[move.category]}</span>
                  <span className={`chip ${source.kind}`}>{source.kind === 'pack' ? 'pack' : 'arena'}</span>
                  <span className="flag">{marked ? '✎' : ''}</span>
                </button>
              );
            })}
          </div>
        </aside>

        <main className="center">
          <ReviewStage initial={initialSceneData.current} onScene={setScene} />

          <div className="controls">
            <div className="row">
              <button className="btn" onClick={() => step(-1)} title="Previous move (↑ / k)">
                ◀ Prev
              </button>
              <button className="btn primary" onClick={replay} disabled={!stageReady} title="Play again (Space)">
                ▶ Play {selected ? selected.move.name : ''}
              </button>
              <button className="btn" onClick={() => step(1)} title="Next move (↓ / j)">
                Next ▶
              </button>
              <span className={`status${status.kind === 'error' ? ' error' : ''}`}>{statusText}</span>
            </div>
            <div className="row">
              <select value={prefs.options.speed} onChange={(e) => updateOptions({ speed: e.target.value as PlaybackSpeed })}>
                {(Object.keys(SPEED_LABELS) as PlaybackSpeed[]).map((speed) => (
                  <option key={speed} value={speed}>
                    {SPEED_LABELS[speed]}
                  </option>
                ))}
              </select>
              <button className={`btn toggle${prefs.options.sound ? ' active' : ''}`} onClick={() => updateOptions({ sound: !prefs.options.sound })}>
                {prefs.options.sound ? '🔊 Sound on' : '🔇 Sound off'}
              </button>
              <button className={`btn toggle${prefs.options.loop ? ' active' : ''}`} onClick={() => updateOptions({ loop: !prefs.options.loop })}>
                🔁 Loop
              </button>
              <button
                className={`btn toggle${prefs.options.miss ? ' active' : ''}`}
                onClick={() => updateOptions({ miss: !prefs.options.miss })}
                title="Play the miss version: the effect lands where the target stood and it dodges"
              >
                Miss
              </button>
              <button
                className={`btn toggle${prefs.options.autoplay ? ' active' : ''}`}
                onClick={() => updateOptions({ autoplay: !prefs.options.autoplay })}
                title="Play a move as soon as it's selected"
              >
                Autoplay
              </button>
            </div>
            <div className="row">
              <label>
                Attacker
                <select value={prefs.attackerSpeciesId} onChange={(e) => setPrefs({ ...prefs, attackerSpeciesId: Number(e.target.value) })}>
                  {species.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="btn"
                onClick={() => setPrefs({ ...prefs, attackerSpeciesId: prefs.targetSpeciesId, targetSpeciesId: prefs.attackerSpeciesId })}
                title="Swap attacker and target"
              >
                ⇄
              </button>
              <label>
                Target
                <select value={prefs.targetSpeciesId} onChange={(e) => setPrefs({ ...prefs, targetSpeciesId: Number(e.target.value) })}>
                  {species.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="slider">
                Distance {prefs.layout.distance}px
                <input
                  type="range"
                  min={80}
                  max={480}
                  step={10}
                  value={prefs.layout.distance}
                  onChange={(e) => updateLayout({ distance: Number(e.target.value) })}
                />
              </label>
              <label className="slider">
                Angle {prefs.layout.angleDeg}°
                <input
                  type="range"
                  min={-180}
                  max={180}
                  step={15}
                  value={prefs.layout.angleDeg}
                  onChange={(e) => updateLayout({ angleDeg: Number(e.target.value) })}
                />
              </label>
            </div>
            <div className="hint">
              <kbd>↑</kbd>/<kbd>↓</kbd> or <kbd>j</kbd>/<kbd>k</kbd> select · <kbd>Space</kbd> replay · <kbd>m</kbd> mark for change ·{' '}
              <kbd>n</kbd> write a note · <kbd>Esc</kbd> leave a field. Pokémon art comes from the sprite server (
              <code>npm run dev:all</code>); without it the fallback art is shown.
            </div>
          </div>
        </main>

        <aside className="details">
          {selected ? (
            <DetailsPanel
              entry={selected}
              mark={selectedMark}
              noteRef={noteRef}
              onToggleChange={toggleChange}
              onNoteChange={setNote}
            />
          ) : (
            <p>Select a move.</p>
          )}
        </aside>
      </div>
    </div>
  );
}

function describeStatus(status: ReviewStageStatus, byId: Map<number, ReviewMove>): string {
  const name = (moveId: number): string => byId.get(moveId)?.move.name ?? `move #${moveId}`;
  switch (status.kind) {
    case 'booting':
      return 'Starting the stage…';
    case 'idle':
      return 'Ready';
    case 'loading':
      return `Downloading ${name(status.moveId)}’s animation…`;
    case 'playing':
      return `Playing ${name(status.moveId)} · ${(status.durationMs / 1000).toFixed(1)}s`;
    case 'error':
      return `${name(status.moveId)}: ${status.message}`;
  }
}

interface DetailsPanelProps {
  entry: ReviewMove;
  mark: ReviewMarks[string] | undefined;
  noteRef: React.RefObject<HTMLTextAreaElement>;
  onToggleChange: () => void;
  onNoteChange: (note: string) => void;
}

function DetailsPanel({ entry, mark, noteRef, onToggleChange, onNoteChange }: DetailsPanelProps) {
  const { move, source, hasSound } = entry;
  const packEntry = source.kind === 'pack' ? source.entry : source.entry;
  const arenaFrameMs = packEntry ? frameDurationMs(packEntry.frames, POST_ATTACK_HOLD_MS) : 0;

  return (
    <>
      <div>
        <h2>{move.name}</h2>
        <div className="chips">
          <span className="chip type" style={{ background: typeHex(move.type) }}>
            {move.type}
          </span>
          <span className="chip">{move.category}</span>
          <span className="chip">{move.targeting === 'self' ? 'self-targeting' : move.targeting === 'enemy' ? 'single target' : 'spread'}</span>
          <span className="chip">#{move.id}</span>
        </div>
      </div>

      <section>
        <h3>Move</h3>
        <dl>
          <dt>Power</dt>
          <dd>{move.power ?? '—'}</dd>
          <dt>Accuracy</dt>
          <dd>{move.accuracy === null ? 'never misses' : `${move.accuracy}%`}</dd>
          <dt>Priority</dt>
          <dd>{move.priority}</dd>
          <dt>Sound</dt>
          <dd>{hasSound ? 'matched clip' : 'none in the SFX pack'}</dd>
        </dl>
      </section>

      <section>
        <h3>Animation in the arena</h3>
        {source.kind === 'pack' ? (
          <dl>
            <dt>Source</dt>
            <dd>
              <span className="chip pack">sprite pack</span>
            </dd>
            <dt>Pack anim</dt>
            <dd>{source.entry.anim}</dd>
            <dt>Sheet</dt>
            <dd>{source.entry.sheet ?? 'none (moves the battlers only)'}</dd>
            <dt>Frames</dt>
            <dd>
              {source.entry.frames} · {((source.entry.frames * arenaFrameMs) / 1000).toFixed(2)}s at arena speed
            </dd>
            <dt>Pose</dt>
            <dd>{source.entry.melee ? 'melee swing (dashes into the target)' : move.category === 'physical' ? 'melee swing' : 'ranged attack'}</dd>
          </dl>
        ) : (
          <dl>
            <dt>Source</dt>
            <dd>
              <span className="chip family">arena family</span> {source.family}
            </dd>
            <dt>Why</dt>
            <dd>
              {source.reason === 'screen-wide'
                ? `The pack’s ${source.entry?.anim ?? 'animation'} is a screen-wide effect, which doesn’t translate to the top-down arena, so the arena plays its own ${source.family} effect.`
                : `The pack has no animation for this move, so the arena plays its own ${source.family} effect.`}
            </dd>
          </dl>
        )}
        {packEntry?.sheet && (
          <div className="sheet" style={{ marginTop: 8 }} title={`public/move-anims/sheets/${packEntry.sheet}.png`}>
            <img src={`${animationSheetUrl(packEntry.sheet)}?v=${MOVE_ANIM_ASSET_VERSION}`} alt={`${packEntry.sheet} sheet`} loading="lazy" />
          </div>
        )}
      </section>

      <section>
        <h3>Review</h3>
        <button className={`btn mark${mark?.change ? ' active' : ''}`} onClick={onToggleChange} title="Toggle (m)">
          {mark?.change ? '✔ Marked for change' : 'Mark for change'}
        </button>
        <textarea
          ref={noteRef}
          style={{ marginTop: 8 }}
          value={mark?.note ?? ''}
          onChange={(e) => onNoteChange(e.target.value)}
          placeholder="What should change? e.g. too small, wrong color, use the arena bolt instead…"
        />
        {mark?.updatedAt && <div className="timestamp">Last edited {new Date(mark.updatedAt).toLocaleString()}</div>}
      </section>
    </>
  );
}
