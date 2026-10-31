import { ActionEngine, facingVector, type ActionSnapshot, type Projectile } from '../../sim/action/ActionEngine';
import type { MoveLookup, SpeciesData } from '../../sim/matchSetup';
import { isIncapacitatingStatus } from '../../sim/statusEffects';
import type { MatchConfig, PokemonInstance, Vec2 } from '../../sim/types';
import * as R from '../../sim/action/rules';
import type { ClientMessage } from './playProtocol';

/** Other fighters are drawn this far in the past, between two snapshots, so
 * they glide instead of stepping at the 30 Hz broadcast rate (two snapshot
 * gaps, so one late packet doesn't stall them). */
const INTERP_DELAY_MS = 70;
const REPORT_INTERVAL_MS = 33;
/** After a local fire or dash, own cooldowns/energy/charges ignore the server
 * this long — older snapshots would otherwise briefly undo the spend. */
const LOCAL_HOLD_MS = 350;
/** Further than this from the server's idea of you (a rejected move, a
 * respawn), you snap to the server. */
const RESYNC_DISTANCE = 250;
const MAX_SAMPLES = 20;

interface Sample {
  atMs: number;
  positions: Record<string, Vec2>;
}

/**
 * An online player's local copy of the match. Snapshots from the server
 * (game-server/playRooms.ts) overwrite everything except the player's own
 * movement, which runs here every frame with the same rules the server uses
 * and is reported back. Fires and dashes go to the server and are mirrored
 * locally so the HUD answers instantly. ActionScene and the HUD read it
 * exactly like a solo ActionEngine.
 */
export class OnlineActionEngine extends ActionEngine {
  private samples: Sample[] = [];
  private projectileBase: Projectile[] = [];
  private projectilesAtMs = 0;
  private snapReceivedAtMs = 0;
  private snapElapsedMs = 0;
  private lastSentReportMs = 0;
  private localHoldUntilMs = 0;
  private ownAccumulatorMs = 0;

  constructor(
    config: MatchConfig,
    species: Record<number, SpeciesData>,
    moves: MoveLookup,
    seed: number,
    playerId: string,
    private readonly send: (message: ClientMessage) => void
  ) {
    super(config, species, moves, seed, { bots: false, playerId });
  }

  applySnapshot(s: ActionSnapshot): void {
    const now = performance.now();
    const state = this.state;
    state.phase = s.phase;
    state.livingOrder = s.livingOrder;
    state.eliminationOrder = s.eliminationOrder;
    state.winnerInstanceIds = s.winnerInstanceIds;
    this.snapElapsedMs = s.elapsedMs;
    this.snapReceivedAtMs = now;
    state.elapsedMs = s.elapsedMs;

    const me = this.playerId;
    const respawnedMe = s.events.some((e) => e.type === 'respawned' && e.instanceId === me);
    const holding = now < this.localHoldUntilMs;
    const positions: Record<string, Vec2> = {};
    for (const [id, fs] of Object.entries(s.fighters)) {
      const p = state.pokemon[id];
      const f = this.fighters[id];
      if (!p || !f) continue;
      p.currentHp = fs.hp;
      p.status = fs.status;
      p.lastHitAtMs = fs.lastHitAtMs ?? undefined;
      Object.assign(f, {
        lives: fs.lives,
        invulnMs: fs.invulnMs,
        respawnAtMs: fs.respawnAtMs,
        kos: fs.kos,
        damageDealt: fs.damageDealt,
        dashRechargeMs: fs.dashRechargeMs,
        // speedMs also lifts the cap in stepMovement for the fighter this screen moves.
        speedMs: fs.speedMs,
        shieldMs: fs.shieldMs,
      });
      if (id === me) {
        if (!holding)
          Object.assign(f, {
            energy: fs.energy,
            cooldowns: fs.cooldowns,
            globalCooldownMs: fs.globalCooldownMs,
            dashCharges: fs.dashCharges,
          });
        if (respawnedMe || Math.hypot(fs.x - p.position.x, fs.y - p.position.y) > RESYNC_DISTANCE) {
          p.position = { x: fs.x, y: fs.y };
          p.velocity = { x: 0, y: 0 };
          f.knockback = { x: 0, y: 0 };
        }
        continue;
      }
      Object.assign(f, {
        energy: fs.energy,
        cooldowns: fs.cooldowns,
        dashCharges: fs.dashCharges,
      });
      p.facing = fs.facing;
      p.aiState = fs.aiState;
      p.velocity = { x: fs.vx, y: fs.vy };
      positions[id] = { x: fs.x, y: fs.y };
    }
    this.samples.push({ atMs: now, positions });
    if (this.samples.length > MAX_SAMPLES) this.samples.shift();

    this.pickups = s.pickups;
    this.projectileBase = s.projectiles;
    this.projectilesAtMs = now;

    for (const event of s.events) {
      this.actionEvents.push(event);
      if (event.type === 'hit' && event.targetId === me) {
        this.fighters[me].knockback.x += event.knockback.x;
        this.fighters[me].knockback.y += event.knockback.y;
      }
    }
  }

  override tick(dtMs: number): void {
    const now = performance.now();
    if (this.state.phase === 'battle') {
      // A smooth match clock between snapshots, never more than a beat ahead.
      this.state.elapsedMs = this.snapElapsedMs + Math.min(250, now - this.snapReceivedAtMs);
    }
    this.stepOwn(dtMs, now);
    this.interpolateOthers(now);
    const age = (now - this.projectilesAtMs) / 1000;
    this.projectiles = this.projectileBase.map((p) => ({
      ...p,
      position: {
        x: p.position.x + p.velocity.x * age,
        y: p.position.y + p.velocity.y * age,
      },
    }));
  }

  override fire(id: string, slot: number, aim: Vec2): boolean {
    if (id !== this.playerId || !this.canFire(id, slot)) return false;
    const self = this.state.pokemon[id];
    const move = this.getMove(self.moves[slot].moveId)!;
    const f = this.fighters[id];
    f.energy -= R.moveEnergyCost(move.pp);
    f.cooldowns[slot] = R.moveCooldownMs(move.pp);
    f.globalCooldownMs = R.GLOBAL_COOLDOWN_MS;
    this.localHoldUntilMs = performance.now() + LOCAL_HOLD_MS;
    // The server fires from where it last heard you were — make that now.
    this.report(performance.now());
    this.send({ t: 'fire', slot, x: aim.x, y: aim.y });
    return true;
  }

  override dash(id: string): boolean {
    const self = this.state.pokemon[id];
    const f = this.fighters[id];
    if (id !== this.playerId || this.state.phase !== 'battle' || !this.isAlive(id)) return false;
    if (isIncapacitatingStatus(self.status) || f.dashCharges <= 0 || f.dashMs > 0) return false;
    const len = Math.hypot(f.moveInput.x, f.moveInput.y);
    const dir = len > 0.1 ? { x: f.moveInput.x / len, y: f.moveInput.y / len } : facingVector(self.facing);
    self.velocity = { x: dir.x * R.DASH_SPEED, y: dir.y * R.DASH_SPEED };
    f.dashMs = R.DASH_MS;
    f.dashCharges -= 1;
    this.localHoldUntilMs = performance.now() + LOCAL_HOLD_MS;
    this.send({ t: 'dash' });
    return true;
  }

  /** The server decides when an online match ends. */
  override endMatchNow(): void {}

  private stepOwn(dtMs: number, now: number): void {
    const me = this.playerId;
    if (this.state.phase !== 'battle' || !this.isAlive(me)) return;
    const self = this.state.pokemon[me];
    const f = this.fighters[me];
    this.ownAccumulatorMs += Math.min(dtMs, 100);
    while (this.ownAccumulatorMs >= R.ACTION_TICK_MS) {
      this.ownAccumulatorMs -= R.ACTION_TICK_MS;
      // Only the timers the HUD shows tick here; everything else is the server's.
      f.cooldowns = f.cooldowns.map((ms) => Math.max(0, ms - R.ACTION_TICK_MS));
      f.globalCooldownMs = Math.max(0, f.globalCooldownMs - R.ACTION_TICK_MS);
      f.aimFacingMs = Math.max(0, f.aimFacingMs - R.ACTION_TICK_MS);
      this.stepMovement(self, f, R.ACTION_TICK_MS / 1000);
      this.pushOutOfOthers(self);
    }
    if (now - this.lastSentReportMs >= REPORT_INTERVAL_MS) this.report(now);
  }

  /** Bodies still block you — against where the others are drawn, since
   * that's all this screen knows. */
  private pushOutOfOthers(self: PokemonInstance): void {
    for (const id of this.state.livingOrder) {
      if (id === self.instanceId) continue;
      const other = this.state.pokemon[id];
      const dx = self.position.x - other.position.x;
      const dy = self.position.y - other.position.y;
      const d = Math.hypot(dx, dy);
      const min = self.collisionRadius + other.collisionRadius;
      if (d >= min || d < 1e-6) continue;
      self.position.x += (dx / d) * (min - d);
      self.position.y += (dy / d) * (min - d);
    }
  }

  private report(now: number): void {
    this.lastSentReportMs = now;
    const self = this.state.pokemon[this.playerId];
    if (this.state.phase !== 'battle' || !this.isAlive(this.playerId)) return;
    this.send({
      t: 'move',
      x: Math.round(self.position.x * 10) / 10,
      y: Math.round(self.position.y * 10) / 10,
      vx: Math.round(self.velocity.x),
      vy: Math.round(self.velocity.y),
      facing: self.facing,
    });
  }

  private interpolateOthers(now: number): void {
    const renderAt = now - INTERP_DELAY_MS;
    const samples = this.samples;
    if (samples.length === 0) return;
    let older = samples[0];
    let newer = samples[samples.length - 1];
    for (let i = samples.length - 1; i > 0; i--) {
      if (samples[i - 1].atMs <= renderAt) {
        older = samples[i - 1];
        newer = samples[i];
        break;
      }
    }
    const span = newer.atMs - older.atMs;
    const t = span > 0 ? Math.max(0, Math.min(1, (renderAt - older.atMs) / span)) : 1;
    for (const [id, to] of Object.entries(newer.positions)) {
      const from = older.positions[id] ?? to;
      const p = this.state.pokemon[id];
      p.position = {
        x: from.x + (to.x - from.x) * t,
        y: from.y + (to.y - from.y) * t,
      };
    }
  }
}
