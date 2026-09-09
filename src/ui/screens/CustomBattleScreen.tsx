import { useMemo, useState, type CSSProperties } from 'react';
import type { ArenaSizeId, SelectableLevel } from '../../app/config';
import { ARENA_SIZE_OPTIONS, LEVEL_OPTIONS } from '../../app/config';
import { buildSpeciesDataForLevel, getMoveDefinition, hasPmdSprite, listAllSpecies, type SpeciesSummary } from '../../data/loader';
import { getMoveTypeColor } from '../../render/vfx/typeColor';
import type { MatchConfig, MoveCategory } from '../../sim/types';

interface CustomBattleScreenProps {
  onStart: (config: MatchConfig) => void;
  onBack: () => void;
}

interface FighterConfig {
  speciesId: number | null;
  moveIds: number[];
  /** When set, this fighter always uses exactly this move — see
   * MatchConfig.forcedMoveId. Must be one of moveIds; cleared automatically
   * if that move is ever unchecked. */
  forcedMoveId?: number;
}

const MAX_MOVES = 4;
const MAX_SEARCH_RESULTS = 40;

const CATEGORY_LABEL: Record<MoveCategory, string> = { physical: 'PHY', special: 'SPE', status: 'STA' };

export function CustomBattleScreen({ onStart, onBack }: CustomBattleScreenProps) {
  const [level, setLevel] = useState<SelectableLevel>(50);
  const [shiny, setShiny] = useState(false);
  const [arenaSizeId, setArenaSizeId] = useState<ArenaSizeId>('standard');
  const [disableWander, setDisableWander] = useState(false);
  const [fighterA, setFighterA] = useState<FighterConfig>({ speciesId: null, moveIds: [] });
  const [fighterB, setFighterB] = useState<FighterConfig>({ speciesId: null, moveIds: [] });

  const allSpecies = useMemo(() => listAllSpecies().filter((s) => hasPmdSprite(s.id)), []);

  const canStart =
    fighterA.speciesId !== null && fighterA.moveIds.length > 0 && fighterB.speciesId !== null && fighterB.moveIds.length > 0;

  const handleStart = () => {
    if (!canStart || fighterA.speciesId === null || fighterB.speciesId === null) return;
    const arenaSize = ARENA_SIZE_OPTIONS.find((o) => o.id === arenaSizeId) ?? ARENA_SIZE_OPTIONS[0];
    const forcedMoveId: Record<number, number> = {};
    if (fighterA.forcedMoveId !== undefined) forcedMoveId[fighterA.speciesId] = fighterA.forcedMoveId;
    if (fighterB.forcedMoveId !== undefined) forcedMoveId[fighterB.speciesId] = fighterB.forcedMoveId;

    onStart({
      level,
      speciesIds: [fighterA.speciesId, fighterB.speciesId],
      arena: { width: arenaSize.width, height: arenaSize.height },
      shiny,
      customMoves: {
        [fighterA.speciesId]: fighterA.moveIds,
        [fighterB.speciesId]: fighterB.moveIds,
      },
      forcedMoveId,
      disableWander,
    });
  };

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 20,
        padding: 24,
        boxSizing: 'border-box',
        overflowY: 'auto',
        fontFamily: 'monospace',
        color: '#eee',
        background: '#20242c',
      }}
    >
      <div style={{ width: '100%', maxWidth: 420, display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={onBack} style={backButton}>
          ← BACK
        </button>
        <h1 style={{ fontSize: 16, letterSpacing: 1, margin: 0, flex: 1 }}>CUSTOM 1V1</h1>
      </div>
      <p style={{ margin: '-12px 0 0', opacity: 0.7, fontSize: 12, textAlign: 'center' }}>
        Pick 2 Pokémon and up to {MAX_MOVES} moves each from their real movepool.
      </p>

      <section style={{ width: '100%', maxWidth: 420 }}>
        <h2 style={sectionHeading}>Level</h2>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {LEVEL_OPTIONS.map((lvl) => (
            <button key={lvl} onClick={() => setLevel(lvl)} style={pillButton(level === lvl)}>
              Lv {lvl}
            </button>
          ))}
        </div>
      </section>

      <section style={{ width: '100%', maxWidth: 420 }}>
        <h2 style={sectionHeading}>Map Size</h2>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {ARENA_SIZE_OPTIONS.map((opt) => (
            <button key={opt.id} onClick={() => setArenaSizeId(opt.id)} style={pillButton(arenaSizeId === opt.id)}>
              {opt.label}
            </button>
          ))}
        </div>
        <p style={{ margin: '6px 0 0', fontSize: 10, opacity: 0.5 }}>Smaller maps put fighters in range faster — good for testing.</p>
      </section>

      <FighterPanel
        title="Fighter 1"
        level={level}
        allSpecies={allSpecies}
        excludeSpeciesId={fighterB.speciesId}
        fighter={fighterA}
        onChange={setFighterA}
      />
      <FighterPanel
        title="Fighter 2"
        level={level}
        allSpecies={allSpecies}
        excludeSpeciesId={fighterA.speciesId}
        fighter={fighterB}
        onChange={setFighterB}
      />

      <section style={{ width: '100%', maxWidth: 420 }}>
        <h2 style={sectionHeading}>Special</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={() => setShiny((s) => !s)} style={shinyToggleButton(shiny)}>
            ✨ Shiny {shiny ? 'ON' : 'OFF'}
          </button>
          <button onClick={() => setDisableWander((w) => !w)} style={shinyToggleButton(disableWander)}>
            🎯 Disable Wander {disableWander ? 'ON' : 'OFF'}
          </button>
        </div>
        <p style={{ margin: '6px 0 0', fontSize: 10, opacity: 0.5 }}>
          Fighters lock onto each other immediately and hold their ground between attacks instead of wandering off.
        </p>
      </section>

      <button onClick={handleStart} disabled={!canStart} style={startButton(canStart)}>
        START BATTLE
      </button>
    </div>
  );
}

interface FighterPanelProps {
  title: string;
  level: SelectableLevel;
  allSpecies: SpeciesSummary[];
  excludeSpeciesId: number | null;
  fighter: FighterConfig;
  onChange: (next: FighterConfig) => void;
}

function FighterPanel({ title, level, allSpecies, excludeSpeciesId, fighter, onChange }: FighterPanelProps) {
  const [query, setQuery] = useState('');

  const species = fighter.speciesId !== null ? allSpecies.find((s) => s.id === fighter.speciesId) : undefined;
  const speciesData = fighter.speciesId !== null ? buildSpeciesDataForLevel(fighter.speciesId, level) : undefined;
  const movePool = useMemo(() => {
    if (!speciesData) return [];
    return [...speciesData.movePool]
      .map((id) => getMoveDefinition(id))
      .filter((m): m is NonNullable<typeof m> => m !== undefined)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [speciesData]);

  const results = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.trim().toLowerCase();
    return allSpecies.filter((s) => s.id !== excludeSpeciesId && s.name.toLowerCase().includes(q)).slice(0, MAX_SEARCH_RESULTS);
  }, [allSpecies, query, excludeSpeciesId]);

  const pickSpecies = (id: number) => {
    onChange({ speciesId: id, moveIds: [] });
    setQuery('');
  };

  const toggleMove = (moveId: number) => {
    const has = fighter.moveIds.includes(moveId);
    if (has) {
      // Unchecking the pinned move clears the pin too — a forced move that
      // isn't even in the moveset anymore makes no sense to keep around.
      const forcedMoveId = fighter.forcedMoveId === moveId ? undefined : fighter.forcedMoveId;
      onChange({ ...fighter, moveIds: fighter.moveIds.filter((id) => id !== moveId), forcedMoveId });
    } else if (fighter.moveIds.length < MAX_MOVES) {
      onChange({ ...fighter, moveIds: [...fighter.moveIds, moveId] });
    }
  };

  /** Toggles which single equipped move this fighter always uses — see
   * FighterConfig.forcedMoveId. Clicking the already-pinned move unpins it
   * (back to the normal random pick); clicking another re-pins to that one. */
  const setForcedMove = (moveId: number) => {
    onChange({ ...fighter, forcedMoveId: fighter.forcedMoveId === moveId ? undefined : moveId });
  };

  return (
    <section style={{ width: '100%', maxWidth: 420 }}>
      <h2 style={sectionHeading}>{title}</h2>

      {species ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span style={chip}>{species.name}</span>
          <span style={{ fontSize: 10, opacity: 0.6 }}>
            {fighter.moveIds.length}/{MAX_MOVES} moves selected
          </span>
          <button onClick={() => onChange({ speciesId: null, moveIds: [] })} style={changeButton}>
            change
          </button>
        </div>
      ) : (
        <>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search a Pokémon…"
            style={searchInput}
          />
          {results.length > 0 && (
            <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4, maxHeight: 140, overflowY: 'auto' }}>
              {results.map((s) => (
                <button key={s.id} onClick={() => pickSpecies(s.id)} style={pillButton(false)}>
                  {s.name}
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {species && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 240, overflowY: 'auto' }}>
          {movePool.map((move) => {
            const checked = fighter.moveIds.includes(move.id);
            const disabled = !checked && fighter.moveIds.length >= MAX_MOVES;
            const forced = fighter.forcedMoveId === move.id;
            return (
              <div key={move.id} style={moveRowContainer(checked, disabled)}>
                <button onClick={() => toggleMove(move.id)} disabled={disabled} style={moveRowButton(disabled)}>
                  <span style={{ ...typeTag, background: `#${getMoveTypeColor(move.type).toString(16).padStart(6, '0')}` }}>
                    {move.type.slice(0, 3).toUpperCase()}
                  </span>
                  <span style={{ flex: 1, textAlign: 'left' }}>{move.name.toUpperCase()}</span>
                  <span style={{ fontSize: 9, opacity: 0.6 }}>{CATEGORY_LABEL[move.category]}</span>
                  <span style={{ fontSize: 9, opacity: 0.6, width: 24, textAlign: 'right' }}>{move.power ?? '—'}</span>
                </button>
                {checked && (
                  <button
                    onClick={() => setForcedMove(move.id)}
                    style={forcePinButton(forced)}
                    title="Always use this move — for testing one move's VFX/interaction"
                  >
                    {forced ? '🎯 FORCED' : 'FORCE'}
                  </button>
                )}
              </div>
            );
          })}
          {movePool.length === 0 && <p style={{ fontSize: 11, opacity: 0.5 }}>No moves found at this level.</p>}
        </div>
      )}
    </section>
  );
}

const sectionHeading: CSSProperties = {
  fontSize: 12,
  textTransform: 'uppercase',
  letterSpacing: 1,
  opacity: 0.65,
  margin: '0 0 8px',
};

const chip: CSSProperties = {
  fontSize: 10,
  textTransform: 'uppercase',
  background: 'rgba(255,255,255,0.08)',
  border: '1px solid rgba(255,255,255,0.15)',
  borderRadius: 3,
  padding: '3px 7px',
};

function pillButton(active: boolean): CSSProperties {
  return {
    fontSize: 12,
    fontFamily: 'monospace',
    padding: '6px 12px',
    borderRadius: 16,
    border: active ? '1px solid #e0b030' : '1px solid rgba(255,255,255,0.2)',
    background: active ? 'rgba(224,176,48,0.18)' : 'rgba(255,255,255,0.05)',
    color: active ? '#e0b030' : '#ddd',
    cursor: 'pointer',
  };
}

function shinyToggleButton(active: boolean): CSSProperties {
  return {
    fontSize: 12,
    fontFamily: 'monospace',
    fontWeight: 'bold',
    padding: '6px 14px',
    borderRadius: 16,
    border: active ? '1px solid #ffd700' : '1px solid rgba(255,255,255,0.2)',
    background: active ? 'rgba(255,215,0,0.22)' : 'rgba(255,255,255,0.05)',
    color: active ? '#ffd700' : '#ddd',
    cursor: 'pointer',
  };
}

function startButton(enabled: boolean): CSSProperties {
  return {
    marginTop: 8,
    padding: '12px 32px',
    fontSize: 16,
    fontFamily: 'monospace',
    fontWeight: 'bold',
    letterSpacing: 1,
    color: enabled ? '#20242c' : '#666',
    background: enabled ? '#e0b030' : '#3a3f4a',
    border: 'none',
    borderRadius: 6,
    cursor: enabled ? 'pointer' : 'not-allowed',
  };
}

const backButton: CSSProperties = {
  fontSize: 11,
  fontFamily: 'monospace',
  padding: '5px 10px',
  borderRadius: 5,
  border: '1px solid rgba(255,255,255,0.2)',
  background: 'rgba(255,255,255,0.05)',
  color: '#ddd',
  cursor: 'pointer',
};

const changeButton: CSSProperties = {
  fontSize: 10,
  fontFamily: 'monospace',
  padding: '3px 8px',
  borderRadius: 4,
  border: '1px solid rgba(255,255,255,0.2)',
  background: 'transparent',
  color: '#aaa',
  cursor: 'pointer',
};

const searchInput: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  fontSize: 13,
  fontFamily: 'monospace',
  padding: '8px 10px',
  borderRadius: 6,
  border: '1px solid rgba(255,255,255,0.2)',
  background: 'rgba(255,255,255,0.05)',
  color: '#eee',
  outline: 'none',
};

const typeTag: CSSProperties = {
  fontSize: 8,
  fontWeight: 'bold',
  color: '#1a1a1a',
  borderRadius: 3,
  padding: '2px 4px',
  minWidth: 26,
  textAlign: 'center',
};

function moveRowContainer(checked: boolean, disabled: boolean): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    paddingRight: 6,
    borderRadius: 5,
    border: checked ? '1px solid #e0b030' : '1px solid rgba(255,255,255,0.12)',
    background: checked ? 'rgba(224,176,48,0.16)' : 'rgba(255,255,255,0.04)',
    opacity: disabled ? 0.5 : 1,
  };
}

function moveRowButton(disabled: boolean): CSSProperties {
  return {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 11,
    fontFamily: 'monospace',
    padding: '6px 10px',
    border: 'none',
    background: 'transparent',
    color: disabled ? '#666' : '#ddd',
    cursor: disabled ? 'not-allowed' : 'pointer',
  };
}

/** Distinct red "target lock" color scheme (vs. the gold used for
 * checked/selected elsewhere on this screen) so a forced move reads as a
 * different kind of toggle — pinning which move fires, not just whether it's
 * in the pool at all. */
function forcePinButton(active: boolean): CSSProperties {
  return {
    fontSize: 9,
    fontFamily: 'monospace',
    fontWeight: 'bold',
    padding: '3px 7px',
    borderRadius: 10,
    border: active ? '1px solid #ff5050' : '1px solid rgba(255,255,255,0.2)',
    background: active ? 'rgba(255,80,80,0.22)' : 'rgba(255,255,255,0.05)',
    color: active ? '#ff5050' : '#888',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  };
}
