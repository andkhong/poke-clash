import type { Vec2 } from '../types';
import { facingVector, type ActionEngine } from './ActionEngine';

/** How far ahead of the fighter a shot with no other aim is pointed — past
 * every move's range, so only the direction matters. */
const FREE_AIM_REACH = 600;

/**
 * The human player's side of Play Mode: keyboard, mouse and touch all write
 * here, and it turns that into ActionEngine calls. Holds no DOM or Phaser
 * code so both the arena scene (keys/mouse) and the React HUD (touch
 * joystick and buttons) can share one instance.
 */
export class PlayerController {
  /** WASD/arrow direction, each axis -1..1. */
  keyMove: Vec2 = { x: 0, y: 0 };
  /** Touch joystick, length ≤ 1 — wins over the keys while it's pushed. */
  stickMove: Vec2 = { x: 0, y: 0 };
  /** Last mouse position in arena px; null until the mouse moves (touch devices). */
  mouseAim: Vec2 | null = null;
  /** Direction a held move button is being dragged, for touch manual aim. */
  dragAim: Vec2 | null = null;
  lockOn: boolean;
  lockTargetId: string | null = null;

  constructor(
    readonly engine: ActionEngine,
    lockOn: boolean
  ) {
    this.lockOn = lockOn;
  }

  get playerId(): string {
    return this.engine.playerId;
  }

  /** Once per frame, before the engine ticks. */
  update(): void {
    const stick = Math.hypot(this.stickMove.x, this.stickMove.y) > 0.05 ? this.stickMove : this.keyMove;
    this.engine.setMoveInput(this.playerId, stick.x, stick.y);
    if (this.lockOn && !this.isValidTarget(this.lockTargetId)) this.lockTargetId = this.nearestEnemyId();
  }

  fire(slot: number, dragDirection?: Vec2 | null): boolean {
    return this.engine.fire(this.playerId, slot, this.aimPoint(dragDirection));
  }

  dash(): boolean {
    return this.engine.dash(this.playerId);
  }

  toggleLock(): void {
    this.lockOn = !this.lockOn;
    this.lockTargetId = this.lockOn ? this.nearestEnemyId() : null;
  }

  /** Steps the lock to the next enemy by distance, wrapping around. */
  cycleTarget(): void {
    const ids = this.enemiesByDistance();
    if (ids.length === 0) return;
    const next = ids[(ids.indexOf(this.lockTargetId ?? '') + 1) % ids.length];
    this.lockOn = true;
    this.lockTargetId = next;
  }

  /** Where a shot fired now goes: a drag wins, then the lock, then the mouse,
   * then straight ahead. */
  aimPoint(dragDirection?: Vec2 | null): Vec2 {
    const self = this.engine.getState().pokemon[this.playerId];
    const ahead = (dir: Vec2): Vec2 => ({ x: self.position.x + dir.x * FREE_AIM_REACH, y: self.position.y + dir.y * FREE_AIM_REACH });
    if (dragDirection) return ahead(dragDirection);
    if (this.lockOn && this.isValidTarget(this.lockTargetId)) return { ...this.engine.getState().pokemon[this.lockTargetId!].position };
    if (this.mouseAim) return { ...this.mouseAim };
    return ahead(facingVector(self.facing));
  }

  private isValidTarget(id: string | null): boolean {
    return id !== null && this.engine.enemiesOf(this.playerId).some((p) => p.instanceId === id);
  }

  private nearestEnemyId(): string | null {
    return this.enemiesByDistance()[0] ?? null;
  }

  private enemiesByDistance(): string[] {
    const self = this.engine.getState().pokemon[this.playerId];
    const d = (p: Vec2) => Math.hypot(p.x - self.position.x, p.y - self.position.y);
    return this.engine
      .enemiesOf(this.playerId)
      .sort((a, b) => d(a.position) - d(b.position))
      .map((p) => p.instanceId);
  }
}
