import type { MatchConfig, MoveDefinition, PokemonInstance, PokemonTypeName, SimEvent, SimState, StageKey, Vec2 } from '../types';
import type { MoveLookup, SpeciesData } from '../matchSetup';
import { createMatch } from '../matchSetup';
import type { EngineLike } from '../engineLike';
import { eventsAfter } from '../events';
import { createRng, rngChance, type Rng } from '../rng';
import type { CrowdCardId } from '../../net/play/playProtocol';
import { clampToArenaBounds, getPlayableBounds, resolveCollisions, velocityToFacing } from '../movement';
import { resolveDamage } from '../damage';
import { applyStatus, canApplyStatus, gateAction, isIncapacitatingStatus, maybeThawOnFireHit, tickStatusDamage } from '../statusEffects';
import { createNeutralStages } from '../statCalc';
import { BotBrain } from './bot';
import * as R from './rules';
import { moveKind, type MoveKind } from './rules';

/** Play Mode's per-fighter state that the spectator SimState has no room for. */
export interface FighterState {
  lives: number;
  energy: number;
  /** ms left on each move slot's own cooldown. */
  cooldowns: number[];
  globalCooldownMs: number;
  dashCharges: number;
  /** Progress (ms) toward the next dash charge; charges refill one at a time. */
  dashRechargeMs: number;
  dashMs: number;
  invulnMs: number;
  knockback: Vec2;
  /** The stick/WASD direction, length ≤ 1. */
  moveInput: Vec2;
  aimFacingMs: number;
  statusTurnMs: number;
  /** When a KO'd fighter with lives left comes back; null while alive or out for good. */
  respawnAtMs: number | null;
  spawn: Vec2;
  kos: number;
  damageDealt: number;
  /** Crowd Call buffs: ms left on a speed burst / an unused shield. */
  speedMs: number;
  shieldMs: number;
}

/** A Crowd Call supply crate: heals the first fighter of `team` to touch it. */
export interface Pickup {
  id: number;
  team: string;
  position: Vec2;
  expiresAtMs: number;
}

export interface Projectile {
  id: number;
  ownerId: string;
  team: string;
  moveId: number;
  type: PokemonTypeName;
  position: Vec2;
  velocity: Vec2;
  travelled: number;
  range: number;
  radius: number;
}

export type ActionEvent =
  | {
      seq: number;
      atMs: number;
      type: 'fired';
      attackerId: string;
      moveId: number;
      kind: MoveKind;
      origin: Vec2;
      aim: Vec2;
      failed: boolean;
      /** The shot this fired, for kinds that fly (physical/ranged) — lets the renderer track it. */
      projectileId: number | null;
    }
  | {
      seq: number;
      atMs: number;
      type: 'hit';
      attackerId: string;
      targetId: string;
      moveId: number;
      damage: number;
      crit: boolean;
      effectiveness: number;
      position: Vec2;
      direction: Vec2;
      /** The shove the target took — an online client applies it to the fighter it moves itself. */
      knockback: Vec2;
      /** A Crowd Call shield ate the hit: no damage, no shove. */
      blocked?: true;
    }
  | { seq: number; atMs: number; type: 'dashed'; instanceId: string; from: Vec2; direction: Vec2 }
  | { seq: number; atMs: number; type: 'ko'; instanceId: string; byInstanceId: string | null; livesLeft: number }
  | { seq: number; atMs: number; type: 'respawned'; instanceId: string }
  /** A spectator's shop item landed (see game-server/playRooms.ts). */
  | { seq: number; atMs: number; type: 'item'; instanceId: string; effect: 'heal' | 'revive'; amount: number; buyerName: string }
  /** A Crowd Call landed on every living fighter of `team`. */
  | { seq: number; atMs: number; type: 'crowdCall'; team: string; card: CrowdCardId; housePick: boolean }
  | { seq: number; atMs: number; type: 'pickupSpawned'; pickupId: number; team: string; position: Vec2 }
  | { seq: number; atMs: number; type: 'pickupTaken'; pickupId: number; instanceId: string; amount: number };

/** What an online client needs of one fighter, 20 times a second. */
export interface FighterSnapshot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: PokemonInstance['facing'];
  aiState: PokemonInstance['aiState'];
  hp: number;
  status: PokemonInstance['status'];
  lastHitAtMs: number | null;
  lives: number;
  energy: number;
  cooldowns: number[];
  globalCooldownMs: number;
  dashCharges: number;
  dashRechargeMs: number;
  invulnMs: number;
  respawnAtMs: number | null;
  kos: number;
  damageDealt: number;
  speedMs: number;
  shieldMs: number;
}

/** The server's whole-match broadcast (see snapshot()). `events` are the
 * action events since the previous broadcast. */
export interface ActionSnapshot {
  elapsedMs: number;
  phase: SimState['phase'];
  livingOrder: string[];
  eliminationOrder: string[];
  winnerInstanceIds: string[];
  fighters: Record<string, FighterSnapshot>;
  projectiles: Projectile[];
  pickups: Pickup[];
  events: ActionEvent[];
}

export interface ActionEngineOptions {
  /** false = nobody is bot-driven (tests, and an online client's local mirror). */
  bots?: boolean;
  /** Fighters a person controls — never bot-driven. Default: just playerId. */
  humanIds?: string[];
  /** Online server: humans move on their own screens and report where they
   * are (reportMovement) instead of being integrated here. */
  reportedMovement?: boolean;
  /** Whose view this engine is — default speciesIds[0]. */
  playerId?: string;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

const ZERO: Vec2 = { x: 0, y: 0 };
const DIAGONAL = Math.SQRT1_2;
const FACING_VECTORS: Record<PokemonInstance['facing'], Vec2> = {
  N: { x: 0, y: -1 },
  S: { x: 0, y: 1 },
  E: { x: 1, y: 0 },
  W: { x: -1, y: 0 },
  NE: { x: DIAGONAL, y: -DIAGONAL },
  NW: { x: -DIAGONAL, y: -DIAGONAL },
  SE: { x: DIAGONAL, y: DIAGONAL },
  SW: { x: -DIAGONAL, y: DIAGONAL },
};

const EIGHT_WAY: readonly PokemonInstance['facing'][] = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'];

export function facingVector(facing: PokemonInstance['facing']): Vec2 {
  return FACING_VECTORS[facing];
}

export function isFacing(value: unknown): value is PokemonInstance['facing'] {
  return typeof value === 'string' && value in FACING_VECTORS;
}

/** Nearest compass direction, no hysteresis — firing should snap the body to the aim. */
function facingOf(v: Vec2): PokemonInstance['facing'] {
  const angle = (Math.atan2(v.y, v.x) + Math.PI * 2) % (Math.PI * 2);
  return EIGHT_WAY[Math.round(angle / (Math.PI / 4)) % 8];
}

/**
 * Play Mode: one human-controlled fighter (speciesIds[0]) plus bots, in real
 * time. Reuses the spectator sim's match setup, damage formula and status
 * rules, but replaces its AI pacing (attack gate, hold windows, PP) with
 * direct control: momentum movement, dashes, energy, per-move cooldowns,
 * free-aimed projectiles and lives. Implements EngineLike so the existing
 * HUD pieces and sprites can read its SimState unchanged.
 */
export class ActionEngine implements EngineLike {
  readonly playerId: string;
  protected readonly state: SimState;
  protected readonly fighters: Record<string, FighterState> = {};
  private readonly bots: BotBrain[] = [];
  protected projectiles: Projectile[] = [];
  protected pickups: Pickup[] = [];
  private nextPickupId = 1;
  private readonly events: SimEvent[] = [];
  protected readonly actionEvents: ActionEvent[] = [];
  private seq = 0;
  private nextProjectileId = 1;
  private readonly rng: Rng;
  private readonly moves: MoveLookup;
  private accumulatorMs = 0;
  private readonly reportedMovers: Set<string>;
  private readonly lastReportAtMs = new Map<string, number>();

  constructor(
    config: MatchConfig,
    species: Record<number, SpeciesData>,
    moves: MoveLookup,
    seed: number,
    options: ActionEngineOptions = {}
  ) {
    this.rng = createRng(seed);
    this.moves = moves;
    this.state = createMatch(config, species, moves, this.rng);
    this.playerId = options.playerId ?? this.state.allInstanceIds[0];
    const humans = new Set(options.humanIds ?? [this.playerId]);
    this.reportedMovers = options.reportedMovement ? humans : new Set();

    for (const id of this.state.allInstanceIds) {
      const p = this.state.pokemon[id];
      p.maxHp *= R.HP_MULTIPLIER;
      p.currentHp = p.maxHp;
      p.aiState = 'attack';
      this.fighters[id] = {
        lives: R.LIVES,
        energy: R.ENERGY_MAX,
        cooldowns: p.moves.map(() => 0),
        globalCooldownMs: 0,
        dashCharges: R.DASH_CHARGES,
        dashRechargeMs: 0,
        dashMs: 0,
        invulnMs: 0,
        knockback: { x: 0, y: 0 },
        moveInput: { x: 0, y: 0 },
        aimFacingMs: 0,
        statusTurnMs: 0,
        respawnAtMs: null,
        spawn: { ...p.position },
        kos: 0,
        damageDealt: 0,
        speedMs: 0,
        shieldMs: 0,
      };
      if (options.bots !== false && !humans.has(id)) this.bots.push(new BotBrain(id, createRng(seed + this.bots.length + 1)));
    }
    this.events.push({ seq: this.nextSeq(), atMs: 0, type: 'milestone', kind: 'matchStart' });
  }

  getState(): Readonly<SimState> {
    return this.state;
  }

  getEventsSince(seq: number): SimEvent[] {
    return eventsAfter(this.events, seq);
  }

  getActionEventsSince(seq: number): ActionEvent[] {
    return eventsAfter(this.actionEvents, seq);
  }

  getFighter(id: string): Readonly<FighterState> {
    return this.fighters[id];
  }

  getProjectiles(): readonly Projectile[] {
    return this.projectiles;
  }

  getPickups(): readonly Pickup[] {
    return this.pickups;
  }

  getMove(moveId: number): MoveDefinition | undefined {
    return this.moves(moveId);
  }

  isAlive(id: string): boolean {
    return this.state.livingOrder.includes(id);
  }

  /** The other side's fighters currently on the field. */
  enemiesOf(id: string): PokemonInstance[] {
    const team = this.state.pokemon[id].team;
    return this.state.livingOrder.map((other) => this.state.pokemon[other]).filter((p) => p.team !== team);
  }

  endMatchNow(): void {
    if (this.state.phase !== 'complete') this.finishByScore();
  }

  tick(dtMs: number): void {
    if (this.finished) return;
    // Solo play only: a backgrounded tab simply pauses the fight rather than
    // fast-forwarding through it.
    this.accumulatorMs += Math.min(dtMs, 250);
    while (this.accumulatorMs >= R.ACTION_TICK_MS && !this.finished) {
      this.accumulatorMs -= R.ACTION_TICK_MS;
      this.stepOnce();
    }
  }

  get finished(): boolean {
    return this.state.phase === 'complete';
  }

  setMoveInput(id: string, x: number, y: number): void {
    const f = this.fighters[id];
    if (!f) return;
    const len = Math.hypot(x, y);
    f.moveInput = len > 1 ? { x: x / len, y: y / len } : { x, y };
  }

  canFire(id: string, slot: number): boolean {
    const self = this.state.pokemon[id];
    const f = this.fighters[id];
    const move = self?.moves[slot] && this.moves(self.moves[slot].moveId);
    if (!move || this.state.phase !== 'battle' || !this.isAlive(id)) return false;
    if (isIncapacitatingStatus(self.status)) return false;
    return f.cooldowns[slot] <= 0 && f.globalCooldownMs <= 0 && f.energy >= R.moveEnergyCost(move.pp);
  }

  /** Fires slot `slot` toward world point `aim` (a self move ignores it).
   * Runs immediately, between ticks, like the spectator engine's shop calls. */
  fire(id: string, slot: number, aim: Vec2): boolean {
    if (!this.canFire(id, slot)) return false;
    const self = this.state.pokemon[id];
    const f = this.fighters[id];
    const move = this.moves(self.moves[slot].moveId)!;
    f.energy -= R.moveEnergyCost(move.pp);
    f.cooldowns[slot] = R.moveCooldownMs(move.pp);
    f.globalCooldownMs = R.GLOBAL_COOLDOWN_MS;

    const kind = moveKind(move);
    const origin = { ...self.position };
    const dir = this.aimDirection(self, aim);
    if (kind !== 'self') {
      self.facing = facingOf(dir);
      f.aimFacingMs = R.AIM_FACING_MS;
    }

    // Paralysis can still lock up a move, as in the spectator sim; the cost is paid either way.
    const failed = self.status === 'paralysis' && !gateAction(self, this.rng).canAct;
    const flies = !failed && (kind === 'physical' || kind === 'ranged');
    const projectileId = flies ? this.nextProjectileId++ : null;
    this.pushAction({ type: 'fired', attackerId: id, moveId: move.id, kind, origin, aim: { ...aim }, failed, projectileId });
    if (failed) return true;

    if (kind === 'self') {
      this.applyMoveEffect(move, self, self);
    } else if (kind === 'aoe') {
      for (const target of this.enemiesOf(id)) {
        if (!this.isHittable(target)) continue;
        const dx = target.position.x - self.position.x;
        const dy = target.position.y - self.position.y;
        const d = Math.hypot(dx, dy);
        if (d > R.AOE_RADIUS + target.collisionRadius) continue;
        this.applyHit(self, target, move, d > 1e-6 ? { x: dx / d, y: dy / d } : dir, { ...target.position });
      }
    } else {
      const spec = kind === 'physical' ? R.PROJECTILE.physical : R.PROJECTILE.ranged;
      const startOffset = self.collisionRadius * 0.6;
      this.projectiles.push({
        id: projectileId!,
        ownerId: id,
        team: self.team,
        moveId: move.id,
        type: move.type,
        position: { x: origin.x + dir.x * startOffset, y: origin.y + dir.y * startOffset },
        velocity: { x: dir.x * spec.speed, y: dir.y * spec.speed },
        travelled: 0,
        range: spec.range,
        radius: spec.radius,
      });
    }

    if (move.userFaints) {
      self.currentHp = 0;
      self.lastDamagedByInstanceId = id;
    }
    return true;
  }

  /** Dashes along the move input, or the way the fighter faces when standing still. */
  dash(id: string): boolean {
    const self = this.state.pokemon[id];
    const f = this.fighters[id];
    if (!self || this.state.phase !== 'battle' || !this.isAlive(id)) return false;
    if (isIncapacitatingStatus(self.status) || f.dashCharges <= 0 || f.dashMs > 0) return false;
    const len = Math.hypot(f.moveInput.x, f.moveInput.y);
    const dir = len > 0.1 ? { x: f.moveInput.x / len, y: f.moveInput.y / len } : FACING_VECTORS[self.facing];
    self.velocity = { x: dir.x * R.DASH_SPEED, y: dir.y * R.DASH_SPEED };
    f.dashMs = R.DASH_MS;
    f.invulnMs = Math.max(f.invulnMs, R.DASH_INVULN_MS);
    f.dashCharges -= 1;
    this.pushAction({ type: 'dashed', instanceId: id, from: { ...self.position }, direction: dir });
    return true;
  }

  /** Online server: where a human's own screen says it is. Accepted only as
   * far as it could legally have got since its last report — a dash plus a
   * hard knockback, with some slack for network bunching — so a tampered
   * client can't teleport. Hits, damage and lives stay server-side. */
  reportMovement(id: string, position: Vec2, velocity: Vec2, facing: PokemonInstance['facing']): void {
    if (!this.reportedMovers.has(id) || this.state.phase !== 'battle' || !this.isAlive(id)) return;
    const self = this.state.pokemon[id];
    if (isIncapacitatingStatus(self.status)) return;
    const now = this.state.elapsedMs;
    const sinceSec = Math.max(R.ACTION_TICK_MS, now - (this.lastReportAtMs.get(id) ?? now - 100)) / 1000;
    this.lastReportAtMs.set(id, now);
    const burst = this.fighters[id].speedMs > 0 ? R.MAX_SPEED * (R.CROWD_SPEED_MULT - 1) : 0;
    const maxStep = (R.DASH_SPEED + R.KNOCKBACK_PHYSICAL * 1.5 + burst) * sinceSec + 40;
    const dx = position.x - self.position.x;
    const dy = position.y - self.position.y;
    const d = Math.hypot(dx, dy);
    const t = d > maxStep ? maxStep / d : 1;
    const next = clampToArenaBounds({ x: self.position.x + dx * t, y: self.position.y + dy * t }, this.state.arena);
    self.position.x = next.x;
    self.position.y = next.y;
    const speed = Math.hypot(velocity.x, velocity.y);
    const cap = speed > R.DASH_SPEED ? R.DASH_SPEED / speed : 1;
    self.velocity = { x: velocity.x * cap, y: velocity.y * cap };
    self.facing = facing;
    self.aiState = speed > R.WALK_THRESHOLD ? 'chase' : 'attack';
  }

  /** A spectator's purchase. Heal: restores `fraction` of max HP to a fighter
   * on the field. Revive: a fighter waiting to respawn comes back now (a
   * fighter out of lives can't be revived). Returns the HP restored, or null
   * when it can't apply — nothing is charged then. */
  useItem(id: string, effect: 'heal' | 'revive', fraction: number, buyerName: string): number | null {
    const p = this.state.pokemon[id];
    const f = this.fighters[id];
    if (!p || !f || this.state.phase !== 'battle') return null;
    let amount: number;
    if (effect === 'revive') {
      if (f.respawnAtMs === null) return null;
      this.respawn(id);
      // Back now, but at the item's share of HP rather than a fresh respawn's full bar.
      amount = Math.max(1, Math.round(p.maxHp * fraction));
      p.currentHp = amount;
    } else {
      if (!this.isAlive(id)) return null;
      amount = Math.min(p.maxHp - p.currentHp, Math.round(p.maxHp * fraction));
      if (amount <= 0) return null;
      p.currentHp += amount;
    }
    this.pushAction({ type: 'item', instanceId: id, effect, amount, buyerName });
    return amount;
  }

  /** A Crowd Call's winning card, on every living fighter of `team` (supply drops one crate for the side). */
  applyCrowdCard(team: string, card: CrowdCardId, housePick = false): void {
    if (this.state.phase !== 'battle') return;
    const side = this.state.livingOrder.filter((id) => this.state.pokemon[id].team === team);
    for (const id of side) {
      const f = this.fighters[id];
      if (card === 'speed') f.speedMs = R.CROWD_SPEED_MS;
      else if (card === 'shield') f.shieldMs = R.CROWD_SHIELD_MS;
      else if (card === 'energy') f.energy = R.ENERGY_MAX;
    }
    this.pushAction({ type: 'crowdCall', team, card, housePick });
    if (card === 'supply') this.spawnSupply(team);
  }

  /** A random spot on `team`'s half of the court — the half its spawn points sit in. */
  private spawnSupply(team: string): void {
    const b = getPlayableBounds(this.state.arena);
    const centroid = (mine: boolean): Vec2 => {
      const spawns = this.state.allInstanceIds
        .filter((id) => (this.state.pokemon[id].team === team) === mine)
        .map((id) => this.fighters[id].spawn);
      const n = Math.max(1, spawns.length);
      return { x: spawns.reduce((a, s) => a + s.x, 0) / n, y: spawns.reduce((a, s) => a + s.y, 0) / n };
    };
    const own = centroid(true);
    const other = centroid(false);
    const midX = (b.minX + b.maxX) / 2;
    const midY = (b.minY + b.maxY) / 2;
    let x = b.minX + this.rng() * (b.maxX - b.minX);
    let y = b.minY + this.rng() * (b.maxY - b.minY);
    // Split along whichever axis the two sides' spawns are further apart on.
    if (Math.abs(own.y - other.y) >= Math.abs(own.x - other.x)) y = own.y < midY ? b.minY + (y - b.minY) / 2 : midY + (y - b.minY) / 2;
    else x = own.x < midX ? b.minX + (x - b.minX) / 2 : midX + (x - b.minX) / 2;
    const pickup: Pickup = { id: this.nextPickupId++, team, position: { x, y }, expiresAtMs: this.state.elapsedMs + R.SUPPLY_TTL_MS };
    this.pickups.push(pickup);
    this.pushAction({ type: 'pickupSpawned', pickupId: pickup.id, team, position: { ...pickup.position } });
  }

  private stepPickups(nowMs: number): void {
    if (this.pickups.length === 0) return;
    this.pickups = this.pickups.filter((pickup) => {
      if (nowMs >= pickup.expiresAtMs) return false;
      for (const id of this.state.livingOrder) {
        const p = this.state.pokemon[id];
        // A fighter at full HP walks over it, leaving it for a hurt teammate.
        if (p.team !== pickup.team || p.currentHp <= 0 || p.currentHp >= p.maxHp) continue;
        if (Math.hypot(p.position.x - pickup.position.x, p.position.y - pickup.position.y) > p.collisionRadius + R.SUPPLY_RADIUS) continue;
        const amount = Math.min(p.maxHp - p.currentHp, Math.round(p.maxHp * R.SUPPLY_HEAL_FRACTION));
        p.currentHp += amount;
        this.pushAction({ type: 'pickupTaken', pickupId: pickup.id, instanceId: id, amount });
        return false;
      }
      return true;
    });
  }

  /** A player who left: out of the match for good, whatever lives they had. */
  eliminate(id: string): void {
    const f = this.fighters[id];
    if (!f || f.lives <= 0 || this.state.phase === 'complete') return;
    if (this.isAlive(id)) {
      f.lives = 1;
      this.state.pokemon[id].currentHp = 0;
      this.state.pokemon[id].lastDamagedByInstanceId = id;
      return; // swept on the next tick like any other faint
    }
    f.lives = 0;
    f.respawnAtMs = null;
    this.state.eliminationOrder.push(id);
    this.events.push({ seq: this.nextSeq(), atMs: this.state.elapsedMs, type: 'fainted', instanceId: id, byInstanceId: id });
    this.checkWin();
  }

  /** The state an online client renders, plus the action events after `sinceSeq`. */
  snapshot(sinceSeq: number): ActionSnapshot {
    const fighters: Record<string, FighterSnapshot> = {};
    for (const id of this.state.allInstanceIds) {
      const p = this.state.pokemon[id];
      const f = this.fighters[id];
      fighters[id] = {
        x: round1(p.position.x),
        y: round1(p.position.y),
        vx: round1(p.velocity.x),
        vy: round1(p.velocity.y),
        facing: p.facing,
        aiState: p.aiState,
        hp: p.currentHp,
        status: p.status,
        lastHitAtMs: p.lastHitAtMs ?? null,
        lives: f.lives,
        energy: round1(f.energy),
        cooldowns: f.cooldowns.map(Math.round),
        globalCooldownMs: Math.round(f.globalCooldownMs),
        dashCharges: f.dashCharges,
        dashRechargeMs: Math.round(f.dashRechargeMs),
        invulnMs: Math.round(f.invulnMs),
        respawnAtMs: f.respawnAtMs,
        kos: f.kos,
        damageDealt: f.damageDealt,
        speedMs: Math.round(f.speedMs),
        shieldMs: Math.round(f.shieldMs),
      };
    }
    return {
      elapsedMs: this.state.elapsedMs,
      phase: this.state.phase,
      livingOrder: [...this.state.livingOrder],
      eliminationOrder: [...this.state.eliminationOrder],
      winnerInstanceIds: [...this.state.winnerInstanceIds],
      fighters,
      projectiles: this.projectiles.map((p) => ({
        ...p,
        position: { x: round1(p.position.x), y: round1(p.position.y) },
        velocity: { x: round1(p.velocity.x), y: round1(p.velocity.y) },
      })),
      pickups: this.pickups.map((p) => ({ ...p, position: { ...p.position } })),
      events: this.getActionEventsSince(sinceSeq),
    };
  }

  /** The latest action event's seq — where the next snapshot's events start. */
  lastActionSeq(): number {
    return this.actionEvents.at(-1)?.seq ?? 0;
  }

  private nextSeq(): number {
    this.seq += 1;
    return this.seq;
  }

  private pushAction(event: DistributiveOmit<ActionEvent, 'seq' | 'atMs'>): void {
    this.actionEvents.push({ ...event, seq: this.nextSeq(), atMs: this.state.elapsedMs } as ActionEvent);
  }

  private aimDirection(self: PokemonInstance, aim: Vec2): Vec2 {
    const dx = aim.x - self.position.x;
    const dy = aim.y - self.position.y;
    const d = Math.hypot(dx, dy);
    return d > 1 ? { x: dx / d, y: dy / d } : FACING_VECTORS[self.facing];
  }

  private isHittable(p: PokemonInstance): boolean {
    return p.currentHp > 0 && this.fighters[p.instanceId].invulnMs <= 0 && this.isAlive(p.instanceId);
  }

  private stepOnce(): void {
    this.state.tick += 1;
    this.state.elapsedMs += R.ACTION_TICK_MS;
    const nowMs = this.state.elapsedMs;

    if (nowMs >= R.ACTION_MATCH_LIMIT_MS) {
      this.finishByScore();
      return;
    }
    if (this.state.phase === 'intro') {
      if (nowMs >= this.state.introDurationMs) this.state.phase = 'battle';
      return;
    }

    for (const id of this.state.allInstanceIds) {
      const at = this.fighters[id].respawnAtMs;
      if (at !== null && nowMs >= at) this.respawn(id);
    }
    for (const bot of this.bots) bot.think(this, nowMs);

    const dtSec = R.ACTION_TICK_MS / 1000;
    for (const id of this.state.livingOrder) {
      const self = this.state.pokemon[id];
      this.stepTimers(self, this.fighters[id]);
      if (!this.reportedMovers.has(id)) this.stepMovement(self, this.fighters[id], dtSec);
    }
    resolveCollisions(this.state.livingOrder, this.state.pokemon, this.state.arena);
    this.stepProjectiles(dtSec);
    this.stepPickups(nowMs);

    for (const id of this.state.livingOrder) {
      const self = this.state.pokemon[id];
      if (self.currentHp <= 0) continue;
      const { event, damage } = tickStatusDamage(self, R.ACTION_TICK_MS, () => this.nextSeq(), nowMs);
      if (event) this.events.push(event);
      if (damage > 0) self.currentHp = Math.max(0, self.currentHp - damage);
    }

    this.sweepFaints(nowMs);
    this.checkWin();
  }

  protected stepTimers(self: PokemonInstance, f: FighterState): void {
    const dt = R.ACTION_TICK_MS;
    f.cooldowns = f.cooldowns.map((ms) => Math.max(0, ms - dt));
    f.globalCooldownMs = Math.max(0, f.globalCooldownMs - dt);
    f.invulnMs = Math.max(0, f.invulnMs - dt);
    f.aimFacingMs = Math.max(0, f.aimFacingMs - dt);
    f.speedMs = Math.max(0, f.speedMs - dt);
    f.shieldMs = Math.max(0, f.shieldMs - dt);
    f.energy = Math.min(R.ENERGY_MAX, f.energy + (R.ENERGY_REGEN_PER_SEC * dt) / 1000);
    if (f.dashCharges < R.DASH_CHARGES) {
      f.dashRechargeMs += dt;
      if (f.dashRechargeMs >= R.DASH_RECHARGE_MS) {
        f.dashCharges += 1;
        f.dashRechargeMs = 0;
      }
    }
    if (isIncapacitatingStatus(self.status)) {
      f.statusTurnMs -= dt;
      if (f.statusTurnMs <= 0) {
        const gate = gateAction(self, this.rng);
        if (gate.clearedStatus) {
          this.events.push({
            seq: this.nextSeq(),
            atMs: this.state.elapsedMs,
            type: 'statusCleared',
            instanceId: self.instanceId,
            status: gate.clearedStatus,
          });
        }
        f.statusTurnMs = R.ACTION_STATUS_TURN_MS;
      }
    }
  }

  protected stepMovement(self: PokemonInstance, f: FighterState, dtSec: number): void {
    const input = isIncapacitatingStatus(self.status) ? ZERO : f.moveInput;
    const v = self.velocity;
    if (f.dashMs > 0) {
      f.dashMs -= R.ACTION_TICK_MS;
    } else {
      const max = R.MAX_SPEED * (self.status === 'paralysis' ? R.PARALYSIS_MOVE_MULT : 1) * (f.speedMs > 0 ? R.CROWD_SPEED_MULT : 1);
      const moving = input.x !== 0 || input.y !== 0;
      const a = Math.min(1, (moving ? R.ACCEL_RATE : R.FRICTION_RATE) * dtSec);
      v.x += (input.x * max - v.x) * a;
      v.y += (input.y * max - v.y) * a;
      const speed = Math.hypot(v.x, v.y);
      if (speed > max) {
        v.x *= max / speed;
        v.y *= max / speed;
      }
    }

    const kb = f.knockback;
    const target = {
      x: self.position.x + (v.x + kb.x) * dtSec,
      y: self.position.y + (v.y + kb.y) * dtSec,
    };
    const decay = Math.exp(-R.KNOCKBACK_DECAY_RATE * dtSec);
    kb.x *= decay;
    kb.y *= decay;
    const clamped = clampToArenaBounds(target, this.state.arena);
    // The fence stops you dead on that axis.
    if (clamped.x !== target.x) v.x = kb.x = 0;
    if (clamped.y !== target.y) v.y = kb.y = 0;
    self.position.x = clamped.x;
    self.position.y = clamped.y;

    const speed = Math.hypot(v.x, v.y);
    if (f.aimFacingMs <= 0 && speed > R.WALK_THRESHOLD) self.facing = velocityToFacing(v, self.facing);
    // 'chase' plays Walk and 'attack' with no target plays Idle in PokemonSprite.
    self.aiState = speed > R.WALK_THRESHOLD ? 'chase' : 'attack';
    self.targetInstanceId = null;
  }

  private stepProjectiles(dtSec: number): void {
    const kept: Projectile[] = [];
    for (const p of this.projectiles) {
      const from = p.position;
      const to = { x: from.x + p.velocity.x * dtSec, y: from.y + p.velocity.y * dtSec };
      const hit = this.firstHitAlong(p, from, to);
      if (hit) {
        const owner = this.state.pokemon[p.ownerId];
        const move = this.moves(p.moveId);
        const speed = Math.hypot(p.velocity.x, p.velocity.y);
        if (move) this.applyHit(owner, hit.target, move, { x: p.velocity.x / speed, y: p.velocity.y / speed }, hit.point);
        continue;
      }
      p.position = to;
      p.travelled += Math.hypot(to.x - from.x, to.y - from.y);
      if (p.travelled < p.range) kept.push(p);
    }
    this.projectiles = kept;
  }

  /** The enemy a projectile's swept segment touches first, if any. */
  private firstHitAlong(p: Projectile, from: Vec2, to: Vec2): { target: PokemonInstance; point: Vec2 } | null {
    const sx = to.x - from.x;
    const sy = to.y - from.y;
    const segLenSq = sx * sx + sy * sy || 1e-9;
    let best: { target: PokemonInstance; point: Vec2; t: number } | null = null;
    for (const id of this.state.livingOrder) {
      const target = this.state.pokemon[id];
      if (target.team === p.team || !this.isHittable(target)) continue;
      const t = Math.max(0, Math.min(1, ((target.position.x - from.x) * sx + (target.position.y - from.y) * sy) / segLenSq));
      const point = { x: from.x + sx * t, y: from.y + sy * t };
      const d = Math.hypot(target.position.x - point.x, target.position.y - point.y);
      if (d <= target.collisionRadius + p.radius && (!best || t < best.t)) best = { target, point, t };
    }
    return best;
  }

  private applyHit(attacker: PokemonInstance, target: PokemonInstance, move: MoveDefinition, direction: Vec2, position: Vec2): void {
    const shielded = this.fighters[target.instanceId];
    if (shielded.shieldMs > 0) {
      shielded.shieldMs = 0;
      this.pushAction({
        type: 'hit',
        attackerId: attacker.instanceId,
        targetId: target.instanceId,
        moveId: move.id,
        damage: 0,
        crit: false,
        effectiveness: 1,
        position,
        direction,
        knockback: { x: 0, y: 0 },
        blocked: true,
      });
      return;
    }
    // Aim is the accuracy check: a projectile that connects always hits.
    const result = resolveDamage(this.rng, { ...move, accuracy: null }, attacker, target);
    let damage = 0;
    const shoveVec = { x: 0, y: 0 };
    if (result.effectiveness !== 0) {
      damage = result.damage;
      if (damage > 0) {
        target.currentHp = Math.max(0, target.currentHp - damage);
        target.lastHitAtMs = this.state.elapsedMs;
        target.lastDamagedByInstanceId = attacker.instanceId;
        this.fighters[attacker.instanceId].damageDealt += damage;
        const shove = (move.category === 'physical' ? R.KNOCKBACK_PHYSICAL : R.KNOCKBACK_SPECIAL) * (result.crit ? 1.5 : 1);
        shoveVec.x = direction.x * shove;
        shoveVec.y = direction.y * shove;
        const kb = this.fighters[target.instanceId].knockback;
        kb.x += shoveVec.x;
        kb.y += shoveVec.y;
      }
      if (maybeThawOnFireHit(target, move.type === 'fire' && !move.typeless)) {
        this.events.push({
          seq: this.nextSeq(),
          atMs: this.state.elapsedMs,
          type: 'statusCleared',
          instanceId: target.instanceId,
          status: 'freeze',
        });
      }
      this.applyMoveEffect(move, attacker, target);
    }
    this.pushAction({
      type: 'hit',
      attackerId: attacker.instanceId,
      targetId: target.instanceId,
      moveId: move.id,
      damage,
      crit: result.crit,
      effectiveness: result.effectiveness,
      position,
      direction,
      knockback: shoveVec,
    });
  }

  /** Same secondary-effect rules as the spectator engine's applyMoveEffect. */
  private applyMoveEffect(move: MoveDefinition, attacker: PokemonInstance, target: PokemonInstance): void {
    const effect = move.effect;
    if (!effect || !rngChance(this.rng, (effect.chance ?? 100) / 100)) return;
    const recipient = effect.target === 'self' ? attacker : target;
    if (effect.kind === 'statusInflict' && effect.status) {
      if (!canApplyStatus(recipient, effect.status)) return;
      applyStatus(recipient, effect.status, this.rng);
      if (isIncapacitatingStatus(effect.status)) this.fighters[recipient.instanceId].statusTurnMs = R.ACTION_STATUS_TURN_MS;
      this.events.push({
        seq: this.nextSeq(),
        atMs: this.state.elapsedMs,
        type: 'statusApplied',
        instanceId: recipient.instanceId,
        status: effect.status,
      });
    } else if (effect.kind === 'statStage' && effect.statChanges) {
      for (const [key, delta] of Object.entries(effect.statChanges) as [StageKey, number][]) {
        recipient.statStages[key] = Math.max(-6, Math.min(6, recipient.statStages[key] + delta));
      }
    }
  }

  private sweepFaints(nowMs: number): void {
    const down = this.state.livingOrder.filter((id) => this.state.pokemon[id].currentHp <= 0);
    if (down.length === 0) return;
    this.state.livingOrder = this.state.livingOrder.filter((id) => !down.includes(id));
    for (const id of down) {
      const p = this.state.pokemon[id];
      const f = this.fighters[id];
      f.lives -= 1;
      p.aiState = 'fainted';
      p.velocity = { x: 0, y: 0 };
      f.knockback = { x: 0, y: 0 };
      f.moveInput = { x: 0, y: 0 };
      const by = p.lastDamagedByInstanceId ?? null;
      if (by && by !== id && this.state.pokemon[by].team !== p.team) this.fighters[by].kos += 1;
      if (f.lives > 0) {
        f.respawnAtMs = nowMs + R.RESPAWN_DELAY_MS;
      } else {
        this.state.eliminationOrder.push(id);
        this.events.push({ seq: this.nextSeq(), atMs: nowMs, type: 'fainted', instanceId: id, byInstanceId: by });
      }
      this.pushAction({ type: 'ko', instanceId: id, byInstanceId: by, livesLeft: f.lives });
    }
  }

  private respawn(id: string): void {
    const p = this.state.pokemon[id];
    const f = this.fighters[id];
    p.currentHp = p.maxHp;
    p.status = null;
    p.statusTurnsRemaining = undefined;
    p.statusTickAccumMs = 0;
    p.statStages = createNeutralStages();
    p.position = { ...f.spawn };
    p.velocity = { x: 0, y: 0 };
    p.aiState = 'attack';
    p.lastDamagedByInstanceId = undefined;
    p.lastHitAtMs = undefined;
    Object.assign(f, {
      energy: R.ENERGY_MAX,
      cooldowns: f.cooldowns.map(() => 0),
      globalCooldownMs: 0,
      dashCharges: R.DASH_CHARGES,
      dashRechargeMs: 0,
      dashMs: 0,
      invulnMs: R.SPAWN_SHIELD_MS,
      knockback: { x: 0, y: 0 },
      respawnAtMs: null,
      speedMs: 0,
      shieldMs: 0,
    });
    const living = new Set([...this.state.livingOrder, id]);
    this.state.livingOrder = this.state.allInstanceIds.filter((other) => living.has(other));
    this.pushAction({ type: 'respawned', instanceId: id });
  }

  /** Ends the match once at most one side still has anyone on the field or waiting to respawn. */
  private checkWin(): void {
    const sides = new Set<string>();
    for (const id of this.state.allInstanceIds) {
      if (this.isAlive(id) || this.fighters[id].respawnAtMs !== null) sides.add(this.state.pokemon[id].team);
    }
    if (sides.size <= 1) this.complete([...sides]);
  }

  /** Time's up (or End Match): most lives left wins, remaining HP breaks ties. */
  private finishByScore(): void {
    const scores = new Map<string, number>();
    for (const id of this.state.allInstanceIds) {
      const p = this.state.pokemon[id];
      const f = this.fighters[id];
      const hpShare = this.isAlive(id) ? p.currentHp / p.maxHp : 0;
      scores.set(p.team, (scores.get(p.team) ?? 0) + f.lives + hpShare * 0.99);
    }
    const best = Math.max(...scores.values());
    this.complete([...scores].filter(([, score]) => score === best).map(([team]) => team));
  }

  private complete(winningTeams: string[]): void {
    this.state.phase = 'complete';
    this.state.winnerInstanceIds = this.state.allInstanceIds.filter((id) => winningTeams.includes(this.state.pokemon[id].team));
    for (const id of this.state.livingOrder) {
      this.state.pokemon[id].velocity = { x: 0, y: 0 };
      this.state.pokemon[id].aiState = 'attack';
    }
    this.projectiles = [];
    this.pickups = [];
    this.events.push({ seq: this.nextSeq(), atMs: this.state.elapsedMs, type: 'milestone', kind: 'matchEnd' });
  }
}

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;
