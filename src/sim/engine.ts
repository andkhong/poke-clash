import type {
  ActiveAttack,
  MatchConfig,
  MoveDefinition,
  PokemonInstance,
  SimEvent,
  SimState,
  StageKey,
  StatusCondition,
  Vec2,
} from './types';
import type { MoveLookup, SpeciesData } from './matchSetup';
import { createMatch } from './matchSetup';
import type { EngineLike } from './engineLike';
import { eventsAfter } from './events';
import { createRng, rngChance, type Rng } from './rng';
import {
  applyMovement,
  buildNeighborListFromPositions,
  CHASE_MOVE_SPEED,
  distance,
  pickWanderWaypoint,
  resolveCollisions,
  steerToward,
  trackWanderHeadway,
  WANDER_ARRIVAL_DISTANCE,
  WANDER_MOVE_SPEED,
} from './movement';
import { chooseMove, findSelfBuffMove, retaliate, updateTargeting } from './ai';
import { getEffectiveStat } from './statCalc';
import { resolveDamage } from './damage';
import {
  applyStatus,
  canApplyStatus,
  gateAction,
  isIncapacitatingStatus,
  maybeThawOnFireHit,
  tickStatusDamage,
} from './statusEffects';
import { STRUGGLE_MOVE, STRUGGLE_MOVE_ID, STRUGGLE_RECOIL_FRACTION } from './struggle';
import {
  AGGRESSIVE_COOLDOWN_MULTIPLIER,
  AGGRESSIVE_SPEED_MULTIPLIER,
  ATTACK_DEFERRED_RETRY_MAX_MS,
  ATTACK_DEFERRED_RETRY_MIN_MS,
  ATTACK_GAP_MS,
  BASELINE_SPEED,
  BASE_ACTION_COOLDOWN_MS,
  isAggressivePhase,
  MATCH_TIME_LIMIT_MS,
  MAX_ACTION_COOLDOWN_MS,
  MAX_SIMULTANEOUS_ATTACKS,
  MIN_ACTION_COOLDOWN_MS,
  MIN_ACTION_COOLDOWN_MS_AGGRESSIVE,
  POST_ATTACK_HOLD_MS,
  PRIORITY_COOLDOWN_DISCOUNT,
  STATUS_TURN_INTERVAL_MS,
  TICK_MS,
} from './constants';

/** What the arena-wide attack gate says to a Pokémon that's ready to fire —
 * see SimulationEngine.attackGateVerdict. */
type AttackGateVerdict = 'fire' | 'wait' | 'defer';

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
    return eventsAfter(this.events, seq);
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

    // Retire any attack whose hold window has now played out (and arm the gap
    // it leaves behind) before anyone decides whether to act this tick — a
    // slot that frees on the same tick a Pokémon is ready still can't be used
    // until ATTACK_GAP_MS has passed, so ordering here isn't load-bearing,
    // but keeping the gate current first keeps the rest of the tick simple.
    this.settleAttackGate(nowMs);

    const livingIds = [...this.state.livingOrder];
    const positions = new Map<string, Vec2>();
    for (const id of livingIds) positions.set(id, { ...this.state.pokemon[id].position });
    const neighbors = buildNeighborListFromPositions(livingIds, positions, this.state.pokemon);
    const speedMult = isAggressivePhase(nowMs) ? AGGRESSIVE_SPEED_MULTIPLIER : 1;

    const wanderers: string[] = [];
    for (const id of livingIds) {
      const self = this.state.pokemon[id];
      if (self.currentHp <= 0) continue;
      updateTargeting(self, this.state, positions, nowMs, this.rng);
      if (this.stepMovement(self, positions, neighbors, speedMult)) wanderers.push(id);
      else self.wanderStuckMs = 0;
    }

    resolveCollisions(livingIds, this.state.pokemon, this.state.arena);

    // Only now — with every position-changing pass for this tick done — can a
    // wander leg's headway be judged. A Pokémon that's been getting nowhere
    // for a while gives up on that waypoint and picks a replacement that
    // turns it away from whatever was blocking it; being jostled while still
    // making progress is left alone entirely (see trackWanderHeadway).
    for (const id of wanderers) {
      const self = this.state.pokemon[id];
      const blockedHeading = trackWanderHeadway(self, positions.get(id)!, WANDER_MOVE_SPEED * speedMult, TICK_MS);
      if (blockedHeading) {
        self.wanderWaypoint = pickWanderWaypoint(
          this.rng,
          this.state.arena,
          self.position,
          blockedHeading,
          this.otherPositions(id, positions)
        );
      }
    }

    this.stepActions(livingIds, nowMs);

    for (const id of livingIds) {
      const self = this.state.pokemon[id];
      if (self.currentHp <= 0) continue;
      this.applyStatusTick(self, nowMs);
    }

    this.sweepFaints(nowMs);
    this.checkMilestones(nowMs);
  }

  /** Returns true when this Pokémon spent the tick walking a wander leg
   * (steering toward its wanderWaypoint) — the one case stepOnce has to
   * follow up on after collisions are resolved, see trackWanderHeadway. */
  private stepMovement(
    self: PokemonInstance,
    positions: ReadonlyMap<string, Vec2>,
    neighbors: ReturnType<typeof buildNeighborListFromPositions>,
    speedMult: number
  ): boolean {
    if (self.aiState === 'incapacitated') {
      self.velocity = { x: 0, y: 0 };
      return false;
    }

    let walkingWanderLeg = false;
    if (self.postAttackHoldMs > 0) {
      // Hold perfectly still (separation-only, same as 'attack' below) until
      // the render's whole attack-visual window (pose/label/sound — see
      // POST_ATTACK_HOLD_MS) has played out, regardless of aiState/cooldown —
      // otherwise this Pokémon starts wandering off mid-pose (aiState flips
      // to 'wander' the instant actionCooldownMs kicks in, which is often
      // shorter than the visual window) and the renderer's cosmetic
      // position lock has to paper over a growing sim/render gap, which
      // reads as a snap once that lock releases.
      steerToward(self, self.position, 0, neighbors);
    } else if (self.status === 'paralysis' && self.aiState === 'wander') {
      // Paralysis locks a paralyzed Pokémon in place while it has no target
      // to chase — it can still close in on and fight an engaged target
      // (subject to gateAction's own full-paralysis roll each time it tries
      // to act), but idle wandering is fully suppressed, same hold-ground
      // steering as 'attack' below.
      steerToward(self, self.position, 0, neighbors);
    } else if (self.aiState === 'wander') {
      const selfPos = positions.get(self.instanceId) ?? self.position;
      if (!self.wanderWaypoint || distance(selfPos, self.wanderWaypoint) < WANDER_ARRIVAL_DISTANCE) {
        self.wanderWaypoint = pickWanderWaypoint(
          this.rng,
          this.state.arena,
          selfPos,
          undefined,
          this.otherPositions(self.instanceId, positions)
        );
        self.wanderStuckMs = 0;
      }
      steerToward(self, self.wanderWaypoint, WANDER_MOVE_SPEED * speedMult, neighbors);
      walkingWanderLeg = true;
    } else if (self.aiState === 'chase' && self.targetInstanceId) {
      const target = this.state.pokemon[self.targetInstanceId];
      const targetPos = positions.get(target.instanceId) ?? target.position;
      steerToward(self, targetPos, CHASE_MOVE_SPEED * speedMult, neighbors);
    } else {
      // 'attack' — hold ground, separation-only so sprites don't stack mid-fight.
      steerToward(self, self.position, 0, neighbors);
    }

    applyMovement(self, TICK_MS, this.state.arena);
    return walkingWanderLeg;
  }

  /** Everyone else's tick-start position — what pickWanderWaypoint judges a
   * candidate leg's open space against, so a new wander leg eases the
   * Pokémon away from the crowd rather than deeper into it. */
  private otherPositions(selfId: string, positions: ReadonlyMap<string, Vec2>): Vec2[] {
    const others: Vec2[] = [];
    for (const [id, pos] of positions) if (id !== selfId) others.push(pos);
    return others;
  }

  /**
   * Everyone's "may I act this tick?" pass, run through the arena-wide
   * attack gate (see MAX_SIMULTANEOUS_ATTACKS in constants.ts). Rather than
   * letting each Pokémon fire the instant its own cooldown clears — which in
   * livingOrder means a low spawn index always wins a contested slot — every
   * Pokémon that's ready is collected first into this tick's attack queue,
   * then offered the free slot(s) fastest first (effective Speed, so
   * paralysis and stat stages count), with ties going to whoever has gone
   * longest without attacking and then spawn order (Array.prototype.sort is
   * stable). The queue is rebuilt every tick from whoever is actually in
   * position to attack right now, so a Pokémon that faints — or wanders off
   * while deferred — simply isn't in it any more; an attack that already
   * fired is untouched by its attacker fainting afterwards (its slot runs
   * out on its own, see settleAttackGate). Real attacks are offered slots
   * before opportunistic chase-buffs, so a buff never crowds out a hit.
   */
  private stepActions(livingIds: readonly string[], nowMs: number): void {
    const attackers: PokemonInstance[] = [];
    const buffers: { self: PokemonInstance; move: MoveDefinition }[] = [];

    for (const id of livingIds) {
      const self = this.state.pokemon[id];
      if (self.currentHp <= 0) continue;
      if (self.aiState === 'incapacitated') {
        this.tickIncapacitated(self, nowMs);
        continue;
      }
      if (self.actionCooldownMs > 0) continue;

      if (self.aiState === 'attack') {
        const target = self.targetInstanceId ? this.state.pokemon[self.targetInstanceId] : undefined;
        if (target && target.currentHp > 0) attackers.push(self);
        continue;
      }

      // Only buff while actively closing in on a spotted target (never in
      // pure 'wander', which means no enemy is within aggro radius at all,
      // and never during the cold-open — updateTargeting forces 'wander' for
      // both cases, so gating on 'chase' excludes them for free) — otherwise
      // a Pokémon with nobody around plays a full attack swing/sound/label
      // at thin air. Also never for a forcedMoveId Pokémon (see that field's
      // own comment) — a move-testing pin means only that exact move should
      // ever fire, not an opportunistic buff sneaking in first.
      if (self.aiState === 'chase' && self.forcedMoveId === undefined) {
        const buffMove = findSelfBuffMove(self, this.moves);
        if (buffMove && rngChance(this.rng, 0.3)) buffers.push({ self, move: buffMove });
      }
    }

    // Both HP re-checks below matter because everyone was collected before
    // anyone fired: an attacker earlier in this same pass may have just KO'd
    // this Pokémon *or* its target (either stays in livingOrder until
    // sweepFaints, so the collection-time checks above can't see it). The
    // self check is what stops a mutual same-tick KO — the old one-at-a-time
    // loop skipped a just-KO'd Pokémon for free, and without this two
    // finalists could take each other out in one tick and leave no winner.
    const speedOf = (p: PokemonInstance) =>
      getEffectiveStat(p.computedStats, p.statStages, 'spe', p.status === 'paralysis' ? 'paralysis' : null);
    attackers.sort((a, b) => speedOf(b) - speedOf(a) || (a.lastAttackAtMs ?? -1) - (b.lastAttackAtMs ?? -1));
    for (const self of attackers) {
      if (self.currentHp <= 0) continue;
      const verdict = this.attackGateVerdict(self, nowMs);
      if (verdict === 'wait') continue;
      if (verdict === 'defer') {
        this.deferAttack(self);
        continue;
      }
      const target = this.state.pokemon[self.targetInstanceId!];
      if (!target || target.currentHp <= 0) continue;
      const moveId = chooseMove(self, this.rng, this.moves);
      const move = moveId === STRUGGLE_MOVE_ID ? STRUGGLE_MOVE : this.moves(moveId);
      if (!move) continue;
      this.executeMove(self, move, moveId, target, nowMs);
    }

    // A chase-buff that doesn't get a slot is simply skipped — the Pokémon
    // is mid-chase and keeps closing in regardless, and rolls again next
    // tick — so it never earns the deferral wander leg a blocked attack does.
    for (const { self, move } of buffers) {
      if (self.currentHp <= 0) continue;
      if (this.attackGateVerdict(self, nowMs) !== 'fire') continue;
      this.executeMove(self, move, move.id, null, nowMs);
    }
  }

  /** Frees the slot of every in-flight attack whose hold/visual window has
   * ended by now, and pushes the gate's reopening out to ATTACK_GAP_MS past
   * each such completion. */
  private settleAttackGate(nowMs: number): void {
    const gate = this.state.attackGate;
    if (gate.active.length === 0) return;
    const stillActive: ActiveAttack[] = [];
    for (const attack of gate.active) {
      if (attack.endsAtMs <= nowMs) {
        gate.closedUntilMs = Math.max(gate.closedUntilMs, attack.endsAtMs + ATTACK_GAP_MS);
      } else {
        stillActive.push(attack);
      }
    }
    gate.active = stillActive;
  }

  /**
   * 'wait': inside the post-attack gap — short enough (ATTACK_GAP_MS) to
   *   just stand facing the target and try again next tick.
   * 'defer': every slot is taken, or this Pokémon fired the arena's most
   *   recent attack and someone else is around to take this one — could be
   *   a while, so it's sent off on a wander leg instead (see deferAttack).
   * 'fire': a slot is free, the gap has passed, and it's this Pokémon's turn.
   */
  private attackGateVerdict(self: PokemonInstance, nowMs: number): AttackGateVerdict {
    const gate = this.state.attackGate;
    if (nowMs < gate.closedUntilMs) return 'wait';
    if (gate.active.length >= MAX_SIMULTANEOUS_ATTACKS) return 'defer';
    if (gate.lastAttackerId === self.instanceId && this.anyoneElseCouldAttack(self)) return 'defer';
    return 'fire';
  }

  /** Whether any other living Pokémon is in a state to attack at all — i.e.
   * not asleep/frozen. "Could attack" deliberately ignores whether they're
   * currently in range of anyone: the no-repeat rule is meant to hand the
   * turn to whoever's next, and a still-chasing or still-cooling-down rival
   * will get there within a few seconds. Only when literally nobody else
   * could ever take the turn (everyone else is out cold) is the last
   * attacker allowed to go again, so a lone awake Pokémon isn't stuck
   * politely waiting on a sleeping opponent. */
  private anyoneElseCouldAttack(self: PokemonInstance): boolean {
    for (const id of this.state.livingOrder) {
      if (id === self.instanceId) continue;
      const other = this.state.pokemon[id];
      if (other.currentHp <= 0) continue;
      if (isIncapacitatingStatus(other.status)) continue;
      return true;
    }
    return false;
  }

  /** Turned away by the gate: rather than standing motionless next to its
   * target until a slot frees, put it on a cooldown — updateTargeting
   * (ai.ts) reads any positive cooldown as "wander this off", and its
   * justBecameAvailable trigger re-evaluates the target when that clears —
   * so it visibly moves on and comes back for another try. Randomized
   * (ATTACK_DEFERRED_RETRY_MIN_MS..MAX_MS) so a crowd of deferred Pokémon
   * doesn't all turn around in lockstep and re-converge on the same tick.
   * Same fresh-leg reasoning as resetCooldown for clearing the stale
   * waypoint. Under MatchConfig.disableWander this simply holds ground for
   * the same span. */
  private deferAttack(self: PokemonInstance): void {
    self.actionCooldownMs =
      ATTACK_DEFERRED_RETRY_MIN_MS + this.rng() * (ATTACK_DEFERRED_RETRY_MAX_MS - ATTACK_DEFERRED_RETRY_MIN_MS);
    self.wanderWaypoint = undefined;
  }

  /** Books this move into the arena-wide gate: it occupies a slot for its
   * whole POST_ATTACK_HOLD_MS hold window (the same span the attacker holds
   * still and the renderer plays its visual for), becomes the most recent
   * attacker for the no-repeat rule, and stamps lastAttackAtMs for the
   * longest-waiting-first ordering in stepActions. */
  private claimAttackSlot(attacker: PokemonInstance, nowMs: number): void {
    const gate = this.state.attackGate;
    gate.active.push({ attackerId: attacker.instanceId, endsAtMs: nowMs + POST_ATTACK_HOLD_MS });
    gate.lastAttackerId = attacker.instanceId;
    attacker.lastAttackAtMs = nowMs;
  }

  /** A sleeping/frozen Pokémon's "turns". It can't attack, so it never goes
   * through executeMove — where a paralyzed Pokémon rolls its own gate — and
   * without this nothing would ever count its sleep down or roll its thaw:
   * it would simply stay out of the fight until it fainted. Reuses
   * actionCooldownMs (which updateTargeting keeps ticking down regardless of
   * status) as the turn timer: each time it expires, take one gateAction
   * turn, and if that didn't clear the status, arm the next turn. A cleared
   * status leaves the cooldown at 0, so it can rejoin the fight on its very
   * next tick — updateTargeting stops reporting 'incapacitated' the moment
   * status is null. */
  private tickIncapacitated(self: PokemonInstance, nowMs: number): void {
    if (!isIncapacitatingStatus(self.status) || self.actionCooldownMs > 0) return;
    const gate = gateAction(self, this.rng);
    if (gate.clearedStatus) {
      this.pushStatusClearedEvent(self, gate.clearedStatus, nowMs);
      return;
    }
    self.actionCooldownMs = STATUS_TURN_INTERVAL_MS;
  }

  private pushStatusClearedEvent(self: PokemonInstance, status: StatusCondition, nowMs: number): void {
    this.events.push({ seq: this.nextSeq(), atMs: nowMs, type: 'statusCleared', instanceId: self.instanceId, status });
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
    attacker.postAttackHoldMs = POST_ATTACK_HOLD_MS;

    // Force a brand-new wander leg from wherever this attack just happened,
    // rather than resuming a stale cached waypoint — updateTargeting's
    // cooldown gate puts every Pokémon back into 'wander' the very next
    // tick, and stepMovement's 'wander' branch repicks automatically
    // whenever wanderWaypoint is unset.
    attacker.wanderWaypoint = undefined;
  }

  private executeMove(
    attacker: PokemonInstance,
    move: MoveDefinition,
    moveId: number,
    primaryTarget: PokemonInstance | null,
    nowMs: number
  ): void {
    this.resetCooldown(attacker, move);
    // Every path through here — including a fully-paralyzed whiff below,
    // which still holds the attacker still for its whole hold window — is
    // one use of an attack slot, so this sits next to resetCooldown rather
    // than with the callers, where the two could drift apart.
    this.claimAttackSlot(attacker, nowMs);

    if (attacker.status === 'paralysis') {
      const gate = gateAction(attacker, this.rng);
      if (!gate.canAct) return;
    }

    // PP goes only once the move actually fires: a full-paralysis whiff above
    // costs the turn (cooldown and slot) but, as in the games, no PP.
    if (moveId !== STRUGGLE_MOVE_ID) {
      const slot = attacker.moves.find((m) => m.moveId === moveId);
      if (slot) slot.ppRemaining = Math.max(0, slot.ppRemaining - 1);
    }

    if (move.targeting === 'self') {
      this.applyMoveEffect(move, attacker, attacker);
      this.applyUserFaint(move, attacker);
      this.pushMoveUsedEvent(attacker, move, null, [], {}, {}, {}, {}, { ...attacker.position }, {}, nowMs);
      return;
    }

    if (!primaryTarget || primaryTarget.currentHp <= 0) return;

    const targets = this.resolveTargets(primaryTarget);
    const hit: Record<string, boolean> = {};
    const crit: Record<string, boolean> = {};
    const effectiveness: Record<string, number> = {};
    const damage: Record<string, number> = {};
    // Captured now, at the exact instant this move fires — see the event
    // field's own comment (types.ts) for why a live position lookup later
    // (in the renderer, well after this tick's other pokemon have finished
    // acting) isn't safe to use instead.
    const attackerPosition = { ...attacker.position };
    const targetPositions: Record<string, Vec2> = {};

    for (const target of targets) {
      targetPositions[target.instanceId] = { ...target.position };
      const result = resolveDamage(this.rng, move, attacker, target);
      hit[target.instanceId] = result.hit;
      crit[target.instanceId] = result.crit;
      effectiveness[target.instanceId] = result.effectiveness;
      damage[target.instanceId] = result.damage;

      if (!result.hit) continue;

      // A landed hit pins the target in place for the same window the
      // attacker holds after firing (resetCooldown below sets the attacker's
      // this same tick, so both release together): the one being hit
      // shouldn't be walking off while the attack's visual plays out on it.
      // Movement only — it may still fire back mid-hold, same as the
      // attacker may. Its stale wander leg is dropped like the attacker's,
      // so it picks a fresh one from where it stood once released.
      target.postAttackHoldMs = POST_ATTACK_HOLD_MS;
      target.wanderWaypoint = undefined;

      if (target.aiState === 'wander' || !target.targetInstanceId) {
        retaliate(target, attacker.instanceId, nowMs);
      }
      // A type-immune target (effectiveness 0 — Earthquake on a Flying type)
      // is left untouched from here on: no damage, no thaw, and none of the
      // move's secondary effect, which used to land regardless. The hit is
      // still recorded as one so the renderer shows the attack connecting
      // for "no effect".
      if (result.effectiveness === 0) continue;
      if (result.damage > 0) {
        target.currentHp = Math.max(0, target.currentHp - result.damage);
        target.lastHitAtMs = nowMs;
        target.lastDamagedByInstanceId = attacker.instanceId;
      }
      if (maybeThawOnFireHit(target, move.type === 'fire' && !move.typeless)) {
        this.pushStatusClearedEvent(target, 'freeze', nowMs);
      }
      this.applyMoveEffect(move, attacker, target);
    }

    if (moveId === STRUGGLE_MOVE_ID) {
      const recoil = Math.max(1, Math.floor(attacker.maxHp * STRUGGLE_RECOIL_FRACTION));
      attacker.currentHp = Math.max(0, attacker.currentHp - recoil);
      // Recoil that finishes the user off is its own doing — credited to
      // itself, like applyUserFaint, not to whoever last hit it.
      if (attacker.currentHp === 0) attacker.lastDamagedByInstanceId = attacker.instanceId;
    }
    this.applyUserFaint(move, attacker);

    this.pushMoveUsedEvent(
      attacker,
      move,
      primaryTarget.instanceId,
      targets.map((t) => t.instanceId),
      hit,
      crit,
      effectiveness,
      damage,
      attackerPosition,
      targetPositions,
      nowMs
    );
  }

  /** Every attack lands on exactly one Pokémon — the one the attacker is
   * engaged with — including moves the dataset marks 'all-enemies-in-radius'
   * (Earthquake, Heat Wave, Blizzard, Surf, ...). Those used to splash every
   * enemy within SPREAD_MOVE_RADIUS of the primary, which in a packed
   * 16-Pokémon brawl meant one Blizzard could hit (and the renderer would
   * draw a separate jet to) three or four Pokémon at once — a single attack
   * has to read as one Pokémon hitting one other. The targeting flag is left
   * on the move data itself untouched; it's simply not splash here.
   * Returned as a list so the moveUsed event's per-target maps keep their
   * shape. */
  private resolveTargets(primary: PokemonInstance): PokemonInstance[] {
    return [primary];
  }

  /** Self-Destruct, Explosion, Misty Explosion: the user goes down with the
   * blast, however much HP it had — after its damage has landed, so the
   * target still takes the hit. It's swept out with this tick's other
   * faints (sweepFaints), credited to itself so its `fainted` event says so
   * (the arena keeps such an attacker's just-fired attack queued to play
   * while its sprite fades — see ArenaScene.consumeEvents). If the blast
   * also takes out the last other side, nobody is left standing and the
   * match ends without a winner, like any other simultaneous last KO. */
  private applyUserFaint(move: MoveDefinition, attacker: PokemonInstance): void {
    if (!move.userFaints) return;
    attacker.currentHp = 0;
    attacker.lastDamagedByInstanceId = attacker.instanceId;
  }

  private applyMoveEffect(move: MoveDefinition, attacker: PokemonInstance, target: PokemonInstance): void {
    const effect = move.effect;
    if (!effect) return;
    const chance = effect.chance ?? 100;
    if (!rngChance(this.rng, chance / 100)) return;

    const recipient = effect.target === 'self' ? attacker : target;

    if (effect.kind === 'statusInflict' && effect.status) {
      if (canApplyStatus(recipient, effect.status)) {
        applyStatus(recipient, effect.status, this.rng);
        // A Pokémon put to sleep/frozen while its cooldown happens to be at 0
        // (say, mid-wander) would otherwise take its first status turn on the
        // very next tick — a 1-turn sleep over in 50ms. Its first turn has to
        // be a full turn away, same as every one after it (see
        // tickIncapacitated); a longer in-progress attack cooldown is left
        // alone, since that just means its first turn comes a little later.
        if (isIncapacitatingStatus(effect.status)) {
          recipient.actionCooldownMs = Math.max(recipient.actionCooldownMs, STATUS_TURN_INTERVAL_MS);
        }
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
    primaryTargetId: string | null,
    targetIds: string[],
    hit: Record<string, boolean>,
    crit: Record<string, boolean>,
    effectiveness: Record<string, number>,
    damage: Record<string, number>,
    attackerPosition: Vec2,
    targetPositions: Record<string, Vec2>,
    nowMs: number
  ): void {
    this.events.push({
      seq: this.nextSeq(),
      atMs: nowMs,
      type: 'moveUsed',
      attackerId: attacker.instanceId,
      primaryTargetId,
      targetIds,
      moveId: move.id,
      hit,
      crit,
      effectiveness,
      damage,
      attackerPosition,
      targetPositions,
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
        p.aiState = 'fainted';
        p.velocity = { x: 0, y: 0 };
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
