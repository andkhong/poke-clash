import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { buildMoveCatalog, type ReviewMove } from './moveCatalog';
import {
  buildReviewExport,
  countMarked,
  isMarked,
  loadMarks,
  markStatus,
  marksToMarkdown,
  normalizeChanges,
  normalizeMarks,
  parseMarks,
  reviewFileMarkdown,
  saveMarks,
  serializeMarks,
  setMark,
  statusCounts,
  type AssetPreference,
  type MarkStatus,
  type MarkVerdict,
  type MoveMark,
  type ReviewChange,
  type ReviewChanges,
  type ReviewMarks,
} from './reviewStore';
import { fetchReviewFile, saveReviewFile } from './reviewSync';
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
/** How long after the last mark edit the repo file is written. */
const SAVE_DEBOUNCE_MS = 300;

/** Where the marks are, beyond this browser: in the repo through the dev
 * server's review-file endpoint (see reviewSync.ts), or nowhere. */
type SyncState =
  | { kind: 'checking' }
  | { kind: 'browser-only' }
  | { kind: 'saving' }
  | { kind: 'saved'; path: string; at: Date | null }
  | { kind: 'error'; message: string };

type SourceFilter = 'all' | 'pack' | 'family';
type MarkFilter = 'all' | 'marked' | 'unmarked' | MarkStatus;
/** 'unused': only the moves with a pack animation the arena doesn't play by
 * default (screen-wide, or set aside by the review) — see ReviewMove.alternative. */
type ListMode = 'all' | 'unused';
type PlaySource = 'pack' | 'arena';

const STATUS_GLYPH: Record<MarkStatus, string> = { open: '✎', proposed: '⇄', approved: '✔', 'changes-requested': '↩' };

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
  /** `adjustments` is chosen per play (Before/After), never remembered. */
  options: Omit<ReviewPlaybackOptions, 'adjustments'> & { loop: boolean; autoplay: boolean };
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

function matchesFilters(entry: ReviewMove, filters: Filters, marks: ReviewMarks, changes: ReviewChanges, query: string): boolean {
  const { move, source } = entry;
  if (filters.type !== 'all' && move.type !== filters.type) return false;
  if (filters.category !== 'all' && move.category !== filters.category) return false;
  if (filters.source !== 'all' && source.kind !== filters.source) return false;
  if (filters.mark !== 'all') {
    const mark = marks[String(move.id)];
    const marked = isMarked(mark);
    if (filters.mark === 'marked') {
      if (!marked) return false;
    } else if (filters.mark === 'unmarked') {
      if (marked) return false;
    } else if (!marked || markStatus(mark, changes[String(move.id)]) !== filters.mark) {
      return false;
    }
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
  /** What was done about marked moves (vfx-review/changes.json); read-only here. */
  const [changes, setChanges] = useState<ReviewChanges>({});
  const [filters, setFilters] = useState<Filters>({ query: '', type: 'all', category: 'all', source: 'all', mark: 'all' });
  const [listMode, setListMode] = useState<ListMode>('all');
  const [selectedId, setSelectedId] = useState<number>(() => catalog[0]?.move.id ?? 0);
  const [scene, setScene] = useState<ReviewScene | null>(null);
  const [status, setStatus] = useState<ReviewStageStatus>({ kind: 'booting' });
  const [toast, setToast] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [sync, setSync] = useState<SyncState>({ kind: 'checking' });
  /** True once the dev server's review file has been checked and can be
   * written; the autosave effect below stays off until then. */
  const [syncEnabled, setSyncEnabled] = useState(false);
  /** The marks (serialized) as last loaded from or saved to the repo file,
   * so a change is only written when it differs from what's on disk. */
  const syncedRef = useRef<string | null>(null);

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

  // The repo file, when the dev server is there, is the source of truth:
  // load it once on open. If it doesn't exist yet, whatever this browser
  // already holds becomes it (the autosave below writes it).
  const marksRef = useRef(marks);
  marksRef.current = marks;
  useEffect(() => {
    let cancelled = false;
    void fetchReviewFile()
      .then((file) => {
        if (cancelled) return;
        if (!file) {
          setSync({ kind: 'browser-only' });
          return;
        }
        if (file.changes !== null && file.changes !== undefined) {
          try {
            setChanges(normalizeChanges(file.changes));
          } catch (error) {
            setToast(`Could not read ${file.changesPath}: ${(error as Error).message}`);
          }
        }
        if (file.exists) {
          const fileMarks = normalizeMarks(file.export);
          syncedRef.current = JSON.stringify(fileMarks);
          setMarks(fileMarks);
        } else {
          syncedRef.current = countMarked(marksRef.current) === 0 ? JSON.stringify(marksRef.current) : null;
        }
        setSync({ kind: 'saved', path: file.path, at: null });
        setSyncEnabled(true);
      })
      .catch((error: Error) => {
        if (!cancelled) setSync({ kind: 'error', message: `could not read the review file: ${error.message}` });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!syncEnabled) return;
    const snapshot = JSON.stringify(marks);
    if (snapshot === syncedRef.current) return;
    setSync({ kind: 'saving' });
    const timer = window.setTimeout(() => {
      void saveReviewFile({ export: buildReviewExport(marks), markdown: reviewFileMarkdown(marks, catalog, { changes }) })
        .then((result) => {
          syncedRef.current = snapshot;
          setSync({ kind: 'saved', path: result.path, at: new Date(result.savedAt) });
        })
        .catch((error: Error) => setSync({ kind: 'error', message: `save failed: ${error.message}` }));
    }, SAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [syncEnabled, marks, catalog, changes]);

  // Stage wiring: status feed, fighters, layout.
  useEffect(() => scene?.subscribe(setStatus), [scene]);
  useEffect(() => scene?.setSpecies(prefs.attackerSpeciesId, prefs.targetSpeciesId), [scene, prefs.attackerSpeciesId, prefs.targetSpeciesId]);
  useEffect(() => scene?.setLayout(prefs.layout), [scene, prefs.layout]);

  const query = filters.query.trim().toLowerCase();
  const unusedCount = useMemo(() => catalog.filter((entry) => entry.alternative !== null).length, [catalog]);
  const filtered = useMemo(
    () =>
      catalog.filter(
        (entry) => (listMode === 'all' || entry.alternative !== null) && matchesFilters(entry, filters, marks, changes, query)
      ),
    [catalog, listMode, filters, marks, changes, query]
  );
  const selected = byId.get(selectedId) ?? null;
  const selectedMark = marks[String(selectedId)];
  const selectedChange = changes[String(selectedId)];
  const markedCount = useMemo(() => countMarked(marks), [marks]);
  const counts = useMemo(() => statusCounts(marks, changes), [marks, changes]);

  // Refs so the keyboard handler and stage callbacks never go stale.
  const sceneRef = useRef(scene);
  sceneRef.current = scene;
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const filteredRef = useRef(filtered);
  filteredRef.current = filtered;
  const optionsRef = useRef(prefs.options);
  optionsRef.current = prefs.options;

  /** `adjustments` false plays the move as it was before the review's
   * changes; `source` forces the pack animation or the arena's effect (see
   * ReviewPlaybackOptions). */
  const play = useCallback((moveId: number, adjustments = true, source?: PlaySource) => {
    const { speed, sound, miss } = optionsRef.current;
    void sceneRef.current?.playMove(moveId, { speed, sound, miss, adjustments, source });
  }, []);
  const replay = useCallback(() => play(selectedIdRef.current), [play]);
  const playBefore = useCallback(() => play(selectedIdRef.current, false), [play]);
  const playWithAssets = useCallback(() => play(selectedIdRef.current, true, 'pack'), [play]);
  const playArenaEffect = useCallback(() => play(selectedIdRef.current, true, 'arena'), [play]);

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
  const setVerdict = useCallback((verdict: MarkVerdict | undefined) => {
    setMarks((current) => setMark(current, selectedIdRef.current, { verdict }));
  }, []);
  const setFeedback = useCallback((feedback: string) => {
    setMarks((current) => setMark(current, selectedIdRef.current, { feedback }));
  }, []);
  const setPrefer = useCallback((prefer: AssetPreference | undefined) => {
    setMarks((current) => setMark(current, selectedIdRef.current, { prefer }));
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
        case 'a':
          replay();
          break;
        case 'b':
          playBefore();
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
  }, [step, replay, playBefore, toggleChange]);

  const updateOptions = (patch: Partial<ReviewPrefs['options']>): void =>
    setPrefs((current) => ({ ...current, options: { ...current.options, ...patch } }));
  const updateLayout = (patch: Partial<ReviewLayout>): void =>
    setPrefs((current) => ({ ...current, layout: { ...current.layout, ...patch } }));

  const copyMarkdown = async (): Promise<void> => {
    const markdown = marksToMarkdown(marks, catalog, { changes });
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
          <strong>{markedCount}</strong> marked
          {counts.proposed > 0 && (
            <>
              {' · '}
              <span className="to-review">{counts.proposed} to review</span>
            </>
          )}
          {counts.approved > 0 && ` · ${counts.approved} approved`}
          {counts['changes-requested'] > 0 && ` · ${counts['changes-requested']} changes requested`}
          {' · '}
          {catalog.length} moves
        </span>
        <span className={`sync${sync.kind === 'error' ? ' error' : ''}`} title={describeSyncDetail(sync)}>
          {describeSync(sync)}
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
          <div className="modes">
            <button className={`btn mode${listMode === 'all' ? ' active' : ''}`} onClick={() => setListMode('all')}>
              All moves
            </button>
            <button
              className={`btn mode${listMode === 'unused' ? ' active' : ''}`}
              onClick={() => setListMode('unused')}
              title="Moves the arena draws with its own effect although the pack ships an animation for them (or the other way round, where the review chose the pack) — compare both and pick"
            >
              Unused assets ({unusedCount})
            </button>
          </div>
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
                <option value="open">Open (nothing changed yet)</option>
                <option value="proposed">To review (change made)</option>
                <option value="approved">Approved</option>
                <option value="changes-requested">Changes requested</option>
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
              const mark = marks[String(move.id)];
              const marked = isMarked(mark);
              const status = markStatus(mark, changes[String(move.id)]);
              return (
                <button
                  key={move.id}
                  ref={(el) => {
                    if (el) rowRefs.current.set(move.id, el);
                    else rowRefs.current.delete(move.id);
                  }}
                  className={`move-row${move.id === selectedId ? ' selected' : ''}${marked ? ` marked ${status}` : ''}`}
                  onClick={() => setSelectedId(move.id)}
                >
                  <span className="chip type" style={{ background: typeHex(move.type) }}>
                    {move.type.slice(0, 3)}
                  </span>
                  <span className="name">{move.name}</span>
                  <span className="meta">{CATEGORY_SHORT[move.category]}</span>
                  <span className={`chip ${source.kind}`}>{source.kind === 'pack' ? 'pack' : 'arena'}</span>
                  <span className={`flag ${status}`}>{marked ? STATUS_GLYPH[status] : ''}</span>
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
              <kbd>↑</kbd>/<kbd>↓</kbd> or <kbd>j</kbd>/<kbd>k</kbd> select · <kbd>Space</kbd> replay · <kbd>b</kbd>/<kbd>a</kbd> play before/after a change ·{' '}
              <kbd>m</kbd> mark for change · <kbd>n</kbd> write a note · <kbd>Esc</kbd> leave a field. Pokémon art comes from the sprite server (
              <code>npm run dev:all</code>); without it the fallback art is shown.
            </div>
          </div>
        </main>

        <aside className="details">
          {selected ? (
            <DetailsPanel
              entry={selected}
              mark={selectedMark}
              change={selectedChange}
              stageReady={stageReady}
              noteRef={noteRef}
              onToggleChange={toggleChange}
              onNoteChange={setNote}
              onPlayBefore={playBefore}
              onPlayAfter={replay}
              onPlayWithAssets={playWithAssets}
              onPlayArenaEffect={playArenaEffect}
              onVerdict={setVerdict}
              onFeedbackChange={setFeedback}
              onPrefer={setPrefer}
            />
          ) : (
            <p>Select a move.</p>
          )}
        </aside>
      </div>
    </div>
  );
}

function describeSync(sync: SyncState): string {
  switch (sync.kind) {
    case 'checking':
      return 'Checking for the dev server…';
    case 'browser-only':
      return 'Browser only';
    case 'saving':
      return 'Saving…';
    case 'saved':
      return sync.at ? `Saved to ${sync.path} · ${sync.at.toLocaleTimeString()}` : `Loaded from ${sync.path}`;
    case 'error':
      return `Not saved: ${sync.message}`;
  }
}

function describeSyncDetail(sync: SyncState): string {
  switch (sync.kind) {
    case 'browser-only':
      return 'No dev server behind this page, so marks stay in this browser’s storage. Run `npm run dev` and open the page there to have them written into the repo, or use Download JSON.';
    case 'saved':
      return 'Every change is written to the repo: vfx-review/marks.json (what this page reloads) and vfx-review/REVIEW.md (the readable version to hand to a coding agent).';
    case 'error':
      return 'Marks are still kept in this browser; fix the file or restart the dev server, then reload.';
    default:
      return '';
  }
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
      return `Playing ${name(status.moveId)}${status.variant === 'before' ? ' · before the change' : ''} · ${(status.durationMs / 1000).toFixed(1)}s`;
    case 'error':
      return `${name(status.moveId)}: ${status.message}`;
  }
}

interface DetailsPanelProps {
  entry: ReviewMove;
  mark: MoveMark | undefined;
  change: ReviewChange | undefined;
  stageReady: boolean;
  noteRef: React.RefObject<HTMLTextAreaElement>;
  onToggleChange: () => void;
  onNoteChange: (note: string) => void;
  onPlayBefore: () => void;
  onPlayAfter: () => void;
  onPlayWithAssets: () => void;
  onPlayArenaEffect: () => void;
  onVerdict: (verdict: MarkVerdict | undefined) => void;
  onFeedbackChange: (feedback: string) => void;
  onPrefer: (prefer: AssetPreference | undefined) => void;
}

function DetailsPanel({
  entry,
  mark,
  change,
  stageReady,
  noteRef,
  onToggleChange,
  onNoteChange,
  onPlayBefore,
  onPlayAfter,
  onPlayWithAssets,
  onPlayArenaEffect,
  onVerdict,
  onFeedbackChange,
  onPrefer,
}: DetailsPanelProps) {
  const { move, source, hasSound, alternative } = entry;
  const packEntry = source.kind === 'pack' ? source.entry : source.entry;
  const arenaFrameMs = packEntry ? frameDurationMs(packEntry.frames, POST_ATTACK_HOLD_MS) : 0;
  const status = markStatus(mark, change);
  const packAnim = source.kind === 'pack' ? source.entry.anim : source.entry?.anim;
  const familyName = source.kind === 'family' ? source.family : alternative?.kind === 'family' ? alternative.family : null;

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

      {alternative && (
        <section className="unused">
          <h3>Unused assets</h3>
          <p>
            {source.kind === 'family'
              ? `The pack ships ${packAnim ?? 'an animation'} for this move, but the arena plays its own ${familyName} effect${
                  source.reason === 'screen-wide' ? ' because the pack’s is a screen-wide effect' : source.reason === 'review-preference' ? ' because the review asked for it' : ''
                }.`
              : `The arena plays the pack’s ${packAnim} because the review asked for it; its own effect would be ${familyName}.`}{' '}
            A screen-wide animation was drawn across a side-view battle screen, so it may or may not translate — compare both and pick.
          </p>
          <div className="ab">
            <button className="btn" onClick={onPlayWithAssets} disabled={!stageReady} title="Play the pack’s animation">
              ▶ With assets
            </button>
            <button className="btn" onClick={onPlayArenaEffect} disabled={!stageReady} title="Play the arena’s own effect">
              ▶ Arena effect
            </button>
          </div>
          <div className="ab">
            <button
              className={`btn toggle${mark?.prefer === 'pack' ? ' active' : ''}`}
              onClick={() => onPrefer(mark?.prefer === 'pack' ? undefined : 'pack')}
              title="Ask for the pack animation to be used in the arena"
            >
              {mark?.prefer === 'pack' ? '✔ Use the assets' : 'Use the assets'}
            </button>
            <button
              className={`btn toggle${mark?.prefer === 'arena' ? ' active' : ''}`}
              onClick={() => onPrefer(mark?.prefer === 'arena' ? undefined : 'arena')}
              title="Keep (or go back to) the arena’s own effect"
            >
              {mark?.prefer === 'arena' ? '✔ Keep the arena effect' : 'Keep the arena effect'}
            </button>
          </div>
          <p className="hint">Your pick is saved with the mark and shows in REVIEW.md’s Assets column; add details in the note below.</p>
        </section>
      )}

      {change && (
        <section className={`proposal ${status}`}>
          <h3>Change made</h3>
          <p className="summary">{change.summary}</p>
          {change.changedAt && <div className="timestamp">Changed {new Date(change.changedAt).toLocaleString()}</div>}
          <div className="ab">
            <button className="btn" onClick={onPlayBefore} disabled={!stageReady} title="Play it the way it was before the change (b)">
              ◀ Before
            </button>
            <button className="btn primary" onClick={onPlayAfter} disabled={!stageReady} title="Play it with the change (a / Space)">
              After ▶
            </button>
          </div>
          <div className={`verdict ${status}`}>
            {status === 'approved' && `✔ Approved${mark?.verdictAt ? ` · ${new Date(mark.verdictAt).toLocaleString()}` : ''}`}
            {status === 'changes-requested' && `↩ Changes requested${mark?.verdictAt ? ` · ${new Date(mark.verdictAt).toLocaleString()}` : ''}`}
            {status === 'proposed' && (mark?.verdict ? '⇄ Changed again since your last verdict — please re-check' : '⇄ Awaiting your verdict')}
          </div>
          <div className="ab">
            <button
              className={`btn approve${status === 'approved' ? ' active' : ''}`}
              onClick={() => onVerdict(status === 'approved' ? undefined : 'approved')}
              title={status === 'approved' ? 'Withdraw the approval' : 'Accept the change as is'}
            >
              {status === 'approved' ? 'Approved ✔ (undo)' : 'Approve'}
            </button>
            <button
              className={`btn toggle${status === 'changes-requested' ? ' active' : ''}`}
              onClick={() => onVerdict(status === 'changes-requested' ? undefined : 'changes-requested')}
              title={status === 'changes-requested' ? 'Withdraw the request' : 'Send it back with the notes below'}
            >
              {status === 'changes-requested' ? 'Requested ↩ (undo)' : 'Request changes'}
            </button>
          </div>
          <textarea
            className="feedback"
            value={mark?.feedback ?? ''}
            onChange={(e) => onFeedbackChange(e.target.value)}
            placeholder="Additional notes for the next pass — what still isn’t right?"
          />
        </section>
      )}

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
