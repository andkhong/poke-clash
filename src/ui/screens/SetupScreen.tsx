import { useMemo, useState, type CSSProperties } from 'react';
import type { SelectableLevel } from '../../app/config';
import { DEFAULT_ROSTER_SIZE, LEVEL_OPTIONS, MAX_ROSTER_SIZE, getThemePresets } from '../../app/config';
import { listAllSpecies, pickRandomSpeciesIds } from '../../data/loader';
import type { MatchConfig } from '../../sim/types';
import { ARENA_HEIGHT, ARENA_WIDTH } from '../../app/config';

interface SetupScreenProps {
  onStart: (config: MatchConfig) => void;
}

export function SetupScreen({ onStart }: SetupScreenProps) {
  const [level, setLevel] = useState<SelectableLevel>(50);
  const [speciesIds, setSpeciesIds] = useState<number[]>(() => pickRandomSpeciesIds(DEFAULT_ROSTER_SIZE));
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [shiny, setShiny] = useState(false);

  const themePresets = useMemo(() => getThemePresets(), []);
  const speciesById = useMemo(() => new Map(listAllSpecies().map((s) => [s.id, s])), []);

  const randomize = () => {
    setSpeciesIds(pickRandomSpeciesIds(DEFAULT_ROSTER_SIZE));
    setActivePreset(null);
  };

  const applyPreset = (id: string, ids: number[]) => {
    setSpeciesIds(ids);
    setActivePreset(id);
  };

  const canStart = speciesIds.length >= 2;

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
      <h1 style={{ fontSize: 22, letterSpacing: 1, margin: '8px 0 0' }}>POKÉPIXEL ARENA</h1>
      <p style={{ margin: 0, opacity: 0.7, fontSize: 12, textAlign: 'center' }}>
        Up to {MAX_ROSTER_SIZE} Pokémon enter. One leaves.
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
        <h2 style={sectionHeading}>Roster</h2>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button onClick={randomize} style={pillButton(activePreset === null)}>
            🎲 Random {DEFAULT_ROSTER_SIZE}
          </button>
          {themePresets.map((preset) => (
            <button
              key={preset.id}
              onClick={() => applyPreset(preset.id, preset.speciesIds)}
              style={pillButton(activePreset === preset.id)}
              title={preset.description}
              disabled={preset.speciesIds.length === 0}
            >
              {preset.label}
            </button>
          ))}
        </div>

        <div
          style={{
            marginTop: 10,
            display: 'flex',
            flexWrap: 'wrap',
            gap: 4,
            maxHeight: 160,
            overflowY: 'auto',
          }}
        >
          {speciesIds.map((id) => (
            <span key={id} style={chip}>
              {speciesById.get(id)?.name ?? id}
            </span>
          ))}
        </div>
      </section>

      <section style={{ width: '100%', maxWidth: 420 }}>
        <h2 style={sectionHeading}>Special</h2>
        <button onClick={() => setShiny((s) => !s)} style={shinyToggleButton(shiny)}>
          ✨ Shiny {shiny ? 'ON' : 'OFF'}
        </button>
      </section>

      <button
        onClick={() =>
          onStart({ level, speciesIds, arena: { width: ARENA_WIDTH, height: ARENA_HEIGHT }, shiny })
        }
        disabled={!canStart}
        style={{
          marginTop: 8,
          padding: '12px 32px',
          fontSize: 16,
          fontFamily: 'monospace',
          fontWeight: 'bold',
          letterSpacing: 1,
          color: canStart ? '#20242c' : '#666',
          background: canStart ? '#e0b030' : '#3a3f4a',
          border: 'none',
          borderRadius: 6,
          cursor: canStart ? 'pointer' : 'not-allowed',
        }}
      >
        START BATTLE
      </button>
    </div>
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

// Matches SHINY_TINT_COLOR (#ffd700) in PokemonSprite.ts, so the toggle's own
// "on" look previews the gold recolor it turns on.
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
