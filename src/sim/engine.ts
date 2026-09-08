import type {
  MatchConfig,
  MoveDefinition,
  PokemonInstance,
  SimEvent,
  SimState,
  StageKey,
  Vec2,
} from './types';
import type { MoveLookup, SpeciesData } from './matchSetup';
import { createMatch } from './matchSetup';
import type { EngineLike } from './engineLike';
import { createRng, rngChance, type Rng } from './rng';
import {
  applyMovement,
  buildNeighborListFromPositions,
  CHASE_MOVE_SPEED,
  distance,
  pickWanderWaypoint,
  resolveCollisions,
  steerToward,
  WANDER_MOVE_SPEED,
} from './movement';
import { chooseMove, findSelfBuffMove, retaliate, updateTargeting } from './ai';
import { getEffectiveStat } from './statCalc';
import { resolveDamage } from './damage';
import {
  applyStatus,
  canApplyStatus,
  gateAction,
  maybeThawOnFireHit,
  tickStatusDamage,
} from './statusEffects';
import { STRUGGLE_MOVE, STRUGGLE_MOVE_ID, STRUGGLE_RECOIL_FRACTION } from './struggle';
import {
  AGGRESSIVE_COOLDOWN_MULTIPLIER,
  AGGRESSIVE_SPEED_MULTIPLIER,
  BASELINE_SPEED,
  BASE_ACTION_COOLDOWN_MS,
  isAggressivePhase,
  MATCH_TIME_LIMIT_MS,
  MAX_ACTION_COOLDOWN_MS,
  MIN_ACTION_COOLDOWN_MS,
  MIN_ACTION_COOLDOWN_MS_AGGRESSIVE,
  PRIORITY_COOLDOWN_DISCOUNT,
  SPREAD_MOVE_RADIUS,
  TICK_MS,
} from './constants';

export class SimulationEngine implements EngineLike {
  private state: SimState;
  private readonly events: SimEvent[] = [];
  private seq = 0;
  private readonly rng: Rng;
  private readonly moves: MoveLookup;
  private accumulatorMs = 0;

  constructor(config: MatchConfig, species: Record<number, SpeciesData>, moves: MoveLookup, seed: number) {
    this.rng = createRng(seed);
    this.moves = moves;
    this.state = createMatch(config, species, moves, this.rng);
    this.events.push({ seq: this.nextSeq(), atMs: 0, type: 'milestone', kind: 'matchStart' });
  }

  getState(): Readonly<SimState> {
    return this.state;
  }

  getEventsSince(seq: number): SimEvent[] {
    return this.events.filter((e) => e.seq > seq);
  }

  /** Lets the UI end the match on demand (an "End Match" control) rather than
   * waiting out the full 90s clock — reuses the exact same rule as that hard
   * cap: whoever's still standing at this instant is declared a (possibly
   * shared) winner. No-op if the match has already finished. */
  endMatchNow(): void {
    this.forceMatchEnd(this.state.elapsedMs);
  }

  tick(dtMs: number): void {
    if (this.state.phase === 'complete') return;
    this.accumulatorMs += dtMs;
    while (this.accumulatorMs >= TICK_MS) {
      this.accumulatorMs -= TICK_MS;
      this.stepOnce();
    }
  }

  private nextSeq(): number {
    this.seq += 1;
    return this.seq;
  }

  private stepOnce(): void {
    if (this.state.phase === 'complete') return;

    this.state.tick += 1;
    this.state.elapsedMs += TICK_MS;
    const nowMs = this.state.elapsedMs;

    // Hard cap regardless of phase: a match can never run past this instant.
    // Whoever's still standing right now is declared a (possibly shared)
    // winner — checked first so it overrides everything else this tick.
    if (nowMs >= MATCH_TIME_LIMIT_MS) {
      this.forceMatchEnd(nowMs);
      return;
    }

    if (this.state.phase === 'intro') {
      if (nowMs >= this.state.introDurationMs) this.state.phase = 'battle';
      return;
    }

    const livingIds = [...this.state.livingOrder];
    const positions = new Map<string, Vec2>();
    for (const id of livingIds) positions.set(id, { ...this.state.pokemon[id].position });
    const neighbors = buildNeighborListFromPositions(livingIds, positions, this.state.pokemon);

    for (const id of livingIds) {
      const self = this.state.pokemon[id];
      if (self.currentHp <= 0) continue;
      updateTargeting(self, this.state, positions, nowMs);
      this.stepMovement(self, positions, neighbors);
      if (self.actionCooldownMs > 0) self.actionCooldownMs -= TICK_MS;
    }

    resolveCollisions(livingIds, this.state.pokemon, this.state.arena);

    for (const id of livingIds) {
      const self = this.state.pokemon[id];
      if (self.currentHp <= 0) continue;
      this.maybeAct(self, nowMs);
    }

    for (const id of livingIds) {
      const self = this.state.pokemon[id];
      if (self.currentHp <= 0) continue;
      this.applyStatusTick(self, nowMs);
    }

    this.sweepFaints(nowMs);
    this.checkMilestones(nowMs);
  }

  private stepMovement(
    self: PokemonInstance,
    positions: ReadonlyMap<string, Vec2>,
    neighbors: ReturnType<typeof buildNeighborListFromPositions>
  ): void {
    if (self.aiState === 'incapacitated') {
      self.velocity = { x: 0, y: 0 };
      return;
    }

    const speedMult = isAggressivePhase(this.state.elapsedMs) ? AGGRESSIVE_SPEED_MULTIPLIER : 1;

    if (self.aiState === 'wander') {
      const selfPos = positions.get(self.instanceId) ?? self.position;
      if (!self.wanderWaypoint || distance(selfPos, self.wanderWaypoint) < 12) {
        self.wanderWaypoint = pickWanderWaypoint(this.rng, this.state.arena, selfPos);
      }
      steerToward(self, self.wanderWaypoint, WANDER_MOVE_SPEED * speedMult, neighbors);
    } else if (self.aiState === 'chase' && self.targetInstanceId) {
      const target = this.state.pokemon[self.targetInstanceId];
      const targetPos = positions.get(target.instanceId) ?? target.position;
      steerToward(self, targetPos, CHASE_MOVE_SPEED * speedMult, neighbors);
    } else {
      // 'attack' — hold ground, separation-only so sprites don't stack mid-fight.
      steerToward(self, self.position, 0, neighbors);
    }

    applyMovement(self, TICK_MS, this.state.arena);
  }

  private maybeAct(self: PokemonInstance, nowMs: number): void {
    if (self.aiState === 'incapacitated') return;

    if (self.aiState === 'attack') {
      if (self.actionCooldownMs > 0) return;
      const target = self.targetInstanceId ? this.state.pokemon[self.targetInstanceId] : undefined;
      if (!target || target.currentHp <= 0) return;
      const moveId = chooseMove(self, this.rng);
      const move = moveId === STRUGGLE_MOVE_ID ? STRUGGLE_MOVE : this.moves(moveId);
      if (!move) return;
      this.executeMove(self, move, moveId, target, nowMs);
      return;
    }

    // Only buff while actively closing in on a spotted target (never in pure
    // 'wander', which means no enemy is within aggro radius at all, and never
    // during the cold-open — updateTargeting forces 'wander' for both cases,
    // so gating on 'chase' excludes them for free) — otherwise a Pokémon with
    // nobody around plays a full attack swing/sound/label at thin air.
    if (self.aiState === 'chase' && self.actionCooldownMs <= 0) {
      const buffMove = findSelfBuffMove(self, this.moves);
      if (buffMove && rngChance(this.rng, 0.3)) {
        this.executeMove(self, buffMove, buffMove.id, null, nowMs);
      }
    }
  }

  private resetCooldown(attacker: PokemonInstance, move: MoveDefinition): void {
    const speed = getEffectiveStat(
      attacker.computedStats,
      attacker.statStages,
      'spe',
      attacker.status === 'paralysis' ? 'paralysis' : null
    );
    let cooldown = BASE_ACTION_COOLDOWN_MS * (BASELINE_SPEED / Math.max(1, speed));
    if (move.priority > 0) cooldown *= 1 - PRIORITY_COOLDOWN_DISCOUNT;

    const aggressive = isAggressivePhase(this.state.elapsedMs);
    if (aggressive) cooldown *= AGGRESSIVE_COOLDOWN_MULTIPLIER;
    const minCooldown = aggressive ? MIN_ACTION_COOLDOWN_MS_AGGRESSIVE : MIN_ACTION_COOLDOWN_MS;
    attacker.actionCooldownMs = Math.max(minCooldown, Math.min(MAX_ACTION_COOLDOWN_MS, cooldown));
  }

  private executeMove(
    attacker: PokemonInstance,
    move: MoveDefinition,
    moveId: number,
    primaryTarget: PokemonInstance | null,
    nowMs: number
  ): void {
    if (moveId !== STRUGGLE_MOVE_ID) {
      const slot = attacker.moves.find((m) => m.moveId === moveId);
      if (slot) slot.ppRemaining = Math.max(0, slot.ppRemaining - 1);
    }

    this.resetCooldown(attacker, move);

    if (attacker.status === 'paralysis') {
      const gate = gateAction(attacker, this.rng);
      if (!gate.canAct) return;
    }

    if (move.targeting === 'self') {
      this.applyMoveEffect(move, attacker, attacker);
      this.pushMoveUsedEvent(attacker, move, [], {}, {}, {}, {}, nowMs);
      return;
    }

    if (!primaryTarget || primaryTarget.currentHp <= 0) return;

    const targets = this.resolveTargets(attacker, primaryTarget, move);
    const hit: Record<string, boolean> = {};
    const crit: Record<string, boolean> = {};
    const effectiveness: Record<string, number> = {};
    const damage: Record<string, number> = {};

    for (const target of targets) {
      const result = resolveDamage(this.rng, move, attacker, target);
      hit[target.instanceId] = result.hit;
      crit[target.instanceId] = result.crit;
      effectiveness[target.instanceId] = result.effectiveness;
      damage[target.instanceId] = result.damage;

      if (!result.hit) continue;

      if (target.aiState === 'wander' || !target.targetInstanceId) {
        retaliate(target, attacker.instanceId, nowMs);
      }
      if (result.damage > 0) {
        target.currentHp = Math.max(0, target.currentHp - result.damage);
        target.lastHitAtMs = nowMs;
        target.lastDamagedByInstanceId = attacker.instanceId;
      }
      maybeThawOnFireHit(target, move.type === 'fire' && !move.typeless);
      this.applyMoveEffect(move, attacker, target);
    }

    if (moveId === STRUGGLE_MOVE_ID) {
      const recoil = Math.max(1, Math.floor(attacker.maxHp * STRUGGLE_RECOIL_FRACTION));
      attacker.currentHp = Math.max(0, attacker.currentHp - recoil);
    }

    this.pushMoveUsedEvent(
      attacker,
      move,
      targets.map((t) => t.instanceId),
      hit,
      crit,
      effectiveness,
      damage,
      nowMs
    );
  }

  private resolveTargets(
    attacker: PokemonInstance,
    primary: PokemonInstance,
    move: MoveDefinition
  ): PokemonInstance[] {
    if (move.targeting !== 'all-enemies-in-radius') return [primary];
    const result: PokemonInstance[] = [];
    for (const id of this.state.livingOrder) {
      if (id === attacker.instanceId) continue;
      const p = this.state.pokemon[id];
      if (p.team === attacker.team) continue; // never splash allies (Boss Mode's party)
      if (distance(p.position, primary.position) <= SPREAD_MOVE_RADIUS) result.push(p);
    }
    return result.length > 0 ? result : [primary];
  }

  private applyMoveEffect(move: MoveDefinition, attacker: PokemonInstance, target: PokemonInstance): void {
    const effect = move.effect;
    if (!effect) return;
    const chance = effect.chance ?? 100;
    if (!rngChance(this.rng, chance / 100)) return;

    const recipient = effect.target === 'self' ? attacker : target;

    if (effect.kind === 'statusInflict' && effect.status) {
      if (canApplyStatus(recipient)) {
        applyStatus(recipient, effect.status, this.rng);
        this.events.push({
          seq: this.nextSeq(),
          atMs: this.state.elapsedMs,
          type: 'statusApplied',
          instanceId: recipient.instanceId,
          status: effect.status,
        });
      }
    } else if (effect.kind === 'statStage' && effect.statChanges) {
      for (const [key, delta] of Object.entries(effect.statChanges) as [StageKey, number][]) {
        const current = recipient.statStages[key];
        recipient.statStages[key] = Math.max(-6, Math.min(6, current + delta));
      }
    }
  }

  private pushMoveUsedEvent(
    attacker: PokemonInstance,
    move: MoveDefinition,
    targetIds: string[],
    hit: Record<string, boolean>,
    crit: Record<string, boolean>,
    effectiveness: Record<string, number>,
    damage: Record<string, number>,
    nowMs: number
  ): void {
    this.events.push({
      seq: this.nextSeq(),
      atMs: nowMs,
      type: 'moveUsed',
      attackerId: attacker.instanceId,
      targetIds,
      moveId: move.id,
      hit,
      crit,
      effectiveness,
      damage,
    });
  }

  private applyStatusTick(self: PokemonInstance, nowMs: number): void {
    const { event, damage } = tickStatusDamage(self, TICK_MS, () => this.nextSeq(), nowMs);
    if (event) this.events.push(event);
    if (damage > 0) self.currentHp = Math.max(0, self.currentHp - damage);
  }

  private sweepFaints(nowMs: number): void {
    const stillLiving: string[] = [];
    let anyFainted = false;

    for (const id of this.state.livingOrder) {
      const p = this.state.pokemon[id];
      if (p.currentHp <= 0) {
        anyFainted = true;
        this.state.eliminationOrder.push(id);
        this.events.push({
          seq: this.nextSeq(),
          atMs: nowMs,
          type: 'fainted',
          instanceId: id,
          byInstanceId: p.lastDamagedByInstanceId ?? null,
        });
      } else {
        stillLiving.push(id);
      }
    }

    if (!anyFainted) return;
    this.state.livingOrder = stillLiving;
    for (const id of stillLiving) {
      const p = this.state.pokemon[id];
      if (p.targetInstanceId && !stillLiving.includes(p.targetInstanceId)) {
        p.targetInstanceId = null;
      }
    }
  }

  private checkMilestones(nowMs: number): void {
    if (this.state.phase === 'complete') return;

    if (this.state.livingOrder.length === 2 && this.state.phase !== 'finalTwo') {
      this.state.phase = 'finalTwo';
      this.events.push({ seq: this.nextSeq(), atMs: nowMs, type: 'milestone', kind: 'finalTwo' });
    }

    // A match ends once at most one *side* remains standing, not one
    // Pokémon — in a free-for-all every living Pokémon is on its own unique
    // team (see matchSetup.ts), so this is exactly equivalent to the old
    // livingOrder.length <= 1 check there. Team Mode shares a team id across
    // several Pokémon, so this correctly waits for the whole opposing side to
    // be wiped out rather than ending the instant livingOrder happens to hit
    // 1. It also fixes a Boss Mode edge case for free: the match now ends the
    // moment the boss dies even if several party members are still standing,
    // instead of only when livingOrder itself drops to <= 1.
    const teamsAlive = new Set(this.state.livingOrder.map((id) => this.state.pokemon[id].team));
    if (teamsAlive.size <= 1) {
      this.completeMatch(nowMs);
    }
  }

  /** The 90s hard cap: whoever's still standing is declared a (possibly shared) winner. */
  private forceMatchEnd(nowMs: number): void {
    if (this.state.phase === 'complete') return;
    this.completeMatch(nowMs);
  }

  /** Freezes the match and, for a lone winner, plants them at the arena
   * center in an idle victory pose facing south — 'incapacitated' already
   * halts movement/attacking (see stepMovement/maybeAct) and renders as Idle
   * with no other plumbing needed. Co-winners (from the 90s hard cap) are
   * left where they stand rather than stacked on the same point, since only
   * a single winner has an unambiguous "center". */
  private completeMatch(nowMs: number): void {
    this.state.phase = 'complete';
    const winnerIds = [...this.state.livingOrder];
    this.state.winnerInstanceIds = winnerIds;

    if (winnerIds.length === 1) {
      const winner = this.state.pokemon[winnerIds[0]];
      winner.velocity = { x: 0, y: 0 };
      winner.facing = 'S';
      winner.aiState = 'incapacitated';
      winner.position = { x: this.state.arena.width / 2, y: this.state.arena.height / 2 };
    }

    this.events.push({ seq: this.nextSeq(), atMs: nowMs, type: 'milestone', kind: 'matchEnd' });
  }
}
