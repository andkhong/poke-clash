import { defineMessages, useIntl, type IntlShape } from 'react-intl';
import { lazy, memo, Suspense, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import type { StageRect } from '../../render/PhaserGame';
import type { ActionEngine } from '../../sim/action/ActionEngine';
import type { PlayerController } from '../../sim/action/playerController';
import { ACTION_MATCH_LIMIT_MS, DASH_CHARGES, DASH_RECHARGE_MS, ENERGY_MAX, moveCooldownMs, moveEnergyCost } from '../../sim/action/rules';
import { isMobileArena } from '../../sim/constants';
import { stadiumViewHeight } from '../../render/tileset/stadiumLayout';
import type { MoveDefinition, SimState } from '../../sim/types';
import type { CrowdSide } from '../../net/play/playProtocol';
import { IS_MOBILE_DEVICE } from '../../app/config';
import { saveLockOn } from '../playModeSettings';
import { useSimSnapshot } from '../hooks/useSimSnapshot';
import type { SimStore } from '../state/simStore';
import { TEAM_A_COLOR_CSS, TEAM_B_COLOR_CSS, teamColorCss } from '../teamColors';
import { typeColorCss, typeTextCss } from '../typeColorCss';
import {
  ACTION,
  COOLDOWN,
  CROWD,
  ENERGY,
  FONT_BODY,
  FONT_PIXEL,
  FONT_UI,
  GROUND,
  HP_GREEN,
  HP_RED,
  HP_YELLOW,
  INFO_BOX,
  INK,
  INK_MUTED,
  PANEL,
  RUBY,
  STAGE_BG,
  primaryAlpha,
} from '../theme';
import { CrowdCallBanner } from '../crowd/CrowdCallBanner';
import { CrowdCallsTimeline } from '../crowd/CrowdCallsTimeline';
import { isCrowdSide, type CrowdCallsStore } from '../crowd/crowdModel';
import { barFill, barTrack, chip, hoennButton, messageBox, teamMarker } from '../crowd/hoenn';

// Memoized: its props are stable for a match, so the 10 Hz HUD tick skips it.
const PhaserGame = lazy(() => import('../../render/PhaserGame').then((m) => ({ default: memo(m.PhaserGame) })));

const M = defineMessages({
  playAgain: { id: 'match.hud.playAgain', defaultMessage: 'PLAY AGAIN' },
  back: { id: 'match.hud.back', defaultMessage: 'BACK' },
  quit: { id: 'match.hud.quit', defaultMessage: 'QUIT' },
  dash: { id: 'match.hud.dash', defaultMessage: 'DASH' },
  lockOn: { id: 'match.hud.lockOn', defaultMessage: 'LOCK-ON' },
  freeAim: { id: 'match.hud.freeAim', defaultMessage: 'FREE AIM' },
  target: { id: 'match.hud.target', defaultMessage: 'target' },
  hp: { id: 'match.hud.hp', defaultMessage: 'HP', description: 'Hit points, abbreviated bar label' },
  energy: { id: 'match.hud.energy', defaultMessage: 'EN', description: 'Energy, abbreviated bar label' },
  energyCost: { id: 'match.hud.energyCost', defaultMessage: '{cost} EN', description: 'Energy cost of a move' },
  needEnergy: { id: 'match.hud.needEnergy', defaultMessage: 'Need energy' },
  cooldownSeconds: { id: 'match.hud.cooldownSeconds', defaultMessage: '{seconds} s' },
  dashesLeft: { id: 'match.hud.dashesLeft', defaultMessage: '{count, plural, one {# dash} other {# dashes}}' },
  speedBurst: { id: 'match.hud.speedBurst', defaultMessage: 'Speed Burst' },
  speedTag: { id: 'match.hud.speedTag', defaultMessage: 'SPD', description: 'Short badge for the Speed Burst buff' },
  shield: { id: 'match.hud.shield', defaultMessage: 'Shield' },
  shieldTag: { id: 'match.hud.shieldTag', defaultMessage: 'SHD', description: 'Short badge for the Shield buff' },
  freeForAll: { id: 'match.hud.brawl', defaultMessage: 'BRAWL' },
  koCount: { id: 'match.hud.koCount', defaultMessage: '{count} KO', description: 'Knock-out count' },
  out: { id: 'match.hud.out', defaultMessage: 'OUT', description: 'Fighter has been knocked out' },
  you: { id: 'match.hud.you', defaultMessage: '(you)' },
  getReady: { id: 'match.banner.getReady', defaultMessage: 'GET READY' },
  fainted: { id: 'match.banner.fainted', defaultMessage: 'FAINTED' },
  faintedTeam: {
    id: 'match.banner.faintedTeam',
    defaultMessage: 'You’re out — your team can still win (or a Revive from the crowd)',
  },
  faintedSolo: { id: 'match.banner.faintedSolo', defaultMessage: 'You’re out — a Revive from the crowd could bring you back' },
  dragToMove: { id: 'match.touch.dragToMove', defaultMessage: 'drag to move' },
  teamRuby: { id: 'match.team.ruby', defaultMessage: 'Ruby' },
  teamSapphire: { id: 'match.team.sapphire', defaultMessage: 'Sapphire' },
  teamHeader: { id: 'match.hud.teamHeader', defaultMessage: 'TEAM {team}' },
  chipRuby: { id: 'match.hud.chipRuby', defaultMessage: 'RUBY {count}' },
  chipSapphire: { id: 'match.hud.chipSapphire', defaultMessage: '{count} SAPPHIRE' },
  teamLeft: { id: 'match.hud.teamLeft', defaultMessage: '{standing}/{total} left' },
  draw: { id: 'match.results.draw', defaultMessage: 'Draw!' },
  yourTeamWins: { id: 'match.results.yourTeamWins', defaultMessage: 'Your team wins!' },
  youWin: { id: 'match.results.youWin', defaultMessage: 'You win!' },
  teamWins: { id: 'match.results.teamWins', defaultMessage: 'Team {team} wins!' },
  youLost: { id: 'match.results.youLost', defaultMessage: 'You lost. {winner} wins.' },
  teamLabel: { id: 'match.results.teamLabel', defaultMessage: 'Team {team}' },
  nameWins: { id: 'match.results.nameWins', defaultMessage: '{name} wins!' },
  standing: { id: 'match.results.standing', defaultMessage: '{teamA} {countA} standing · {teamB} {countB}' },
  fighters: { id: 'match.results.fighters', defaultMessage: 'Fighters' },
  colPokemon: { id: 'match.results.colPokemon', defaultMessage: 'POKÉMON' },
  colKo: { id: 'match.results.colKo', defaultMessage: 'KO', description: 'Column header: knock-outs' },
  colDamage: { id: 'match.results.colDamage', defaultMessage: 'DMG', description: 'Column header: damage dealt' },
  colOut: { id: 'match.results.colOut', defaultMessage: 'OUT', description: 'Column header: fighter is out' },
  yourBet: { id: 'match.results.yourBet', defaultMessage: 'Your bet' },
  nextMatchIn: { id: 'match.results.nextMatchIn', defaultMessage: 'Next match in {seconds}s' },
  nextMatchStarting: { id: 'match.results.nextMatchStarting', defaultMessage: 'Next match starting…' },
});

const JOYSTICK_RADIUS = 56;
const DRAG_AIM_THRESHOLD = 18;
/** Below this stage width the HUD stacks at the top (phones, narrow windows). */
const STACKED_MAX_WIDTH = 760;

export interface ActionMatchCrowd {
  /** The online match's Crowd Calls (read on every HUD tick). */
  calls: CrowdCallsStore;
  /** A viewer's locked side; fighters use their own team. */
  side: CrowdSide | null;
  /** Results: this viewer's bet outcome, one line. */
  betResult?: string | null;
}

interface ActionMatchScreenProps {
  store: SimStore;
  engine: ActionEngine;
  /** Null for a spectator watching an online match: no controls or personal HUD. */
  controller: PlayerController | null;
  onPlayAgain: () => void;
  onExit: () => void;
  /** Online: each human fighter's player name, shown in the results. */
  names?: Record<string, string>;
  playAgainLabel?: string;
  exitLabel?: string;
  /** Online: a small connection readout (ping), refreshed with the HUD. */
  netInfo?: () => string | null;
  /** Online team matches: Crowd Call message box and the results timeline. Solo omits it. */
  crowd?: ActionMatchCrowd;
  /** Online live rooms: whole seconds until the next match starts, shown on the results card. */
  nextMatchIn?: number | null;
  /** The landing page's live embed: view-only and silent, so no quit or results buttons, music or sound effects. */
  preview?: boolean;
}

/** Play Mode's in-match screen: the ActionScene canvas plus a Gen III
 * battle-style HUD — team info boxes, your info box (HP/EN/dash), the
 * Crowd Call message box, the fight menu / touch controls, KO banners and
 * the results. */
export function ActionMatchScreen({
  store,
  engine,
  controller,
  onPlayAgain,
  onExit,
  names,
  playAgainLabel,
  exitLabel,
  netInfo,
  crowd,
  nextMatchIn,
  preview = false,
}: ActionMatchScreenProps) {
  const intl = useIntl();
  const state = useSimSnapshot(store);
  const [stageRect, setStageRect] = useState<StageRect | null>(null);
  /** The desktop bar's tallest height so far: the bar never shrinks below it, and once the match ends a spacer this tall keeps the arena where it was. */
  const barHeightRef = useRef(0);
  const touch = useMemo(() => IS_MOBILE_DEVICE || window.matchMedia('(pointer: coarse)').matches, []);
  const playerId = engine.playerId;
  const moves = controller
    ? state.pokemon[playerId].moves.map((slot) => engine.getMove(slot.moveId)).filter((m): m is MoveDefinition => !!m)
    : [];
  const toggleLock = () => {
    controller?.toggleLock();
    if (controller) saveLockOn(controller.lockOn);
  };
  const stacked = touch || (stageRect !== null && stageRect.width < STACKED_MAX_WIDTH);
  const playing = state.phase !== 'complete';
  const myTeam = controller ? state.pokemon[playerId].team : crowd?.side;
  const calls = crowd && state.teams ? crowd.calls.get() : null;
  const banner = calls && playing && (
    <CrowdCallBanner
      current={calls.current}
      nowMs={state.elapsedMs}
      myTeam={isCrowdSide(myTeam) ? myTeam : null}
      compact={stacked}
      style={stacked ? undefined : { flex: '1 1 0', minWidth: 0, minHeight: 112 }}
    />
  );
  // On a wide (desktop) arena the bottom row — your info box, the crowd message
  // box, the fight menu — sits in a bar under the arena, never over the court.
  const desktop = !isMobileArena(state.arena);
  const bottomRow =
    !stacked && playing && (controller || banner) ? (
      <div
        ref={(el) => {
          if (el && desktop) barHeightRef.current = Math.max(barHeightRef.current, el.offsetHeight);
        }}
        style={desktop ? { ...bottomBarStyle, width: stageRect?.width, minHeight: barHeightRef.current } : bottomRowStyle}
      >
        {controller && <InfoBox state={state} controller={controller} />}
        {banner || <div style={{ flex: '1 1 0' }} />}
        {controller && !touch && <FightMenu controller={controller} moves={moves} onToggleLock={toggleLock} />}
      </div>
    ) : null;
  const ping = netInfo?.();
  const meta = (
    <div style={metaRowStyle}>
      {playing && !preview && (
        <button onClick={onExit} style={quitButton}>
          ✕ {intl.formatMessage(M.quit)}
        </button>
      )}
      {ping && <span style={pingStyle}>{ping}</span>}
    </div>
  );

  return (
    <div style={pageStyle}>
      <div style={desktop ? desktopColumnStyle : mobileFrameStyle}>
        <div
          style={desktop ? { ...desktopStageStyle, aspectRatio: `${state.arena.width} / ${stadiumViewHeight(state.arena)}` } : fillStyle}
        >
          <Suspense fallback={null}>
            <PhaserGame engine={engine} controller={controller} onStageRectChange={setStageRect} align={desktop ? 'bottom' : 'center'} muted={preview} />
          </Suspense>
          {stageRect && (
            <div
              style={{
                ...overlayStyle,
                left: stageRect.left,
                top: stageRect.top,
                width: stageRect.width,
                height: stageRect.height,
              }}
            >
              {stacked ? (
                <div style={stackStyle}>
                  <TopHud state={state} engine={engine} compact />
                  {meta}
                  {/* Wrapped: in this column the box's desktop flex-basis would become a 320px height. */}
                  {controller && playing && (
                    <div>
                      <InfoBox state={state} controller={controller} />
                    </div>
                  )}
                  {banner}
                  {!state.teams && <Standings state={state} engine={engine} />}
                </div>
              ) : (
                <>
                  <TopHud state={state} engine={engine} compact={false} />
                  <div style={{ position: 'absolute', top: 29, left: 'calc(50% + 82px)' }}>{meta}</div>
                  {!state.teams && (
                    <div style={{ position: 'absolute', right: 24, top: 16, width: 220 }}>
                      <Standings state={state} engine={engine} />
                    </div>
                  )}
                </>
              )}
              {state.phase === 'intro' && <Banner title={intl.formatMessage(M.getReady)} />}
              {controller && state.phase === 'battle' && !engine.isAlive(playerId) && <DeathBanner state={state} />}
              {controller && playing && touch && <TouchControls controller={controller} moves={moves} onToggleLock={toggleLock} />}
              {!desktop && bottomRow}
              {stacked && !touch && controller && playing && (
                <div style={{ position: 'absolute', left: 10, right: 10, bottom: 10, display: 'flex', justifyContent: 'center' }}>
                  <FightMenu controller={controller} moves={moves} onToggleLock={toggleLock} />
                </div>
              )}
              {state.phase === 'complete' && (
                <Results
                  state={state}
                  engine={engine}
                  names={names}
                  labels={[playAgainLabel ?? intl.formatMessage(M.playAgain), exitLabel ?? intl.formatMessage(M.back)]}
                  onPlayAgain={onPlayAgain}
                  onExit={onExit}
                  crowd={crowd && state.teams ? { history: calls?.history ?? [], betResult: crowd.betResult } : undefined}
                  stacked={stacked}
                  nextMatchIn={nextMatchIn}
                  preview={preview}
                />
              )}
            </div>
          )}
        </div>
        {desktop &&
          (bottomRow ?? (barHeightRef.current > 0 && <div aria-hidden="true" style={{ flex: 'none', height: barHeightRef.current }} />))}
      </div>
    </div>
  );
}

const hpFraction = (state: SimState, engine: ActionEngine, id: string) =>
  engine.isAlive(id) ? state.pokemon[id].currentHp / state.pokemon[id].maxHp : 0;
const hpColor = (hp: number) => (hp > 0.5 ? HP_GREEN : hp > 0.2 ? HP_YELLOW : HP_RED);
const teamName = (intl: IntlShape, team: string) => intl.formatMessage(team === 'teamA' ? M.teamRuby : M.teamSapphire);

function clockText(state: SimState) {
  const remaining = Math.max(0, ACTION_MATCH_LIMIT_MS - state.elapsedMs);
  return `${Math.floor(remaining / 60000)}:${String(Math.floor((remaining % 60000) / 1000)).padStart(2, '0')}`;
}

/** Team info boxes (or, stacked, one-line chips) either side of the clock. */
function TopHud({ state, engine, compact }: { state: SimState; engine: ActionEngine; compact: boolean }) {
  const intl = useIntl();
  const clock = <div style={compact ? clockCompact : clockStyle}>{clockText(state)}</div>;
  if (!state.teams)
    return compact ? <div style={{ display: 'flex', justifyContent: 'center' }}>{clock}</div> : <div style={clockWrap}>{clock}</div>;
  const ids = (team: string) => state.allInstanceIds.filter((id) => state.pokemon[id].team === team);
  const standing = (team: string) => ids(team).filter((id) => engine.isAlive(id)).length;

  if (compact) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
        <span style={{ ...teamChip, color: TEAM_A_COLOR_CSS }}>
          <span style={teamMarker('teamA', 10)} />
          {intl.formatMessage(M.chipRuby, { count: standing('teamA') })}
        </span>
        {clock}
        <span style={{ ...teamChip, color: TEAM_B_COLOR_CSS }}>
          {intl.formatMessage(M.chipSapphire, { count: standing('teamB') })}
          <span style={teamMarker('teamB', 10)} />
        </span>
      </div>
    );
  }
  const box = (team: 'teamA' | 'teamB') => (
    <div
      style={{
        ...teamBoxStyle,
        [team === 'teamA' ? 'left' : 'right']: 24,
        borderRadius: team === 'teamA' ? '8px 8px 28px 8px' : '8px 8px 8px 28px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={teamMarker(team)} />
        <strong style={{ fontFamily: FONT_UI, fontSize: 20, color: team === 'teamA' ? TEAM_A_COLOR_CSS : TEAM_B_COLOR_CSS }}>
          {intl.formatMessage(M.teamHeader, { team: teamName(intl, team).toUpperCase() })}
        </strong>
        <span style={{ marginLeft: 'auto', fontFamily: FONT_UI, fontSize: 17 }}>
          {intl.formatMessage(M.teamLeft, { standing: standing(team), total: ids(team).length })}
        </span>
      </div>
      {ids(team).map((id) => {
        const hp = hpFraction(state, engine, id);
        const f = engine.getFighter(id);
        return (
          <div
            key={id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontFamily: FONT_UI,
              fontSize: 16,
              opacity: engine.isAlive(id) ? 1 : 0.5,
            }}
          >
            <span style={{ width: 92, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {state.pokemon[id].name}
              {id === engine.playerId ? ' ◀' : ''}
            </span>
            <div style={{ ...barTrack(6), flex: 1 }}>
              <div style={barFill(hpColor(hp), hp)} />
            </div>
            <Buffs speedMs={f.speedMs} shieldMs={f.shieldMs} />
          </div>
        );
      })}
    </div>
  );
  return (
    <>
      {box('teamA')}
      <div style={clockWrap}>{clock}</div>
      {box('teamB')}
    </>
  );
}

/** Crowd Call buffs on a fighter: a speed burst and/or an unused shield. */
function Buffs({ speedMs, shieldMs }: { speedMs: number; shieldMs: number }) {
  const intl = useIntl();
  if (speedMs <= 0 && shieldMs <= 0) return null;
  return (
    <span style={{ display: 'flex', gap: 3 }}>
      {speedMs > 0 && (
        <span title={intl.formatMessage(M.speedBurst)} style={buffTag}>
          {intl.formatMessage(M.speedTag)}
        </span>
      )}
      {shieldMs > 0 && (
        <span title={intl.formatMessage(M.shield)} style={buffTag}>
          {intl.formatMessage(M.shieldTag)}
        </span>
      )}
    </span>
  );
}

function Standings({ state, engine }: { state: SimState; engine: ActionEngine }) {
  const intl = useIntl();
  const standings = [...state.allInstanceIds].sort(
    (a, b) => Number(engine.isAlive(b)) - Number(engine.isAlive(a)) || engine.getFighter(b).kos - engine.getFighter(a).kos
  );
  return (
    <div style={{ ...standingsStyle, alignSelf: 'flex-end' }}>
      <strong style={{ fontFamily: FONT_UI, fontSize: 18 }}>{intl.formatMessage(M.freeForAll)}</strong>
      {standings.map((id) => (
        <div
          key={id}
          style={{
            display: 'flex',
            gap: 6,
            opacity: engine.isAlive(id) ? 1 : 0.5,
            fontWeight: id === engine.playerId ? 700 : 400,
          }}
        >
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {id === engine.playerId ? '▶ ' : ''}
            {state.pokemon[id].name}
          </span>
          <span>{engine.isAlive(id) ? intl.formatMessage(M.koCount, { count: engine.getFighter(id).kos }) : intl.formatMessage(M.out)}</span>
        </div>
      ))}
    </div>
  );
}

/** Your fighter's info box: HP (with a draining trail), energy and dash charges. */
function InfoBox({ state, controller }: { state: SimState; controller: PlayerController }) {
  const intl = useIntl();
  const me = state.pokemon[controller.playerId];
  const fighter = controller.engine.getFighter(controller.playerId);
  const hp = controller.engine.isAlive(controller.playerId) ? me.currentHp / me.maxHp : 0;
  return (
    <div style={infoBoxStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <strong style={{ fontFamily: FONT_UI, fontSize: 22, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {me.name.toUpperCase()}
        </strong>
        <Buffs speedMs={fighter.speedMs} shieldMs={fighter.shieldMs} />
        <span style={{ fontFamily: FONT_UI, fontSize: 17, whiteSpace: 'nowrap' }}>
          {Math.max(0, Math.ceil(hp * me.maxHp))}/{me.maxHp}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ ...barTag, color: ACTION }}>{intl.formatMessage(M.hp)}</span>
        <div style={{ ...barTrack(10, 3), flex: 1 }}>
          {/* The white trail drains after a beat, so a big hit reads at a glance. */}
          <div style={{ ...barFill(PANEL, hp), transition: 'width 400ms ease 300ms' }} />
          <div style={{ ...barFill(hpColor(hp), hp), transition: 'width 80ms linear' }} />
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ ...barTag, color: PANEL }}>{intl.formatMessage(M.energy)}</span>
        <div style={{ ...barTrack(5, 3), flex: 1 }}>
          <div style={barFill(ENERGY, fighter.energy / ENERGY_MAX)} />
        </div>
        <span style={{ fontFamily: FONT_UI, fontSize: 15, minWidth: 26, textAlign: 'right' }}>{Math.floor(fighter.energy)}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: FONT_UI, fontSize: 16 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }} aria-label={intl.formatMessage(M.dashesLeft, { count: fighter.dashCharges })}>
          {intl.formatMessage(M.dash)}
          {Array.from({ length: DASH_CHARGES }, (_, i) => (
            <span key={i} style={{ ...pip(10, 2), width: 20, background: i < fighter.dashCharges ? ENERGY : 'transparent' }} />
          ))}
        </span>
      </div>
    </div>
  );
}

interface ControlsProps {
  controller: PlayerController;
  moves: MoveDefinition[];
  onToggleLock: () => void;
}

/** Desktop: the 2×2 type-coloured fight menu, with dash/lock above it. */
function FightMenu({ controller, moves, onToggleLock }: ControlsProps) {
  const intl = useIntl();
  const fighter = controller.engine.getFighter(controller.playerId);
  return (
    <div style={{ flex: '0 1 420px', minWidth: 300, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'flex-end' }}>
        <button onClick={() => controller.dash()} style={smallKey(fighter.dashCharges > 0)}>
          <div style={sweepBar(dashSweep(fighter.dashCharges, fighter.dashRechargeMs))} />
          <span style={{ position: 'relative' }}>
            <span style={keyCap}>␣</span> {intl.formatMessage(M.dash)} {pips(fighter.dashCharges)}
          </span>
        </button>
        <button
          onClick={onToggleLock}
          aria-pressed={controller.lockOn}
          style={{ ...smallKey(true), background: controller.lockOn ? ACTION : PANEL }}
        >
          <span style={keyCap}>L</span> {controller.lockOn ? `◎ ${intl.formatMessage(M.lockOn)}` : `✛ ${intl.formatMessage(M.freeAim)}`}
        </button>
        <span style={{ ...smallKey(true), cursor: 'default' }}>
          <span style={keyCap}>Tab</span> {intl.formatMessage(M.target)}
        </span>
      </div>
      <div style={fightMenuStyle}>
        {moves.map((move, slot) => {
          const cost = moveEnergyCost(move.pp);
          const cdMs = fighter.cooldowns[slot];
          const broke = fighter.energy < cost;
          return (
            <button key={move.id} onClick={() => controller.fire(slot)} style={moveButton(move, broke)}>
              <span style={sweepBar(cdMs / moveCooldownMs(move.pp))} />
              <span
                style={{
                  position: 'relative',
                  fontSize: 19,
                  fontWeight: 700,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  maxWidth: '100%',
                }}
              >
                <span style={{ fontFamily: FONT_PIXEL, fontSize: 10 }}>{slot + 1}</span> {move.name}
              </span>
              <span style={{ position: 'relative', fontSize: 14, color: broke ? RUBY : undefined }}>
                {cdMs > 0
                  ? intl.formatMessage(M.cooldownSeconds, { seconds: (cdMs / 1000).toFixed(1) })
                  : broke
                    ? intl.formatMessage(M.needEnergy)
                    : intl.formatMessage(M.energyCost, { cost })}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Touch layout: joystick under the left thumb, a fan of moves under the right.
const TOUCH_SLOTS: { right: number; bottom: number; size: number }[] = [
  { right: 12, bottom: 18, size: 80 },
  { right: 100, bottom: 14, size: 64 },
  { right: 14, bottom: 106, size: 64 },
  { right: 88, bottom: 92, size: 58 },
];

function TouchControls({ controller, moves, onToggleLock }: ControlsProps) {
  const intl = useIntl();
  const fighter = controller.engine.getFighter(controller.playerId);
  return (
    <>
      <Joystick controller={controller} />
      {moves.map((move, slot) => (
        <TouchMoveButton
          key={move.id}
          controller={controller}
          slot={slot}
          move={move}
          cooldown={fighter.cooldowns[slot] / moveCooldownMs(move.pp)}
          disabled={fighter.energy < moveEnergyCost(move.pp)}
        />
      ))}
      <button
        onPointerDown={(e) => {
          e.preventDefault();
          controller.dash();
        }}
        style={{
          ...roundButton(58, INFO_BOX, INK, fighter.dashCharges === 0),
          right: 178,
          bottom: 20,
        }}
      >
        <div style={sweep(dashSweep(fighter.dashCharges, fighter.dashRechargeMs))} />
        <span style={{ position: 'relative', fontSize: 14 }}>{intl.formatMessage(M.dash)}</span>
        <span style={{ position: 'absolute', bottom: 5, fontSize: 11 }}>{pips(fighter.dashCharges)}</span>
      </button>
      <button onClick={onToggleLock} aria-pressed={controller.lockOn} style={{ ...lockPill(controller.lockOn), right: 12, bottom: 178 }}>
        {controller.lockOn ? `◎ ${intl.formatMessage(M.lockOn)}` : `✛ ${intl.formatMessage(M.freeAim)}`}
      </button>
    </>
  );
}

/** Tap fires (at the lock-on target, or straight ahead); drag past a few px
 * to aim by hand, release to fire. */
function TouchMoveButton({
  controller,
  slot,
  move,
  cooldown,
  disabled,
}: {
  controller: PlayerController;
  slot: number;
  move: MoveDefinition;
  cooldown: number;
  disabled: boolean;
}) {
  const intl = useIntl();
  const start = useRef<{ x: number; y: number } | null>(null);
  const layout = TOUCH_SLOTS[slot];
  const onDown = (e: PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = { x: e.clientX, y: e.clientY };
  };
  const onMove = (e: PointerEvent) => {
    if (!start.current) return;
    const dx = e.clientX - start.current.x;
    const dy = e.clientY - start.current.y;
    const d = Math.hypot(dx, dy);
    controller.dragAim = d > DRAG_AIM_THRESHOLD ? { x: dx / d, y: dy / d } : null;
  };
  const onUp = () => {
    if (start.current) controller.fire(slot, controller.dragAim);
    start.current = null;
    controller.dragAim = null;
  };
  const onCancel = () => {
    start.current = null;
    controller.dragAim = null;
  };
  return (
    <button
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onCancel}
      style={{
        ...roundButton(layout.size, typeColorCss(move.type), typeTextCss(move.type), disabled),
        right: layout.right,
        bottom: layout.bottom,
      }}
    >
      <div style={sweep(cooldown)} />
      <span
        style={{
          position: 'relative',
          fontSize: (layout.size > 70 ? 13 : 11) - (move.name.length > 9 ? 2 : 0),
          lineHeight: 1.05,
          padding: '0 6px',
          marginBottom: 12, // clears the energy cost pinned at bottom: 5
          overflowWrap: 'normal',
        }}
      >
        {move.name}
      </span>
      <span style={{ position: 'absolute', bottom: 5, fontSize: 11 }}>{intl.formatMessage(M.energyCost, { cost: moveEnergyCost(move.pp) })}</span>
    </button>
  );
}

/** Floating stick: it centres wherever the thumb lands in the left half. */
function Joystick({ controller }: { controller: PlayerController }) {
  const intl = useIntl();
  const [origin, setOrigin] = useState<{ x: number; y: number } | null>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const zone = useRef<HTMLDivElement>(null);
  const onDown = (e: PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = zone.current!.getBoundingClientRect();
    setOrigin({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    setKnob({ x: 0, y: 0 });
  };
  const onMove = (e: PointerEvent) => {
    if (!origin) return;
    const rect = zone.current!.getBoundingClientRect();
    let dx = e.clientX - rect.left - origin.x;
    let dy = e.clientY - rect.top - origin.y;
    const d = Math.hypot(dx, dy);
    if (d > JOYSTICK_RADIUS) {
      dx *= JOYSTICK_RADIUS / d;
      dy *= JOYSTICK_RADIUS / d;
    }
    setKnob({ x: dx, y: dy });
    // Push distance sets speed: half-way out is half speed.
    controller.stickMove = { x: dx / JOYSTICK_RADIUS, y: dy / JOYSTICK_RADIUS };
  };
  const onUp = () => {
    setOrigin(null);
    controller.stickMove = { x: 0, y: 0 };
  };
  return (
    <div ref={zone} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} style={joystickZone}>
      {origin && (
        <div
          style={{
            ...joystickBase,
            left: origin.x - JOYSTICK_RADIUS,
            top: origin.y - JOYSTICK_RADIUS,
          }}
        >
          <div
            style={{
              ...joystickKnob,
              transform: `translate(${knob.x}px, ${knob.y}px)`,
            }}
          />
        </div>
      )}
      {!origin && <span style={joystickHint}>{intl.formatMessage(M.dragToMove)}</span>}
    </div>
  );
}

function DeathBanner({ state }: { state: SimState }) {
  const intl = useIntl();
  return (
    <Banner
      title={intl.formatMessage(M.fainted)}
      subtitle={
        intl.formatMessage(state.teams ? M.faintedTeam : M.faintedSolo)
      }
    />
  );
}

function Banner({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div style={bannerStyle}>
      <div style={{ fontFamily: FONT_UI, fontSize: 30, fontWeight: 700 }}>{title}</div>
      {subtitle && <div style={{ fontFamily: FONT_BODY, fontSize: 15, marginTop: 4 }}>{subtitle}</div>}
    </div>
  );
}

function Results({
  state,
  engine,
  names,
  labels,
  onPlayAgain,
  onExit,
  crowd,
  stacked,
  nextMatchIn,
  preview,
}: {
  state: SimState;
  engine: ActionEngine;
  names?: Record<string, string>;
  labels: [string, string];
  onPlayAgain: () => void;
  onExit: () => void;
  crowd?: { history: Parameters<typeof CrowdCallsTimeline>[0]['history']; betResult?: string | null };
  stacked: boolean;
  nextMatchIn?: number | null;
  preview: boolean;
}) {
  const intl = useIntl();
  const winners = new Set(state.winnerInstanceIds);
  const iWon = winners.has(engine.playerId);
  const someWinner = state.winnerInstanceIds[0];
  const winTeam = someWinner ? state.pokemon[someWinner].team : undefined;
  const title =
    winners.size === 0
      ? intl.formatMessage(M.draw)
      : iWon
        ? intl.formatMessage(state.teams ? M.yourTeamWins : M.youWin)
        : engine.playerId in state.pokemon
          ? intl.formatMessage(M.youLost, {
              winner: state.teams ? intl.formatMessage(M.teamLabel, { team: teamName(intl, winTeam ?? '') }) : state.pokemon[someWinner].name,
            })
          : state.teams
            ? intl.formatMessage(M.teamWins, { team: teamName(intl, winTeam ?? '') })
            : intl.formatMessage(M.nameWins, { name: state.pokemon[someWinner].name });
  const rows = [...state.allInstanceIds].sort(
    (a, b) =>
      Number(winners.has(b)) - Number(winners.has(a)) ||
      engine.getFighter(b).kos - engine.getFighter(a).kos ||
      engine.getFighter(b).damageDealt - engine.getFighter(a).damageDealt
  );
  const standingOf = (team: string) => state.allInstanceIds.filter((id) => state.pokemon[id].team === team && engine.isAlive(id)).length;
  const twoCol = !!crowd && !stacked;
  return (
    <div style={{ ...resultsStyle, width: twoCol ? 'min(94%, 780px)' : 'min(94%, 460px)' }}>
      <div>
        <h2
          style={{ margin: 0, fontFamily: FONT_UI, fontSize: 40, lineHeight: 1, color: state.teams ? (teamColorCss(winTeam) ?? INK) : INK }}
        >
          {title}
        </h2>
        {state.teams && (
          <span style={{ fontSize: 15, color: INK_MUTED }}>
            {intl.formatMessage(M.standing, {
              teamA: teamName(intl, 'teamA'),
              countA: standingOf('teamA'),
              teamB: teamName(intl, 'teamB'),
              countB: standingOf('teamB'),
            })}
          </span>
        )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: twoCol ? 'minmax(0, 1fr) minmax(0, 1fr)' : 'minmax(0, 1fr)', gap: 16 }}>
        <section aria-label={intl.formatMessage(M.fighters)} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ ...resultRow, background: 'transparent', border: 'none', color: INK_MUTED, fontSize: 14 }}>
            <span>{intl.formatMessage(M.colPokemon)}</span>
            <span>{intl.formatMessage(M.colKo)}</span>
            <span>{intl.formatMessage(M.colDamage)}</span>
            <span>{intl.formatMessage(M.colOut)}</span>
          </div>
          {rows.map((id) => {
            const f = engine.getFighter(id);
            const p = state.pokemon[id];
            return (
              <div key={id} style={{ ...resultRow, outline: id === engine.playerId ? `3px solid ${ACTION}` : undefined }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  {state.teams && <span style={teamMarker(p.team, 11)} />}
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {winners.has(id) ? '🏆 ' : ''}
                    {p.name}
                    {id === engine.playerId ? ` ${intl.formatMessage(M.you)}` : ''}
                    {names?.[id] && <span style={{ fontFamily: FONT_BODY, fontSize: 13, color: INK_MUTED }}> {names[id]}</span>}
                  </span>
                </span>
                <span>{f.kos}</span>
                <span>{f.damageDealt}</span>
                <span>{engine.isAlive(id) ? '' : '✕'}</span>
              </div>
            );
          })}
          {crowd?.betResult && (
            <div style={betBox}>
              <span style={{ fontFamily: FONT_UI, fontSize: 17 }}>{intl.formatMessage(M.yourBet)}</span>
              <span style={{ fontSize: 15 }}>{crowd.betResult}</span>
            </div>
          )}
        </section>
        {crowd && <CrowdCallsTimeline history={crowd.history} />}
      </div>
      {nextMatchIn != null && (
        <div role="timer" style={{ textAlign: 'center', fontFamily: FONT_UI, fontSize: 20 }}>
          {nextMatchIn > 0 ? intl.formatMessage(M.nextMatchIn, { seconds: nextMatchIn }) : intl.formatMessage(M.nextMatchStarting)}
        </div>
      )}
      {!preview && (
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button onClick={onExit} style={hoennButton('secondary')}>
            {labels[1]}
          </button>
          <button onClick={onPlayAgain} style={hoennButton('primary')}>
            ▶ {labels[0]}
          </button>
        </div>
      )}
    </div>
  );
}

const pips = (n: number) => '●'.repeat(n) + '○'.repeat(Math.max(0, DASH_CHARGES - n));
/** Only an empty dash shows a sweep — with a charge left the button still works. */
const dashSweep = (charges: number, rechargeMs: number) => (charges > 0 ? 0 : 1 - rechargeMs / DASH_RECHARGE_MS);
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/** Pie over a round button showing how much of its cooldown is left. */
function sweep(fractionLeft: number): CSSProperties {
  return {
    position: 'absolute',
    inset: 0,
    borderRadius: 'inherit',
    background: `conic-gradient(rgba(164,164,164,0.85) ${clamp01(fractionLeft) * 360}deg, transparent 0)`,
    pointerEvents: 'none',
  };
}

/** The fight menu's sweep: a COOLDOWN block from the left that shrinks as the move comes back. */
function sweepBar(fractionLeft: number): CSSProperties {
  return {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: `${clamp01(fractionLeft) * 100}%`,
    background: COOLDOWN,
    pointerEvents: 'none',
  };
}

const pageStyle: CSSProperties = {
  width: '100%',
  height: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: STAGE_BG,
};
const mobileFrameStyle: CSSProperties = {
  position: 'relative',
  width: '100%',
  height: '100%',
  background: '#000',
};
const fillStyle: CSSProperties = { position: 'relative', width: '100%', height: '100%' };
/** The arena with the HUD bar right under it, centred together: the arena's
 * box has the canvas's own shape (shrinking to fit a short window), so no
 * dead space opens up inside it, and nothing jumps when the bar goes away. */
const desktopColumnStyle: CSSProperties = {
  width: 'min(98%, 1800px)',
  height: 'calc(100% - 16px)',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 10,
};
const desktopStageStyle: CSSProperties = {
  position: 'relative',
  alignSelf: 'stretch',
  flex: '0 1 auto',
  minHeight: 0,
  borderRadius: 8,
  overflow: 'hidden',
};
const overlayStyle: CSSProperties = {
  position: 'absolute',
  overflow: 'hidden',
  pointerEvents: 'none',
  fontFamily: FONT_BODY,
  color: INK,
  userSelect: 'none',
  WebkitUserSelect: 'none',
};
const stackStyle: CSSProperties = {
  position: 'absolute',
  top: 8,
  left: 10,
  right: 10,
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};
const clockWrap: CSSProperties = { position: 'absolute', top: 18, left: '50%', transform: 'translateX(-50%)' };
const clockStyle: CSSProperties = {
  fontFamily: FONT_PIXEL,
  fontSize: 24,
  padding: '12px 14px',
  borderRadius: 8,
  background: PANEL,
  border: `3px solid ${INK}`,
};
const clockCompact: CSSProperties = { ...clockStyle, fontSize: 13, padding: '6px 8px', border: `2px solid ${INK}`, borderRadius: 4 };
const teamChip: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '2px 8px',
  borderRadius: 4,
  background: INFO_BOX,
  border: `2px solid ${INK}`,
  fontFamily: FONT_UI,
  fontSize: 16,
  whiteSpace: 'nowrap',
};
const teamBoxStyle: CSSProperties = {
  position: 'absolute',
  top: 16,
  width: 'min(300px, 32%)',
  boxSizing: 'border-box',
  background: INFO_BOX,
  border: `3px solid ${INK}`,
  padding: '8px 14px',
  display: 'flex',
  flexDirection: 'column',
  gap: 5,
};
const buffTag: CSSProperties = { ...chip(CROWD, PANEL), minHeight: 0, padding: '0 4px', fontSize: 12, borderWidth: 1 };
const standingsStyle: CSSProperties = {
  background: INFO_BOX,
  border: `3px solid ${INK}`,
  borderRadius: 8,
  padding: '6px 10px',
  fontFamily: FONT_UI,
  fontSize: 15,
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  minWidth: 170,
};
const metaRowStyle: CSSProperties = { display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'center' };
const quitButton: CSSProperties = {
  minHeight: 32,
  padding: '0 10px',
  borderRadius: 6,
  border: `2px solid ${INK}`,
  background: PANEL,
  color: INK,
  fontFamily: FONT_UI,
  fontSize: 15,
  cursor: 'pointer',
  pointerEvents: 'auto',
};
const pingStyle: CSSProperties = { ...chip(PANEL), fontSize: 13, minHeight: 0, padding: '2px 6px' };
const bottomBarStyle: CSSProperties = {
  flex: 'none',
  maxWidth: '100%',
  display: 'flex',
  alignItems: 'flex-end',
  gap: 14,
  fontFamily: FONT_BODY,
  color: INK,
};
const bottomRowStyle: CSSProperties = {
  position: 'absolute',
  left: 24,
  right: 24,
  bottom: 16,
  display: 'flex',
  alignItems: 'flex-end',
  gap: 14,
};
const infoBoxStyle: CSSProperties = {
  flex: '0 1 320px',
  minWidth: 230,
  boxSizing: 'border-box',
  background: INFO_BOX,
  border: `3px solid ${INK}`,
  borderRadius: '28px 8px 8px 8px',
  padding: '10px 16px',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};
const barTag: CSSProperties = { fontFamily: FONT_PIXEL, fontSize: 10, background: INK, padding: '3px 5px', borderRadius: 3 };
function pip(size: number, radius: number | string): CSSProperties {
  return { width: size, height: size, borderRadius: radius, border: `2px solid ${INK}`, boxSizing: 'border-box', display: 'inline-block' };
}
const fightMenuStyle: CSSProperties = {
  background: PANEL,
  border: `3px solid ${INK}`,
  borderRadius: 8,
  padding: 8,
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: 8,
  pointerEvents: 'auto',
};
function moveButton(move: MoveDefinition, broke: boolean): CSSProperties {
  return {
    position: 'relative',
    overflow: 'hidden',
    minHeight: 52,
    padding: '4px 10px',
    border: broke ? `3px dashed ${INK_MUTED}` : `3px solid ${INK}`,
    borderRadius: 6,
    background: broke ? GROUND : typeColorCss(move.type),
    color: broke ? INK : typeTextCss(move.type),
    fontFamily: FONT_UI,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    justifyContent: 'center',
    gap: 1,
    cursor: 'pointer',
    textAlign: 'left',
  };
}
function smallKey(enabled: boolean): CSSProperties {
  return {
    position: 'relative',
    overflow: 'hidden',
    minHeight: 44,
    padding: '0 10px',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    borderRadius: 6,
    border: `2px solid ${INK}`,
    background: enabled ? PANEL : GROUND,
    color: INK,
    fontFamily: FONT_UI,
    fontSize: 15,
    fontWeight: 700,
    cursor: 'pointer',
    pointerEvents: 'auto',
    whiteSpace: 'nowrap',
  };
}
const keyCap: CSSProperties = {
  fontFamily: FONT_PIXEL,
  fontSize: 9,
  padding: '2px 4px',
  borderRadius: 3,
  background: INK,
  color: PANEL,
};
function roundButton(size: number, color: string, text: string, dim: boolean): CSSProperties {
  return {
    position: 'absolute',
    width: size,
    height: size,
    borderRadius: '50%',
    background: color,
    border: `3px solid ${INK}`,
    color: text,
    fontFamily: FONT_UI,
    fontWeight: 700,
    display: 'grid',
    placeItems: 'center',
    textAlign: 'center',
    overflow: 'hidden',
    boxShadow: `0 4px 0 ${INK}`,
    pointerEvents: 'auto',
    touchAction: 'none',
    filter: dim ? 'grayscale(1) brightness(0.8)' : undefined,
  };
}
function lockPill(on: boolean): CSSProperties {
  return {
    position: 'absolute',
    minHeight: 44,
    padding: '0 12px',
    borderRadius: 8,
    border: `3px solid ${INK}`,
    fontSize: 15,
    fontFamily: FONT_UI,
    fontWeight: 700,
    color: INK,
    background: on ? ACTION : PANEL,
    pointerEvents: 'auto',
    touchAction: 'none',
  };
}
const joystickZone: CSSProperties = {
  position: 'absolute',
  left: 0,
  bottom: 0,
  width: '45%',
  height: 200,
  pointerEvents: 'auto',
  touchAction: 'none',
};
const joystickBase: CSSProperties = {
  position: 'absolute',
  width: JOYSTICK_RADIUS * 2,
  height: JOYSTICK_RADIUS * 2,
  borderRadius: '50%',
  background: 'rgba(255,255,255,0.25)',
  border: `3px solid ${INK}`,
  display: 'grid',
  placeItems: 'center',
};
const joystickKnob: CSSProperties = {
  width: 50,
  height: 50,
  borderRadius: '50%',
  background: PANEL,
  border: `3px solid ${INK}`,
  boxShadow: `0 4px 0 ${INK}`,
};
const joystickHint: CSSProperties = {
  ...chip(PANEL),
  position: 'absolute',
  left: 16,
  bottom: 24,
  fontSize: 13,
  opacity: 0.85,
};
const bannerStyle: CSSProperties = {
  ...messageBox,
  position: 'absolute',
  left: '50%',
  top: '32%',
  transform: 'translateX(-50%)',
  padding: '14px 28px',
  textAlign: 'center',
  maxWidth: '90%',
};
const resultsStyle: CSSProperties = {
  ...messageBox,
  position: 'absolute',
  left: '50%',
  top: '50%',
  transform: 'translate(-50%, -50%)',
  maxHeight: '92%',
  overflowY: 'auto',
  padding: 20,
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
  pointerEvents: 'auto',
  fontFamily: FONT_BODY,
};
const resultRow: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) 36px 48px 28px',
  gap: 6,
  alignItems: 'center',
  padding: '6px 10px',
  borderRadius: 6,
  background: INFO_BOX,
  border: `2px solid ${INK}`,
  fontFamily: FONT_UI,
  fontSize: 17,
};
const betBox: CSSProperties = {
  marginTop: 6,
  padding: 12,
  borderRadius: 8,
  background: primaryAlpha(0.3),
  border: `3px solid ${INK}`,
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
};
