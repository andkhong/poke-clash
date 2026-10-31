import { useMemo, useState, type CSSProperties } from 'react';
import { IS_MOBILE_DEVICE, resolveMatchArena } from '../../app/config';
import { KANTO_IDS, PLAY_MODES, buildPlayMatchConfig, rollMoves, seatCount, type PlayModeKind } from '../../app/playMode';
import { listAllSpecies, moveLookup, pickRandomSpeciesIds } from '../../data/loader';
import type { MatchConfig, MoveDefinition } from '../../sim/types';
import { SpeciesPicker } from '../components/SpeciesPicker';
import { MoveCards } from '../components/MoveCards';
import { ACTION, ACTION_BEVEL, FONT_BODY, FONT_UI, FRAME, GROUND, INFO_BOX, INK, INK_MUTED, OUTLINE, PANEL, SUNK } from '../theme';

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
        <button onClick={onBack} style={backButton} aria-label="Back">
          ←
        </button>
        <h1 style={{ fontFamily: FONT_UI, fontWeight: 700, fontSize: 32, margin: 0, flex: 1 }}>Play Mode</h1>
      </div>
      <p
        style={{
          margin: '-8px 0 0',
          maxWidth: 420,
          color: INK_MUTED,
          fontSize: 15,
          lineHeight: 1.5,
        }}
      >
        You control one of the original 151. Bots fill every other seat. 3 lives each — last side standing wins.
      </p>

      <a href="#/play" style={onlineButton}>
        🌐 Play online — real players, bots fill the rest
      </a>

      <section style={sectionStyle}>
        <h2 style={sectionHeading}>Mode</h2>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {PLAY_MODES.map((m) => (
            <button key={m.label} onClick={() => setMode(m.value)} aria-pressed={mode === m.value} style={pillButton(mode === m.value)}>
              {mode === m.value && <span aria-hidden>▶ </span>}
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
          fontSize: 15,
          color: INK_MUTED,
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
        <span aria-hidden>▶ </span>Start
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
  gap: 16,
  padding: 24,
  boxSizing: 'border-box',
  overflowY: 'auto',
  fontFamily: FONT_BODY,
  color: INK,
  background: GROUND,
};

// The Lobby artboard's picker panel: white message box, ink outline, teal trim.
const sectionStyle: CSSProperties = {
  width: '100%',
  maxWidth: 420,
  boxSizing: 'border-box',
  padding: 16,
  background: PANEL,
  border: OUTLINE,
  borderRadius: 8,
  boxShadow: `inset 0 0 0 3px ${PANEL}, inset 0 0 0 6px ${FRAME}`,
};

const sectionHeading: CSSProperties = {
  fontFamily: FONT_UI,
  fontSize: 24,
  fontWeight: 700,
  margin: '0 0 10px',
};

const backButton: CSSProperties = {
  width: 46,
  height: 46,
  flex: 'none',
  fontSize: 22,
  fontFamily: FONT_UI,
  fontWeight: 700,
  borderRadius: 8,
  border: OUTLINE,
  background: PANEL,
  color: INK,
  cursor: 'pointer',
};

const chosenChip: CSSProperties = {
  minHeight: 44,
  display: 'inline-flex',
  alignItems: 'center',
  fontFamily: FONT_UI,
  fontSize: 22,
  fontWeight: 700,
  textTransform: 'uppercase',
  padding: '0 12px',
  borderRadius: 8,
  border: OUTLINE,
  background: INFO_BOX,
};

function pillButton(active: boolean): CSSProperties {
  return {
    minHeight: 46,
    padding: '0 14px',
    fontSize: 18,
    fontFamily: FONT_UI,
    fontWeight: active ? 700 : 600,
    borderRadius: 8,
    border: OUTLINE,
    background: active ? ACTION : PANEL,
    color: INK,
    boxShadow: `inset 0 -4px 0 ${active ? ACTION_BEVEL : SUNK}`,
    cursor: 'pointer',
  };
}

const onlineButton: CSSProperties = {
  minHeight: 50,
  display: 'inline-flex',
  alignItems: 'center',
  padding: '0 20px',
  fontSize: 20,
  fontFamily: FONT_UI,
  fontWeight: 600,
  color: INK,
  background: PANEL,
  border: OUTLINE,
  borderRadius: 8,
  boxShadow: `inset 0 -4px 0 ${SUNK}`,
  textDecoration: 'none',
};

const startButton: CSSProperties = {
  marginTop: 8,
  minHeight: 58,
  padding: '0 40px',
  fontSize: 26,
  fontFamily: FONT_UI,
  fontWeight: 700,
  color: INK,
  background: ACTION,
  border: OUTLINE,
  borderRadius: 8,
  boxShadow: `inset 0 -5px 0 ${ACTION_BEVEL}`,
  cursor: 'pointer',
};
