import Phaser from 'phaser';
import type { EngineLike } from '../../sim/engineLike';
import type { SimState, Vec2 } from '../../sim/types';
import { EventCursor } from '../../sim/events';
import { POST_ATTACK_HOLD_MS } from '../../sim/constants';
import { STRUGGLE_MOVE, STRUGGLE_MOVE_ID } from '../../sim/struggle';
import { PokemonSprite } from '../sprites/PokemonSprite';
import { preloadArenaTileset, createArenaBackground } from '../tileset/arenaBackground';
import { preloadPokeballAsset } from '../sprites/pokeballAsset';
import { playMoveImpact } from '../vfx/moveEffects';
import { resolveMoveAnimation } from '../vfx/moveAnimations';
import { playBeamAttack } from '../vfx/moves/beamAttack';
import { playFlameAttack } from '../vfx/moves/flameAttack';
import { playImpactBurst } from '../vfx/moves/impactBurst';
import { playMoveSound, type MoveSoundHandle } from '../sound/moveSound';
import { playBattleMusic } from '../sound/battleMusic';
import { getMoveDefinition } from '../../data/loader';
import { teamColorHex } from '../../ui/teamColors';
import type { PmdSpriteIndex, SpriteIndex } from '../../data/types';
import spriteIndexData from '../../data/generated/spriteIndex.json';
import pmdSpriteIndexData from '../../data/generated/pmdSpriteIndex.json';

export interface ArenaSceneData {
  engine: EngineLike;
  /** Instance id of the current multiplayer player's own pick, if any — rendered with a highlight ring. */
  highlightInstanceId?: string | null;
}

const spriteIndex = spriteIndexData as SpriteIndex;
const pmdSpriteIndex = pmdSpriteIndexData as PmdSpriteIndex;

type MoveUsedEvent = Extract<import('../../sim/types').SimEvent, { type: 'moveUsed' }>;

/** A moveUsed event plus the attacker/target(s) positions and collision
 * radii at the instant it actually happened (captured in enqueueAttack, the
 * same tick the event is drained — see its own comment for why that's
 * effectively "at fire time"). Queued attacks can sit for a while behind
 * MAX_CONCURRENT_ATTACKS/staggering in a busy match, and handleMoveUsed used
 * to read the attacker/targets straight off the *live* SimState instead —
 * meaning a long-delayed attack would render using wherever those Pokémon
 * happen to be *now* (possibly a completely different target, if the
 * attacker has since retargeted, or nowhere near the original target if it's
 * moved since) rather than what actually happened, reading as an attack that
 * connects with nothing. Snapshotting once at enqueue time and never
 * touching live state again in handleMoveUsed fixes that regardless of how
 * long the event then waits in the queue. */
interface QueuedAttack {
  event: MoveUsedEvent;
  attackerPosition: Vec2;
  engagedTarget?: { position: Vec2; collisionRadius: number };
  hitTargets: { position: Vec2; collisionRadius: number }[];
}

/** Logs every moveUsed event as it's drained — unconditionally, before the
 * render's own attack-visual queue/dedup/drop logic (MAX_QUEUED_ATTACKS) ever
 * sees it, and using the same drain-time state QueuedAttack snapshots from,
 * so this is a ground-truth trace of attacker → target → damage that's
 * completely unaffected by whether (or how late) the on-screen animation for
 * it plays. Meant for tracing "who actually hit whom, and for how much"
 * against what a large/busy match visually shows — e.g. an HP bar dropping
 * with no attack animation visible (a dropped/queued attack — search this
 * log for the attacker/tick to confirm what really happened), or an attacker
 * that appears to swing at empty space. */
function logBattleEvent(event: MoveUsedEvent, state: Readonly<SimState>): void {
  const attacker = state.pokemon[event.attackerId];
  const move = event.moveId === STRUGGLE_MOVE_ID ? STRUGGLE_MOVE : getMoveDefinition(event.moveId);
  const attackerLabel = attacker ? `${attacker.name} (${attacker.instanceId})` : event.attackerId;
  const moveLabel = move?.name ?? `move#${event.moveId}`;

  const targetLabels = event.targetIds.map((targetId) => {
    const target = state.pokemon[targetId];
    const label = target ? `${target.name} (${targetId})` : targetId;
    if (!event.hit[targetId]) return `${label}: MISS`;

    const notes: string[] = [];
    if (event.crit[targetId]) notes.push('crit');
    const effectiveness = event.effectiveness[targetId];
    if (effectiveness > 1) notes.push('super effective');
    else if (effectiveness === 0) notes.push('no effect');
    else if (effectiveness < 1) notes.push('not very effective');
    const noteSuffix = notes.length > 0 ? ` (${notes.join(', ')})` : '';

    return `${label}: HIT ${event.damage[targetId] ?? 0} dmg${noteSuffix}`;
  });

  console.log(
    `[Battle Log] ${event.atMs}ms ${attackerLabel} used ${moveLabel} -> ${targetLabels.join(' | ') || '(no targets)'}`
  );
}

const MAX_CONCURRENT_ATTACKS = 4;
const ATTACK_QUEUE_STAGGER_MIN_MS = 250;
const ATTACK_QUEUE_STAGGER_MAX_MS = 500;
// Roughly the longest a single attack's visuals stay on screen (beam/flame
// charge+extend, lunge dash+impact burst, etc.) — used to know when a
// concurrency slot frees up, and (see handleMoveUsed's callers) when to cut
// off the move-name label, sound effect, and position lock. Shared verbatim
// with the sim's POST_ATTACK_HOLD_MS (how long the attacker actually holds
// still) rather than kept as a separate render-only constant — the two used
// to drift apart, which meant the sim was already off wandering by the time
// this window closed, and releasing the render's position lock onto that
// far-off real position read as a snap. See POST_ATTACK_HOLD_MS's own
// comment for the full story.
const ATTACK_VISUAL_DURATION_MS = POST_ATTACK_HOLD_MS;
// Safety valve: if the sim produces attacks faster than the pacing above can
// drain them (e.g. many Pokémon off cooldown in the same burst), don't let
// the backlog grow without bound — drop the oldest queued attacks so
// on-screen animations never fall far behind the live simulation. Damage/HP
// is already fully resolved in the sim regardless of whether the animation
// plays — dropped attacks show up as an HP-bar/log-only hit with no on-screen
// cause, so this is sized to comfortably cover the largest roster (16) rather
// than the old, much tighter 6, precisely to make that rarer in big matches.
const MAX_QUEUED_ATTACKS = 16;

/** Owns the tick loop (drives engine.tick each frame) and renders whatever the
 * engine's SimState says is true — it never mutates simulation state itself. */
export class ArenaScene extends Phaser.Scene {
  private engine!: EngineLike;
  private cursor!: EventCursor;
  private highlightInstanceId: string | null = null;
  private readonly sprites = new Map<string, PokemonSprite>();
  private readonly attackQueue: QueuedAttack[] = [];
  private activeAttackSlots = 0;

  constructor() {
    super('Arena');
  }

  init(data: ArenaSceneData | undefined): void {
    // Defensive: this scene is registered inactive and always started
    // explicitly with real data (see PhaserGame.tsx) — but guard anyway
    // against any Phaser-internal restart/boot path that might invoke init()
    // without it.
    if (!data?.engine) return;
    this.engine = data.engine;
    this.highlightInstanceId = data.highlightInstanceId ?? null;
    this.cursor = new EventCursor(this.engine);
    this.sprites.clear();
    this.attackQueue.length = 0;
    this.activeAttackSlots = 0;
  }

  preload(): void {
    preloadArenaTileset(this);
    preloadPokeballAsset(this);
  }

  create(): void {
    if (!this.engine) return; // init() was skipped (no data) — see init()
    const state = this.engine.getState();
    createArenaBackground(this, state.arena.width, state.arena.height);

    // livingOrder is allInstanceIds' spawn order minus anyone already
    // fainted, which circlePosition() (matchSetup.ts) lays out clockwise
    // from the top — so index order here is still the clockwise Pokéball-
    // drop sequence the sprite needs. Skipping already-fainted ids matters
    // for a multiplayer spectator joining mid-match: their `fainted` event
    // fired before this client's event log started, so nothing would ever
    // arrive to remove a sprite created for them here.
    state.livingOrder.forEach((id, index) => {
      const pokemon = state.pokemon[id];
      const sprite = new PokemonSprite(this, pokemon, spriteIndex, pmdSpriteIndex, index, state.shiny);
      if (id === this.highlightInstanceId) sprite.setHighlighted(true);
      if (state.teams) sprite.setTeamColor(teamColorHex(pokemon.team));
      this.sprites.set(id, sprite);
    });

    this.cameras.main.setBackgroundColor('#1a1a1a');
    playBattleMusic(this);
  }

  update(_time: number, delta: number): void {
    if (!this.engine) return;
    this.engine.tick(delta);
    const state = this.engine.getState();
    const now = state.elapsedMs;

    for (const id of state.livingOrder) {
      const pokemon = state.pokemon[id];
      this.sprites.get(id)?.update(pokemon, pokemon.position.x, pokemon.position.y, now, state.pokemon);
    }

    this.consumeEvents(state);
  }

  private consumeEvents(state: Readonly<SimState>): void {
    const events = this.cursor.drain();

    for (const event of events) {
      if (event.type === 'moveUsed') {
        logBattleEvent(event, state);
        this.enqueueAttack(event, state);
      } else if (event.type === 'fainted') {
        const sprite = this.sprites.get(event.instanceId);
        sprite?.playFaintAndDestroy(() => this.sprites.delete(event.instanceId));
        this.removeQueuedAttacksBy(event.instanceId);
      }
    }

    this.pumpAttackQueue();
  }

  // Snapshots attacker/target(s) position + collisionRadius right now, while
  // `state` is still (for all practical purposes) the state at the instant
  // this event fired — drain() runs every render frame, so this is at most
  // one frame stale, unlike the queue this feeds into, which can hold the
  // event for seconds in a busy match. See QueuedAttack's own comment.
  private enqueueAttack(event: MoveUsedEvent, state: Readonly<SimState>): void {
    const attacker = state.pokemon[event.attackerId];
    if (!attacker) return; // shouldn't happen — a moveUsed event's own attacker always exists this same tick
    const engagedSource = attacker.targetInstanceId ? state.pokemon[attacker.targetInstanceId] : undefined;
    const hitTargets: { position: Vec2; collisionRadius: number }[] = [];
    for (const targetId of event.targetIds) {
      if (!event.hit[targetId]) continue;
      const target = state.pokemon[targetId];
      if (target) hitTargets.push({ position: { ...target.position }, collisionRadius: target.collisionRadius });
    }

    this.attackQueue.push({
      event,
      attackerPosition: { ...attacker.position },
      engagedTarget: engagedSource
        ? { position: { ...engagedSource.position }, collisionRadius: engagedSource.collisionRadius }
        : undefined,
      hitTargets,
    });
    while (this.attackQueue.length > MAX_QUEUED_ATTACKS) this.attackQueue.shift();
  }

  // A Pokémon can faint (e.g. from a burn/poison status tick) while its own
  // earlier move is still sitting in the queue waiting for a slot. Without
  // this, that stale attack would eventually get dequeued, find no attacker
  // sprite (handleMoveUsed's existing `!attackerSprite` guard), and silently
  // no-op — wasting one of the concurrency slots and a full stagger delay on
  // nothing instead of letting a real pending attack play sooner.
  private removeQueuedAttacksBy(instanceId: string): void {
    for (let i = this.attackQueue.length - 1; i >= 0; i--) {
      if (this.attackQueue[i].event.attackerId === instanceId) this.attackQueue.splice(i, 1);
    }
  }

  private pumpAttackQueue(): void {
    while (this.activeAttackSlots < MAX_CONCURRENT_ATTACKS && this.attackQueue.length > 0) {
      const attack = this.attackQueue.shift()!;
      this.activeAttackSlots += 1;
      const attackEffects = this.handleMoveUsed(attack);
      this.time.delayedCall(ATTACK_VISUAL_DURATION_MS, () => {
        // The attack's on-screen animation is done by now (this timer is
        // also what frees up the concurrency slot below) — don't let its
        // sound effect, move-name callout, or position lock linger past
        // that point.
        attackEffects?.soundHandle?.stop();
        attackEffects?.hideMoveLabel();
        attackEffects?.unlockPosition();
        this.releaseAttackSlot();
      });
    }
  }

  private releaseAttackSlot(): void {
    this.activeAttackSlots -= 1;
    if (this.attackQueue.length > 0) {
      const stagger = Phaser.Math.Between(ATTACK_QUEUE_STAGGER_MIN_MS, ATTACK_QUEUE_STAGGER_MAX_MS);
      this.time.delayedCall(stagger, () => this.pumpAttackQueue());
    }
  }

  private handleMoveUsed(
    attack: QueuedAttack
  ): { soundHandle: MoveSoundHandle | undefined; hideMoveLabel: () => void; unlockPosition: () => void } | undefined {
    const { event, attackerPosition, engagedTarget, hitTargets } = attack;
    const attackerSprite = this.sprites.get(event.attackerId);
    const move = event.moveId === STRUGGLE_MOVE_ID ? STRUGGLE_MOVE : getMoveDefinition(event.moveId);
    if (!move || !attackerSprite) return undefined;

    const hideMoveLabel = attackerSprite.showMoveLabel(move);
    const soundHandle = playMoveSound(this, move);
    const { family } = resolveMoveAnimation(move);
    const ranged = family !== 'lunge';
    // The sim's own action-cooldown/wander transition kicks in almost
    // immediately after this move fires — well before this attack's on-screen
    // visual window (ATTACK_VISUAL_DURATION_MS, released below) closes — so
    // without this the attacker visibly drifts off mid-pose. Locked for lunge
    // attacks too, not just ranged ones: playLungeAttack's dash-and-return
    // (LUNGE_OUT_MS + LUNGE_BACK_MS, well under 300ms) finishes long before
    // this window does, and it moves the sprite via its own additive
    // attackOffset — entirely independent of renderPos (see attackOffset's
    // own doc comment) — so locking renderPos here doesn't fight that dash at
    // all, it just stops the *base* position drifting for the remainder of
    // the window once the dash itself is done.
    const unlockPosition = attackerSprite.lockPosition();
    // Face toward whoever the attacker was actually engaged with when this
    // fired (not necessarily event.targetIds[0] — a spread move's target
    // list isn't ordered by "primary"), so the swing always points the right
    // way even though the 'attack' AI state itself never turns to face its
    // target. Every family but lunge holds ground (see movement.ts's
    // 'attack' AI state) and fires from range, so prefer the species'
    // dedicated ranged-attack pose over the generic melee-swing Attack frame
    // there.
    attackerSprite.playPmdAttack(attackerPosition, engagedTarget?.position, ranged);

    if (family === 'lunge') {
      // A lunge repositions the attacker itself, so it only makes sense to
      // dash toward one point even for a (rare) multi-hit physical move —
      // the engaged target if there is one, else whichever hit target the
      // sim picked first. The impact flash still plays at every hit target.
      const lungeTarget = engagedTarget ?? hitTargets[0];
      if (lungeTarget) {
        attackerSprite.playLungeAttack(attackerPosition, lungeTarget.position, lungeTarget.collisionRadius, () => {
          for (const target of hitTargets) playImpactBurst(this, target.position.x, target.position.y, move.type);
        });
      }
    } else if (family === 'beam') {
      for (const target of hitTargets) {
        playBeamAttack(this, attackerPosition.x, attackerPosition.y, target.position.x, target.position.y, move.type);
      }
    } else if (family === 'flame') {
      for (const target of hitTargets) {
        playFlameAttack(this, attackerPosition.x, attackerPosition.y, target.position.x, target.position.y, move.type);
      }
    } else {
      for (const target of hitTargets) {
        playMoveImpact(this, attackerPosition.x, attackerPosition.y, target.position.x, target.position.y, move.type);
      }
    }

    return { soundHandle, hideMoveLabel, unlockPosition };
  }
}
