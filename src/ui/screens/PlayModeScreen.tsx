import { useMemo, useState, type CSSProperties } from 'react';
import { IS_MOBILE_DEVICE, resolveMatchArena } from '../../app/config';
import { KANTO_IDS, PLAY_MODES, buildPlayMatchConfig, rollMoves, seatCount, type PlayModeKind } from '../../app/playMode';
import { listAllSpecies, moveLookup, pickRandomSpeciesIds } from '../../data/loader';
import type { MatchConfig, MoveDefinition } from '../../sim/types';
import { SpeciesPicker } from '../components/SpeciesPicker';
import { MoveCards } from '../components/MoveCards';
import { BG, PRIMARY, PRIMARY_TEXT, TEXT, TEXT_MUTED, primaryAlpha, textAlpha } from '../theme';

interface PlayModeScreenProps {
  onStart: (config: MatchConfig) => void;
  onBack: () => void;
}

export function PlayModeScreen({ onStart, onBack }: PlayModeScreenProps) {
  const allSpecies = useMemo(() => listAllSpecies().filter((s) => KANTO_IDS.includes(s.id)), []);
  const speciesById = useMemo(() => new Map(allSpecies.map((s) => [s.id, s])), [allSpecies]);
  const [mode, setMode] = useState<PlayModeKind>(1);
  const [speciesId, setSpeciesId] = useState<number>(() => pickRandomSpeciesIds(1, [], KANTO_IDS)[0]);
  const [moveIds, setMoveIds] = useState<number[]>(() => rollMoves(speciesId));

  const pick = (id: number) => {
    setSpeciesId(id);
    setMoveIds(rollMoves(id));
  };
  const moves = moveIds.map((id) => moveLookup(id)).filter((m): m is MoveDefinition => m !== undefined);

  return (
    <div style={containerStyle}>
      <div
        style={{
          width: '100%',
          maxWidth: 420,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <button onClick={onBack} style={backButton}>
          ← BACK
        </button>
        <h1 style={{ fontSize: 16, letterSpacing: 1, margin: 0, flex: 1 }}>PLAY MODE</h1>
      </div>
      <p
        style={{
          margin: '-12px 0 0',
          opacity: 0.7,
          fontSize: 12,
          textAlign: 'center',
        }}
      >
        You control one of the original 151. Bots fill every other seat. 3 lives each — last side standing wins.
      </p>

      <a href="#/play" style={onlineButton}>
        🌐 PLAY ONLINE — real players, bots fill the rest
      </a>

      <section style={sectionStyle}>
        <h2 style={sectionHeading}>Mode</h2>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {PLAY_MODES.map((m) => (
            <button key={m.label} onClick={() => setMode(m.value)} style={pillButton(mode === m.value)}>
              {m.label}
            </button>
          ))}
        </div>
      </section>

      <section style={sectionStyle}>
        <h2 style={sectionHeading}>Your Pokémon</h2>
        <div
          style={{
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            marginBottom: 8,
          }}
        >
          <span style={chosenChip}>{speciesById.get(speciesId)?.name ?? speciesId}</span>
          <button onClick={() => pick(pickRandomSpeciesIds(1, [speciesId], KANTO_IDS)[0])} style={pillButton(false)}>
            🎲 Random
          </button>
        </div>
        <SpeciesPicker allSpecies={allSpecies} excludeSpeciesIds={[speciesId]} onPick={pick} />
      </section>

      <section style={sectionStyle}>
        <h2 style={sectionHeading}>Moves</h2>
        <MoveCards moveIds={moveIds} />
        <button onClick={() => setMoveIds(rollMoves(speciesId))} style={{ ...pillButton(false), marginTop: 8 }}>
          🎲 Reroll moves
        </button>
      </section>

      <section
        style={{
          ...sectionStyle,
          fontSize: 11,
          color: TEXT_MUTED,
          lineHeight: 1.6,
        }}
      >
        <h2 style={sectionHeading}>Controls</h2>
        {IS_MOBILE_DEVICE ? (
          <>Left thumb moves. Tap a move to fire, or drag it to aim. DASH dodges through attacks. LOCK-ON aims for you.</>
        ) : (
          <>WASD move · mouse aims · click or 1–4 attack · Space dash · L lock-on · Tab switch target</>
        )}
      </section>

      <button
        onClick={() =>
          onStart(
            // Keyboard-and-mouse wants the wide arena; phones keep the portrait one.
            buildPlayMatchConfig(
              mode,
              Array.from({ length: seatCount(mode) }, (_, seat) => (seat === 0 ? { speciesId, moves: moveIds } : null)),
              resolveMatchArena(true)
            )
          )
        }
        disabled={moves.length === 0}
        style={startButton}
      >
        START
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
  color: TEXT,
  background: BG,
};

const sectionStyle: CSSProperties = { width: '100%', maxWidth: 420 };

const sectionHeading: CSSProperties = {
  fontSize: 12,
  textTransform: 'uppercase',
  letterSpacing: 1,
  opacity: 0.65,
  margin: '0 0 8px',
};

const backButton: CSSProperties = {
  fontSize: 11,
  fontFamily: 'monospace',
  padding: '5px 10px',
  borderRadius: 5,
  border: `1px solid ${textAlpha(0.2)}`,
  background: textAlpha(0.05),
  color: TEXT,
  cursor: 'pointer',
};

const chosenChip: CSSProperties = {
  fontSize: 13,
  fontWeight: 'bold',
  textTransform: 'uppercase',
  padding: '6px 12px',
  borderRadius: 6,
  border: `2px solid ${PRIMARY}`,
  background: primaryAlpha(0.12),
};

function pillButton(active: boolean): CSSProperties {
  return {
    fontSize: 12,
    fontFamily: 'monospace',
    padding: '6px 12px',
    borderRadius: 16,
    border: active ? `1px solid ${PRIMARY}` : `1px solid ${textAlpha(0.2)}`,
    background: active ? primaryAlpha(0.18) : textAlpha(0.05),
    color: active ? PRIMARY : TEXT_MUTED,
    cursor: 'pointer',
  };
}

const onlineButton: CSSProperties = {
  padding: '10px 18px',
  fontSize: 13,
  fontFamily: 'monospace',
  fontWeight: 'bold',
  color: PRIMARY,
  border: `2px solid ${PRIMARY}`,
  borderRadius: 6,
  textDecoration: 'none',
};

const startButton: CSSProperties = {
  marginTop: 8,
  padding: '12px 40px',
  fontSize: 16,
  fontFamily: 'monospace',
  fontWeight: 'bold',
  letterSpacing: 1,
  color: PRIMARY_TEXT,
  background: PRIMARY,
  border: 'none',
  borderRadius: 6,
  cursor: 'pointer',
};
