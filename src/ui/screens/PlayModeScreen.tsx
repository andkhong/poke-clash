import { useMemo, useState } from 'react';
import { useIntl } from 'react-intl';
import { IS_MOBILE_DEVICE, resolveMatchArena } from '../../app/config';
import { PLAY_IDS, PLAY_MODES, buildPlayMatchConfig, rollMoves, seatCount, type PlayModeKind } from '../../app/playMode';
import { listAllSpecies, moveLookup, pickRandomSpeciesIds } from '../../data/loader';
import type { MatchConfig, MoveDefinition } from '../../sim/types';
import { SpeciesPicker } from '../components/SpeciesPicker';
import { MoveCards } from '../components/MoveCards';
import { SpeciesSprite } from '../components/SpeciesSprite';
import { hoennButton } from '../crowd/hoenn';
import { FONT_UI, INK_MUTED } from '../theme';
import { TopBar, bodyText, cardStyle, chosenPreview, columnStyle, headingStyle, pageStyle, pickerSection } from './playLayout';

interface PlayModeScreenProps {
  onStart: (config: MatchConfig) => void;
}

export function PlayModeScreen({ onStart }: PlayModeScreenProps) {
  const intl = useIntl();
  const allSpecies = useMemo(() => listAllSpecies().filter((s) => PLAY_IDS.includes(s.id)), []);
  const [mode, setMode] = useState<PlayModeKind>(1);
  const [speciesId, setSpeciesId] = useState<number>(() => pickRandomSpeciesIds(1, [], PLAY_IDS)[0]);
  const [moveIds, setMoveIds] = useState<number[]>(() => rollMoves(speciesId));

  const pick = (id: number) => {
    setSpeciesId(id);
    setMoveIds(rollMoves(id));
  };
  const speciesName = allSpecies.find((s) => s.id === speciesId)?.name ?? String(speciesId);
  const moves = moveIds.map((id) => moveLookup(id)).filter((m): m is MoveDefinition => m !== undefined);

  return (
    <div style={{ ...pageStyle, height: '100%', overflowY: 'auto' }}>
      <TopBar
        backHref="#/"
        title={intl.formatMessage({ id: 'playMode.title', defaultMessage: 'Play Mode' })}
        subtitle={intl.formatMessage({
          id: 'playMode.intro',
          defaultMessage:
            "You control one Pokémon from Gens 1–4. Bots fill every other seat. One KO and you're out — last side standing wins.",
        })}
      />
      <div style={columnStyle}>
        <a href="#/play" style={{ ...hoennButton('secondary'), alignSelf: 'flex-start' }}>
          {intl.formatMessage({
            id: 'playMode.playOnline',
            defaultMessage: '🌐 Play online — real players, bots fill the rest',
          })}
        </a>

        <section style={cardStyle}>
          <h2 style={headingStyle}>{intl.formatMessage({ id: 'playMode.mode', defaultMessage: 'Mode' })}</h2>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {PLAY_MODES.map((m) => (
              <button key={m.label} onClick={() => setMode(m.value)} aria-pressed={mode === m.value} style={hoennButton(mode === m.value ? 'primary' : 'secondary')}>
                {mode === m.value && <span aria-hidden>▶</span>}
                {m.label}
              </button>
            ))}
          </div>
        </section>

        <section style={pickerSection}>
          <h2 style={{ ...headingStyle, fontSize: 24 }}>{intl.formatMessage({ id: 'playMode.yourPokemon', defaultMessage: 'Your Pokémon' })}</h2>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={chosenPreview}>
              <SpeciesSprite speciesId={speciesId} size={96} animate name={speciesName} />
              <strong style={{ fontFamily: FONT_UI, fontSize: 24, textTransform: 'uppercase' }}>{speciesName}</strong>
            </div>
            <div style={{ flex: '1 1 320px', minWidth: 0 }}>
              <MoveCards moveIds={moveIds} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={() => pick(pickRandomSpeciesIds(1, [speciesId], PLAY_IDS)[0])} style={hoennButton('secondary')}>
              {intl.formatMessage({ id: 'playMode.random', defaultMessage: '🎲 Random' })}
            </button>
            <button onClick={() => setMoveIds(rollMoves(speciesId))} style={hoennButton('secondary')}>
              {intl.formatMessage({ id: 'playMode.rerollMoves', defaultMessage: '🎲 Reroll moves' })}
            </button>
          </div>
          <SpeciesPicker allSpecies={allSpecies} selectedSpeciesId={speciesId} onPick={pick} />
        </section>

        <section style={cardStyle}>
          <h2 style={headingStyle}>{intl.formatMessage({ id: 'playMode.controls', defaultMessage: 'Controls' })}</h2>
          <p style={{ ...bodyText, color: INK_MUTED }}>
            {IS_MOBILE_DEVICE
              ? intl.formatMessage({
                  id: 'playMode.controls.touch',
                  defaultMessage: 'Left thumb moves. Tap a move to fire, or drag it to aim. DASH dodges through attacks. LOCK-ON aims for you.',
                })
              : intl.formatMessage({
                  id: 'playMode.controls.keyboard',
                  defaultMessage: 'WASD move · mouse aims · click or 1–4 attack · Space dash · L lock-on · Tab switch target',
                })}
          </p>
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
          style={{ ...hoennButton('primary', moves.length > 0, 'lg'), alignSelf: 'center' }}
        >
          <span aria-hidden>▶</span>
          {intl.formatMessage({ id: 'playMode.start', defaultMessage: 'Start' })}
        </button>
      </div>
    </div>
  );
}
