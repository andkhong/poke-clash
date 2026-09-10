import { useMemo, useState, type CSSProperties } from 'react';
import type { SelectableLevel, TeamSize } from '../../app/config';
import { IS_MOBILE_DEVICE, LEVEL_OPTIONS, TEAM_SIZE_OPTIONS, resolveMatchArena } from '../../app/config';
import { hasPmdSprite, listAllSpecies, pickRandomSpeciesIds } from '../../data/loader';
import type { MatchConfig } from '../../sim/types';
import { TEAM_A_COLOR_CSS, TEAM_B_COLOR_CSS } from '../teamColors';
import { useWideArenaPreference } from '../hooks/useWideArenaPreference';

interface TeamModeScreenProps {
  onStart: (config: MatchConfig) => void;
  onBack: () => void;
}

const DEFAULT_TEAM_SIZE: TeamSize = TEAM_SIZE_OPTIONS[0];

export function TeamModeScreen({ onStart, onBack }: TeamModeScreenProps) {
  const [level, setLevel] = useState<SelectableLevel>(50);
  const [teamSize, setTeamSize] = useState<TeamSize>(DEFAULT_TEAM_SIZE);
  const [shiny, setShiny] = useState(false);
  const [wideArena, setWideArena] = useWideArenaPreference();
  const [teamA, setTeamA] = useState<number[]>(() => pickRandomSpeciesIds(DEFAULT_TEAM_SIZE));
  const [teamB, setTeamB] = useState<number[]>(() => pickRandomSpeciesIds(DEFAULT_TEAM_SIZE, teamA));

  const allSpecies = useMemo(() => listAllSpecies().filter((s) => hasPmdSprite(s.id)), []);
  const speciesById = useMemo(() => new Map(allSpecies.map((s) => [s.id, s])), [allSpecies]);

  const changeTeamSize = (size: TeamSize) => {
    setTeamSize(size);
    // Rosters are re-rolled from scratch rather than resized in place — a
    // partial resize (truncate/pad) would leave stale hand-picked-feeling
    // leftovers from the old size with no clear rule for which to keep.
    const nextA = pickRandomSpeciesIds(size);
    setTeamA(nextA);
    setTeamB(pickRandomSpeciesIds(size, nextA));
  };

  const randomizeTeamA = () => setTeamA(pickRandomSpeciesIds(teamSize, teamB));
  const randomizeTeamB = () => setTeamB(pickRandomSpeciesIds(teamSize, teamA));

  const handleStart = () => {
    onStart({
      level,
      speciesIds: [...teamA, ...teamB],
      arena: resolveMatchArena(wideArena),
      shiny,
      teams: { size: teamSize },
    });
  };

  const canStart = teamA.length === teamSize && teamB.length === teamSize;

  return (
    <div style={containerStyle}>
      <div style={{ width: '100%', maxWidth: 420, display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={onBack} style={backButton}>
          ← BACK
        </button>
        <h1 style={{ fontSize: 16, letterSpacing: 1, margin: 0, flex: 1 }}>TEAM MODE</h1>
      </div>
      <p style={{ margin: '-12px 0 0', opacity: 0.7, fontSize: 12, textAlign: 'center' }}>
        Two teams of {teamSize} — teammates never fight each other. Last team standing wins.
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
        <h2 style={sectionHeading}>Team Size</h2>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {TEAM_SIZE_OPTIONS.map((size) => (
            <button key={size} onClick={() => changeTeamSize(size)} style={pillButton(teamSize === size)}>
              {size}v{size}
            </button>
          ))}
        </div>
      </section>

      <section style={{ width: '100%', maxWidth: 420, display: 'flex', gap: 12 }}>
        <TeamColumn
          label="Team A"
          color={TEAM_A_COLOR_CSS}
          speciesIds={teamA}
          speciesById={speciesById}
          onRandomize={randomizeTeamA}
        />
        <TeamColumn
          label="Team B"
          color={TEAM_B_COLOR_CSS}
          speciesIds={teamB}
          speciesById={speciesById}
          onRandomize={randomizeTeamB}
        />
      </section>

      <section style={{ width: '100%', maxWidth: 420 }}>
        <h2 style={sectionHeading}>Special</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={() => setShiny((s) => !s)} style={shinyToggleButton(shiny)}>
            ✨ Shiny {shiny ? 'ON' : 'OFF'}
          </button>
          {!IS_MOBILE_DEVICE && (
            <button onClick={() => setWideArena(!wideArena)} style={shinyToggleButton(wideArena)}>
              🖥️ Wide Arena {wideArena ? 'ON' : 'OFF'}
            </button>
          )}
        </div>
      </section>

      <button onClick={handleStart} disabled={!canStart} style={startButton(canStart)}>
        START BATTLE
      </button>
    </div>
  );
}

function TeamColumn({
  label,
  color,
  speciesIds,
  speciesById,
  onRandomize,
}: {
  label: string;
  color: string;
  speciesIds: number[];
  speciesById: Map<number, { id: number; name: string }>;
  onRandomize: () => void;
}) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <h2 style={{ ...sectionHeading, color }}>{label}</h2>
      <button onClick={onRandomize} style={pillButton(false)}>
        🎲 Randomize
      </button>
      <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {speciesIds.map((id) => (
          <span key={id} style={chip(color)}>
            {speciesById.get(id)?.name ?? id}
          </span>
        ))}
      </div>
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

function chip(color: string): CSSProperties {
  return {
    fontSize: 10,
    textTransform: 'uppercase',
    background: 'rgba(255,255,255,0.08)',
    border: `1px solid ${color}`,
    borderRadius: 3,
    padding: '3px 7px',
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
