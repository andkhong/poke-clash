import type { PokemonInstance, Vec2 } from '../types';
import { rngChance, type Rng } from '../rng';
import type { ActionEngine } from './ActionEngine';
import { AOE_RADIUS, moveKind, PROJECTILE } from './rules';

// Bot difficulty knobs — tune these first if bots feel too sharp or too dull.
const THINK_MIN_MS = 150;
const THINK_MAX_MS = 280;
const FIRE_CHANCE = 0.35;
/** Bots rest this long (plus up to the same again) after each shot, so they don't fire the instant energy allows. */
const FIRE_PAUSE_MS = 700;
const SELF_MOVE_CHANCE = 0.15;
const DODGE_CHANCE = 0.35;
const DODGE_LOOKAHEAD_PX = 260;
const AIM_ERROR_PX = 30;
/** How much of the target's movement the bot leads its shots by. */
const LEAD_FACTOR = 0.7;
const RANGED_PREFERRED_DISTANCE = 300;
const MELEE_PREFERRED_DISTANCE = 110;

/** Drives one non-player fighter through the same public calls the player's
 * controls use (setMoveInput/fire/dash), so bots obey every rule a human does. */
export class BotBrain {
  private nextThinkMs = 0;
  private strafeSign = 1;
  private nextStrafeFlipMs = 0;
  private nextFireMs = 0;
  private readonly judgedProjectiles = new Set<number>();

  constructor(
    readonly id: string,
    private readonly rng: Rng
  ) {}

  think(engine: ActionEngine, nowMs: number): void {
    if (!engine.isAlive(this.id)) return;
    const self = engine.getState().pokemon[this.id];
    this.maybeDodge(engine, self);
    if (nowMs < this.nextThinkMs) return;
    this.nextThinkMs = nowMs + THINK_MIN_MS + this.rng() * (THINK_MAX_MS - THINK_MIN_MS);

    const target = nearest(self, engine.enemiesOf(this.id));
    if (!target) {
      engine.setMoveInput(this.id, 0, 0);
      return;
    }
    const dx = target.position.x - self.position.x;
    const dy = target.position.y - self.position.y;
    const d = Math.hypot(dx, dy) || 1;
    const toward = { x: dx / d, y: dy / d };
    const preferred = this.hasRangedMove(engine, self) ? RANGED_PREFERRED_DISTANCE : MELEE_PREFERRED_DISTANCE;

    if (nowMs >= this.nextStrafeFlipMs) {
      this.strafeSign = rngChance(this.rng, 0.5) ? 1 : -1;
      this.nextStrafeFlipMs = nowMs + 1500 + this.rng() * 1500;
    }
    if (d > preferred + 60) engine.setMoveInput(this.id, toward.x, toward.y);
    else if (d < preferred - 60) engine.setMoveInput(this.id, -toward.x, -toward.y);
    else engine.setMoveInput(this.id, -toward.y * this.strafeSign * 0.8, toward.x * this.strafeSign * 0.8);

    if (nowMs < this.nextFireMs || !rngChance(this.rng, FIRE_CHANCE)) return;
    const slot = this.pickSlot(engine, self, target, d);
    if (slot === null) return;
    const kind = moveKind(engine.getMove(self.moves[slot].moveId)!);
    const speed = kind === 'physical' ? PROJECTILE.physical.speed : PROJECTILE.ranged.speed;
    const lead = (d / speed) * LEAD_FACTOR;
    const fired = engine.fire(this.id, slot, {
      x: target.position.x + target.velocity.x * lead + (this.rng() - 0.5) * 2 * AIM_ERROR_PX,
      y: target.position.y + target.velocity.y * lead + (this.rng() - 0.5) * 2 * AIM_ERROR_PX,
    });
    if (fired) this.nextFireMs = nowMs + FIRE_PAUSE_MS * (1 + this.rng());
  }

  private hasRangedMove(engine: ActionEngine, self: PokemonInstance): boolean {
    return self.moves.some((slot) => {
      const move = engine.getMove(slot.moveId);
      // A ranged status move (Growl, Charm…) does no damage: holding back for it, a bot never closes in to hit.
      return move !== undefined && moveKind(move) === 'ranged' && (move.power ?? 0) > 0;
    });
  }

  private pickSlot(engine: ActionEngine, self: PokemonInstance, target: PokemonInstance, d: number): number | null {
    const usable: number[] = [];
    self.moves.forEach((slot, index) => {
      const move = engine.getMove(slot.moveId);
      if (!move || !engine.canFire(this.id, index)) return;
      const kind = moveKind(move);
      const reach =
        kind === 'self'
          ? Infinity
          : kind === 'aoe'
            ? AOE_RADIUS
            : kind === 'physical'
              ? PROJECTILE.physical.range
              : PROJECTILE.ranged.range;
      if (kind === 'self' && !rngChance(this.rng, SELF_MOVE_CHANCE)) return;
      if (d <= reach + target.collisionRadius) usable.push(index);
    });
    return usable.length > 0 ? usable[Math.floor(this.rng() * usable.length)] : null;
  }

  /** Each incoming shot gets one roll to be dodged — sideways, across its path. */
  private maybeDodge(engine: ActionEngine, self: PokemonInstance): void {
    if (engine.getFighter(this.id).dashCharges <= 0) return;
    for (const p of engine.getProjectiles()) {
      if (p.team === self.team || this.judgedProjectiles.has(p.id)) continue;
      const rel: Vec2 = { x: self.position.x - p.position.x, y: self.position.y - p.position.y };
      const dist = Math.hypot(rel.x, rel.y);
      const speed = Math.hypot(p.velocity.x, p.velocity.y) || 1;
      const dir = { x: p.velocity.x / speed, y: p.velocity.y / speed };
      if (dist > DODGE_LOOKAHEAD_PX || rel.x * dir.x + rel.y * dir.y <= 0) continue;
      const missBy = Math.abs(rel.x * dir.y - rel.y * dir.x);
      if (missBy > self.collisionRadius + p.radius + 10) continue;
      this.judgedProjectiles.add(p.id);
      if (this.judgedProjectiles.size > 200) this.judgedProjectiles.clear();
      if (!rngChance(this.rng, DODGE_CHANCE)) continue;
      const side = rel.x * dir.y - rel.y * dir.x >= 0 ? 1 : -1;
      engine.setMoveInput(this.id, dir.y * side, -dir.x * side);
      engine.dash(this.id);
      return;
    }
  }
}

function nearest(self: PokemonInstance, others: PokemonInstance[]): PokemonInstance | undefined {
  let best: PokemonInstance | undefined;
  let bestD = Infinity;
  for (const other of others) {
    const d = Math.hypot(other.position.x - self.position.x, other.position.y - self.position.y);
    if (d < bestD) {
      bestD = d;
      best = other;
    }
  }
  return best;
}
