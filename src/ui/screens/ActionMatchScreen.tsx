import { lazy, Suspense, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import type { StageRect } from '../../render/PhaserGame';
import type { ActionEngine } from '../../sim/action/ActionEngine';
import type { PlayerController } from '../../sim/action/playerController';
import { ACTION_MATCH_LIMIT_MS, DASH_CHARGES, DASH_RECHARGE_MS, ENERGY_MAX, moveCooldownMs, moveEnergyCost } from '../../sim/action/rules';
import { isMobileArena } from '../../sim/constants';
import type { MoveDefinition, SimState } from '../../sim/types';
import { IS_MOBILE_DEVICE } from '../../app/config';
import { saveLockOn } from '../playModeSettings';
import { useSimSnapshot } from '../hooks/useSimSnapshot';
import type { SimStore } from '../state/simStore';
import { TEAM_A_COLOR_CSS, TEAM_B_COLOR_CSS, teamColorCss } from '../teamColors';
import { typeColorCss } from '../typeColorCss';
import { PRIMARY, PRIMARY_TEXT } from '../theme';

const PhaserGame = lazy(() => import('../../render/PhaserGame').then((m) => ({ default: m.PhaserGame })));

const JOYSTICK_RADIUS = 56;
const DRAG_AIM_THRESHOLD = 18;
const HUD_FONT = '"Space Mono", monospace';

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
}

/** Play Mode's in-match screen: the ActionScene canvas plus the player's HUD —
 * HP/lives/energy, move and dash buttons, the lock-on toggle, touch joystick,
 * KO/respawn banners and the results table. */
export function ActionMatchScreen({
  store,
  engine,
  controller,
  onPlayAgain,
  onExit,
  names,
  playAgainLabel = 'PLAY AGAIN',
  exitLabel = 'BACK',
  netInfo,
}: ActionMatchScreenProps) {
  const state = useSimSnapshot(store);
  const [stageRect, setStageRect] = useState<StageRect | null>(null);
  const touch = useMemo(() => IS_MOBILE_DEVICE || window.matchMedia('(pointer: coarse)').matches, []);
  const playerId = engine.playerId;
  const moves = controller
    ? state.pokemon[playerId].moves.map((slot) => engine.getMove(slot.moveId)).filter((m): m is MoveDefinition => !!m)
    : [];
  const toggleLock = () => {
    controller?.toggleLock();
    if (controller) saveLockOn(controller.lockOn);
  };

  return (
    <div style={pageStyle}>
      <div style={isMobileArena(state.arena) ? mobileFrameStyle : desktopFrameStyle}>
        <Suspense fallback={null}>
          <PhaserGame engine={engine} action={{ controller }} onStageRectChange={setStageRect} />
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
            <TopBar state={state} engine={engine} touch={touch} />
            {state.phase !== 'complete' && (
              <button onClick={onExit} style={quitButton}>
                ✕ QUIT
              </button>
            )}
            {netInfo?.() && <div style={netInfoStyle}>{netInfo()}</div>}
            {state.phase === 'intro' && <Banner title="GET READY" />}
            {controller && state.phase === 'battle' && !engine.isAlive(playerId) && <DeathBanner state={state} controller={controller} />}
            {controller && state.phase !== 'complete' && (
              <>
                <StatusPanel state={state} controller={controller} touch={touch} />
                {touch ? (
                  <TouchControls controller={controller} moves={moves} onToggleLock={toggleLock} />
                ) : (
                  <DesktopBar controller={controller} moves={moves} onToggleLock={toggleLock} />
                )}
              </>
            )}
            {state.phase === 'complete' && (
              <Results
                state={state}
                engine={engine}
                names={names}
                labels={[playAgainLabel, exitLabel]}
                onPlayAgain={onPlayAgain}
                onExit={onExit}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function TopBar({ state, engine, touch }: { state: SimState; engine: ActionEngine; touch: boolean }) {
  const remaining = Math.max(0, ACTION_MATCH_LIMIT_MS - state.elapsedMs);
  const clock = `${Math.floor(remaining / 60000)}:${String(Math.floor((remaining % 60000) / 1000)).padStart(2, '0')}`;
  const livesOf = (team: string) =>
    state.allInstanceIds.filter((id) => state.pokemon[id].team === team).reduce((sum, id) => sum + engine.getFighter(id).lives, 0);

  if (state.teams) {
    return (
      <div style={topBarStyle}>
        <span style={teamScore(TEAM_A_COLOR_CSS)}>♥ {livesOf('teamA')}</span>
        <span>{clock}</span>
        <span style={teamScore(TEAM_B_COLOR_CSS)}>♥ {livesOf('teamB')}</span>
      </div>
    );
  }
  const standings = [...state.allInstanceIds].sort(
    (a, b) => engine.getFighter(b).lives - engine.getFighter(a).lives || engine.getFighter(b).kos - engine.getFighter(a).kos
  );
  return (
    <>
      <div style={topBarStyle}>
        <span>FFA · {clock}</span>
      </div>
      <div style={{ ...standingsStyle, top: touch ? 128 : 48 }}>
        {standings.map((id) => (
          <div
            key={id}
            style={{
              display: 'flex',
              gap: 6,
              opacity: engine.getFighter(id).lives === 0 ? 0.45 : 1,
              color: id === engine.playerId ? '#9ff3ea' : '#fff',
            }}
          >
            <span
              style={{
                flex: 1,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {state.pokemon[id].name.toUpperCase()}
            </span>
            <span style={{ color: '#ff6b9a' }}>{hearts(engine.getFighter(id).lives)}</span>
          </div>
        ))}
      </div>
    </>
  );
}

function StatusPanel({ state, controller, touch }: { state: SimState; controller: PlayerController; touch: boolean }) {
  const me = state.pokemon[controller.playerId];
  const fighter = controller.engine.getFighter(controller.playerId);
  const hp = controller.engine.isAlive(controller.playerId) ? me.currentHp / me.maxHp : 0;
  return (
    // Phones keep the bottom of the screen for thumbs, so the panel sits under the score.
    <div style={touch ? { ...statusPanelStyle, left: 10, right: 10, top: 46 } : { ...statusPanelStyle, left: 14, bottom: 14, width: 260 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <b
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          YOU · {me.name.toUpperCase()}
        </b>
        <span style={{ color: '#ff6b9a', letterSpacing: 1 }}>{hearts(fighter.lives)}</span>
      </div>
      <div style={barTrack(10)}>
        {/* The white trail drains after a beat, so a big hit reads at a glance. */}
        <div
          style={{
            ...barFill('#ffffff', hp),
            transition: 'width 400ms ease 300ms',
          }}
        />
        <div
          style={{
            ...barFill(hp > 0.5 ? '#4caf50' : hp > 0.2 ? '#cb4b16' : '#dc322f', hp),
            transition: 'width 80ms linear',
          }}
        />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{ ...barTrack(6), flex: 1 }}>
          <div style={barFill('#f8d030', fighter.energy / ENERGY_MAX)} />
        </div>
        <span
          style={{
            color: '#ffd479',
            fontSize: 11,
            minWidth: 34,
            textAlign: 'right',
          }}
        >
          ⚡{Math.floor(fighter.energy)}
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

function DesktopBar({ controller, moves, onToggleLock }: ControlsProps) {
  const fighter = controller.engine.getFighter(controller.playerId);
  return (
    <div style={desktopBarStyle}>
      {moves.map((move, slot) => (
        <button key={move.id} onClick={() => controller.fire(slot)} style={desktopSlot(fighter.energy < moveEnergyCost(move.pp))}>
          <span style={keyHint}>{slot + 1}</span>
          <div style={slotTop(typeColorCss(move.type))}>
            <div style={sweep(fighter.cooldowns[slot] / moveCooldownMs(move.pp))} />
            <span style={{ position: 'relative' }}>{move.name}</span>
          </div>
          <span style={{ fontSize: 10 }}>
            ⚡{moveEnergyCost(move.pp)} · {(moveCooldownMs(move.pp) / 1000).toFixed(1)}s
          </span>
        </button>
      ))}
      <button onClick={() => controller.dash()} style={desktopSlot(fighter.dashCharges === 0)}>
        <span style={keyHint}>␣</span>
        <div style={slotTop('#2a2e36')}>
          <div style={sweep(dashSweep(fighter.dashCharges, fighter.dashRechargeMs))} />
          <span style={{ position: 'relative' }}>DASH</span>
        </div>
        <span style={{ fontSize: 10, color: '#9ff3ea' }}>{pips(fighter.dashCharges)}</span>
      </button>
      <button onClick={onToggleLock} style={{ ...desktopSlot(false), width: 74 }}>
        <span style={keyHint}>L</span>
        <div style={slotTop(controller.lockOn ? '#2aa198' : '#2a2e36')}>{controller.lockOn ? '◎ LOCK' : '✛ FREE'}</div>
        <span style={{ fontSize: 10 }}>Tab: target</span>
      </button>
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
          ...roundButton(58, '#2a2e36', fighter.dashCharges === 0),
          right: 178,
          bottom: 20,
        }}
      >
        <div style={sweep(dashSweep(fighter.dashCharges, fighter.dashRechargeMs))} />
        <span style={{ position: 'relative', fontSize: 11 }}>DASH</span>
        <span
          style={{
            position: 'absolute',
            bottom: 6,
            fontSize: 10,
            color: '#9ff3ea',
          }}
        >
          {pips(fighter.dashCharges)}
        </span>
      </button>
      <button onClick={onToggleLock} style={{ ...lockPill(controller.lockOn), right: 12, bottom: 178 }}>
        {controller.lockOn ? '◎ LOCK-ON' : '✛ FREE AIM'}
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
        ...roundButton(layout.size, typeColorCss(move.type), disabled),
        right: layout.right,
        bottom: layout.bottom,
      }}
    >
      <div style={sweep(cooldown)} />
      <span
        style={{
          position: 'relative',
          fontSize: layout.size > 70 ? 11 : 9,
          lineHeight: 1.1,
          padding: '0 6px',
          overflowWrap: 'anywhere',
        }}
      >
        {move.name}
      </span>
      <span style={{ position: 'absolute', bottom: 5, fontSize: 9 }}>⚡{moveEnergyCost(move.pp)}</span>
    </button>
  );
}

/** Floating stick: it centres wherever the thumb lands in the left half. */
function Joystick({ controller }: { controller: PlayerController }) {
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
      {!origin && <span style={joystickHint}>drag to move</span>}
    </div>
  );
}

function DeathBanner({ state, controller }: { state: SimState; controller: PlayerController }) {
  const fighter = controller.engine.getFighter(controller.playerId);
  if (fighter.respawnAtMs !== null) {
    const secs = Math.max(1, Math.ceil((fighter.respawnAtMs - state.elapsedMs) / 1000));
    return (
      <Banner
        title="FAINTED"
        subtitle={`${hearts(fighter.lives)}  ${fighter.lives} ${fighter.lives === 1 ? 'life' : 'lives'} left · back in ${secs}`}
      />
    );
  }
  return <Banner title="OUT OF LIVES" subtitle={state.teams ? 'Spectating — your team can still win' : 'Spectating'} />;
}

function Banner({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div style={bannerStyle}>
      <div
        style={{
          fontSize: 30,
          fontWeight: 'bold',
          letterSpacing: 2,
          textShadow: '0 3px 0 #b02f6d',
        }}
      >
        {title}
      </div>
      {subtitle && <div style={{ fontSize: 13, marginTop: 6 }}>{subtitle}</div>}
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
}: {
  state: SimState;
  engine: ActionEngine;
  names?: Record<string, string>;
  labels: [string, string];
  onPlayAgain: () => void;
  onExit: () => void;
}) {
  const winners = new Set(state.winnerInstanceIds);
  const iWon = winners.has(engine.playerId);
  const someWinner = state.winnerInstanceIds[0];
  const title =
    winners.size === 0
      ? 'DRAW'
      : iWon
        ? state.teams
          ? 'YOUR TEAM WINS!'
          : 'YOU WIN!'
        : state.teams
          ? `${state.pokemon[someWinner].team === 'teamA' ? 'TEAM A' : 'TEAM B'} WINS`
          : `${state.pokemon[someWinner].name.toUpperCase()} WINS`;
  const rows = [...state.allInstanceIds].sort(
    (a, b) =>
      Number(winners.has(b)) - Number(winners.has(a)) ||
      engine.getFighter(b).kos - engine.getFighter(a).kos ||
      engine.getFighter(b).damageDealt - engine.getFighter(a).damageDealt
  );
  return (
    <div style={resultsStyle}>
      <div
        style={{
          fontSize: 26,
          fontWeight: 'bold',
          textAlign: 'center',
          color: iWon ? '#ffd479' : '#fff',
        }}
      >
        {title}
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr>
            <th style={cellLeft}>Pokémon</th>
            <th style={cell}>KO</th>
            <th style={cell}>DMG</th>
            <th style={cell}>♥</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((id) => {
            const f = engine.getFighter(id);
            const p = state.pokemon[id];
            return (
              <tr
                key={id}
                style={{
                  color: id === engine.playerId ? '#9ff3ea' : '#fff',
                }}
              >
                <td
                  style={{
                    ...cellLeft,
                    borderLeft: `4px solid ${teamColorCss(p.team) ?? 'transparent'}`,
                  }}
                >
                  {winners.has(id) ? '🏆 ' : ''}
                  {names?.[id] ? `${names[id]} · ` : ''}
                  {p.name.toUpperCase()}
                  {id === engine.playerId ? ' (you)' : ''}
                </td>
                <td style={cell}>{f.kos}</td>
                <td style={cell}>{f.damageDealt}</td>
                <td style={cell}>{f.lives}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
        <button onClick={onPlayAgain} style={primaryButton}>
          {labels[0]}
        </button>
        <button onClick={onExit} style={secondaryButton}>
          {labels[1]}
        </button>
      </div>
    </div>
  );
}

const hearts = (n: number) => (n > 0 ? '♥'.repeat(n) : '✕');
const pips = (n: number) => '●'.repeat(n) + '○'.repeat(Math.max(0, DASH_CHARGES - n));
/** Only an empty dash shows a sweep — with a charge left the button still works. */
const dashSweep = (charges: number, rechargeMs: number) => (charges > 0 ? 0 : 1 - rechargeMs / DASH_RECHARGE_MS);

/** Dark pie over a button showing how much of its cooldown is left. */
function sweep(fractionLeft: number): CSSProperties {
  return {
    position: 'absolute',
    inset: 0,
    borderRadius: 'inherit',
    background: `conic-gradient(rgba(16,18,22,0.72) ${Math.max(0, Math.min(1, fractionLeft)) * 360}deg, transparent 0)`,
    pointerEvents: 'none',
  };
}

const pageStyle: CSSProperties = {
  width: '100%',
  height: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: '#101216',
};
const mobileFrameStyle: CSSProperties = {
  position: 'relative',
  width: '100%',
  height: '100%',
  background: '#000',
};
const desktopFrameStyle: CSSProperties = {
  position: 'relative',
  width: 'min(98%, 1800px)',
  aspectRatio: '16 / 9',
  maxHeight: '98vh',
  background: '#000',
  borderRadius: 8,
  overflow: 'hidden',
};
const overlayStyle: CSSProperties = {
  position: 'absolute',
  overflow: 'hidden',
  pointerEvents: 'none',
  fontFamily: HUD_FONT,
  color: '#fff',
  userSelect: 'none',
  WebkitUserSelect: 'none',
};
const pill: CSSProperties = {
  background: 'rgba(40,44,52,0.85)',
  border: '1px solid rgba(255,255,255,0.15)',
  borderRadius: 8,
};
const topBarStyle: CSSProperties = {
  ...pill,
  position: 'absolute',
  top: 10,
  left: '50%',
  transform: 'translateX(-50%)',
  display: 'flex',
  gap: 12,
  alignItems: 'center',
  padding: '4px 10px',
  fontSize: 14,
  fontWeight: 'bold',
};
const standingsStyle: CSSProperties = {
  ...pill,
  position: 'absolute',
  right: 10,
  width: 150,
  padding: '6px 8px',
  fontSize: 10,
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
};
function teamScore(color: string): CSSProperties {
  return {
    background: color,
    borderRadius: 5,
    padding: '1px 8px',
    whiteSpace: 'nowrap',
  };
}
const quitButton: CSSProperties = {
  ...pill,
  position: 'absolute',
  top: 10,
  left: 10,
  padding: '5px 10px',
  fontSize: 11,
  fontFamily: HUD_FONT,
  color: '#e8e2d4',
  cursor: 'pointer',
  pointerEvents: 'auto',
};
const netInfoStyle: CSSProperties = {
  ...pill,
  position: 'absolute',
  top: 10,
  right: 10,
  padding: '4px 8px',
  fontSize: 10,
};
const statusPanelStyle: CSSProperties = {
  ...pill,
  position: 'absolute',
  padding: '6px 10px',
  fontSize: 12,
  display: 'flex',
  flexDirection: 'column',
  gap: 5,
};
function barTrack(height: number): CSSProperties {
  return {
    position: 'relative',
    height,
    background: '#1a1a1a',
    borderRadius: height / 2,
    overflow: 'hidden',
    border: '1px solid rgba(255,255,255,0.15)',
  };
}
function barFill(color: string, fraction: number): CSSProperties {
  return {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: `${Math.max(0, Math.min(1, fraction)) * 100}%`,
    background: color,
  };
}
const desktopBarStyle: CSSProperties = {
  position: 'absolute',
  bottom: 14,
  left: '50%',
  transform: 'translateX(-50%)',
  display: 'flex',
  gap: 8,
  alignItems: 'flex-end',
};
function desktopSlot(dim: boolean): CSSProperties {
  return {
    ...pill,
    position: 'relative',
    width: 104,
    padding: '0 0 4px',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 3,
    color: '#fff',
    fontFamily: HUD_FONT,
    cursor: 'pointer',
    pointerEvents: 'auto',
    filter: dim ? 'grayscale(1) brightness(0.6)' : undefined,
  };
}
function slotTop(color: string): CSSProperties {
  return {
    position: 'relative',
    width: '100%',
    height: 38,
    background: color,
    display: 'grid',
    placeItems: 'center',
    fontSize: 11,
    fontWeight: 'bold',
    lineHeight: 1.1,
    textShadow: '0 1px 1px rgba(0,0,0,0.6)',
    overflow: 'hidden',
  };
}
const keyHint: CSSProperties = {
  position: 'absolute',
  top: 2,
  left: 3,
  zIndex: 2,
  fontSize: 9,
  background: '#101216',
  borderRadius: 3,
  padding: '0 3px',
};
function roundButton(size: number, color: string, dim: boolean): CSSProperties {
  return {
    position: 'absolute',
    width: size,
    height: size,
    borderRadius: '50%',
    background: color,
    border: '3px solid rgba(255,255,255,0.85)',
    color: '#fff',
    fontFamily: HUD_FONT,
    fontWeight: 'bold',
    display: 'grid',
    placeItems: 'center',
    textAlign: 'center',
    textShadow: '0 1px 2px rgba(0,0,0,0.7)',
    overflow: 'hidden',
    boxShadow: '0 4px 0 rgba(0,0,0,0.35)',
    pointerEvents: 'auto',
    touchAction: 'none',
    filter: dim ? 'grayscale(1) brightness(0.6)' : undefined,
  };
}
function lockPill(on: boolean): CSSProperties {
  return {
    ...pill,
    position: 'absolute',
    padding: '6px 10px',
    fontSize: 11,
    fontFamily: HUD_FONT,
    color: '#fff',
    background: on ? '#2aa198' : 'rgba(40,44,52,0.85)',
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
  background: 'rgba(255,255,255,0.12)',
  border: '3px solid rgba(255,255,255,0.35)',
  display: 'grid',
  placeItems: 'center',
};
const joystickKnob: CSSProperties = {
  width: 50,
  height: 50,
  borderRadius: '50%',
  background: 'rgba(255,255,255,0.75)',
  boxShadow: '0 4px 8px rgba(0,0,0,0.45)',
};
const joystickHint: CSSProperties = {
  position: 'absolute',
  left: 16,
  bottom: 24,
  fontSize: 10,
  opacity: 0.55,
};
const bannerStyle: CSSProperties = {
  position: 'absolute',
  left: 0,
  right: 0,
  top: '32%',
  textAlign: 'center',
  textShadow: '0 2px 4px rgba(0,0,0,0.7)',
};
const resultsStyle: CSSProperties = {
  position: 'absolute',
  left: '50%',
  top: '50%',
  transform: 'translate(-50%, -50%)',
  width: 'min(92%, 440px)',
  maxHeight: '90%',
  overflowY: 'auto',
  background: 'rgba(16,18,22,0.9)',
  border: '1px solid rgba(255,255,255,0.15)',
  borderRadius: 12,
  padding: 16,
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  pointerEvents: 'auto',
};
const cell: CSSProperties = {
  padding: '4px 6px',
  textAlign: 'right',
  borderBottom: '1px solid rgba(255,255,255,0.12)',
};
const cellLeft: CSSProperties = { ...cell, textAlign: 'left' };
const primaryButton: CSSProperties = {
  padding: '10px 22px',
  fontSize: 13,
  fontFamily: HUD_FONT,
  fontWeight: 'bold',
  color: PRIMARY_TEXT,
  background: PRIMARY,
  border: 'none',
  borderRadius: 6,
  cursor: 'pointer',
};
const secondaryButton: CSSProperties = {
  ...primaryButton,
  background: '#2a2e36',
  color: '#fff',
};
