import { useMemo, useState, type CSSProperties } from 'react';
import type { SelectableLevel } from '../../app/config';
import { ARENA_HEIGHT, ARENA_WIDTH, LEVEL_OPTIONS } from '../../app/config';
import { hasPmdSprite, listAllSpecies, pickRandomSpeciesIds } from '../../data/loader';
import type { MatchConfig } from '../../sim/types';
import { SpeciesPicker } from '../components/SpeciesPicker';

const PARTY_SIZE = 4;

interface BossModeScreenProps {
  onStart: (config: MatchConfig) => void;
  onBack: () => void;
}

export function BossModeScreen({ onStart, onBack }: BossModeScreenProps) {
  const [level, setLevel] = useState<SelectableLevel>(50);
  const [shiny, setShiny] = useState(false);
  const [partyIds, setPartyIds] = useState<number[]>(() => pickRandomSpeciesIds(PARTY_SIZE));
  const [bossId, setBossId] = useState<number>(() => pickRandomSpeciesIds(1, partyIds)[0]);

  const allSpecies = useMemo(() => listAllSpecies().filter((s) => hasPmdSprite(s.id)), []);
  const speciesById = useMemo(() => new Map(allSpecies.map((s) => [s.id, s])), [allSpecies]);

  const randomizeParty = () => {
    setPartyIds(pickRandomSpeciesIds(PARTY_SIZE, [bossId]));
  };

  const randomizeBoss = () => {
    const [next] = pickRandomSpeciesIds(1, partyIds);
    if (next !== undefined) setBossId(next);
  };

  const handleStart = () => {
    onStart({
      level,
      speciesIds: partyIds,
      arena: { width: ARENA_WIDTH, height: ARENA_HEIGHT },
      shiny,
      boss: { speciesId: bossId },
    });
  };

  return (
    <div style={containerStyle}>
      <div style={{ width: '100%', maxWidth: 420, display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={onBack} style={backButton}>
          ← BACK
        </button>
        <h1 style={{ fontSize: 16, letterSpacing: 1, margin: 0, flex: 1 }}>BOSS MODE</h1>
      </div>
      <p style={{ margin: '-12px 0 0', opacity: 0.7, fontSize: 12, textAlign: 'center' }}>
        {PARTY_SIZE} Pokémon team up against one massively amplified boss.
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
        <h2 style={sectionHeading}>Party ({PARTY_SIZE})</h2>
        <button onClick={randomizeParty} style={pillButton(false)}>
          🎲 Randomize
        </button>
        <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {partyIds.map((id) => (
            <span key={id} style={chip}>
              {speciesById.get(id)?.name ?? id}
            </span>
          ))}
        </div>
      </section>

      <section style={{ width: '100%', maxWidth: 420 }}>
        <h2 style={sectionHeading}>Boss</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span style={bossChip}>👹 {speciesById.get(bossId)?.name ?? bossId}</span>
          <button onClick={randomizeBoss} style={pillButton(false)}>
            🎲 Reroll
          </button>
        </div>
        <SpeciesPicker allSpecies={allSpecies} excludeSpeciesIds={partyIds} onPick={setBossId} />
      </section>

      <section style={{ width: '100%', maxWidth: 420 }}>
        <h2 style={sectionHeading}>Special</h2>
        <button onClick={() => setShiny((s) => !s)} style={shinyToggleButton(shiny)}>
          ✨ Shiny {shiny ? 'ON' : 'OFF'}
        </button>
      </section>

      <button onClick={handleStart} style={startButton}>
        START BATTLE
      </button>
    </div>
  );
}

const containerStyle: CSSProperties = {
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
};

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

const bossChip: CSSProperties = {
  fontSize: 11,
  textTransform: 'uppercase',
  fontWeight: 'bold',
  background: 'rgba(224,176,48,0.16)',
  border: '1px solid #e0b030',
  color: '#e0b030',
  borderRadius: 3,
  padding: '4px 9px',
};

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

const startButton: CSSProperties = {
  marginTop: 8,
  padding: '12px 32px',
  fontSize: 16,
  fontFamily: 'monospace',
  fontWeight: 'bold',
  letterSpacing: 1,
  color: '#20242c',
  background: '#e0b030',
  border: 'none',
  borderRadius: 6,
  cursor: 'pointer',
};
