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
import { playBeamAttack, preloadBeamVfxAssets } from '../vfx/moves/beamAttack';
import { playFlameAttack, preloadFlameVfxAssets } from '../vfx/moves/flameAttack';
import { playThunderAttack, preloadThunderVfxAssets } from '../vfx/moves/thunderAttack';
import { playLeafAttack, preloadLeafVfxAssets } from '../vfx/moves/leafAttack';
import { playBubbleAttack, preloadBubbleVfxAssets } from '../vfx/moves/bubbleAttack';
import { playWaveAttack } from '../vfx/moves/waveAttack';
import { playIceShardAttack, preloadIceShardVfxAssets } from '../vfx/moves/iceShardAttack';
import { playVortexAttack, preloadVortexVfxAssets } from '../vfx/moves/vortexAttack';
import { playRockBurstAttack, preloadRockBurstVfxAssets } from '../vfx/moves/rockBurstAttack';
import { playPoisonAttack, preloadPoisonVfxAssets } from '../vfx/moves/poisonAttack';
import { playHydroPumpAttack, preloadHydroPumpVfxAssets } from '../vfx/moves/hydroPumpAttack';
import { playImpactBurst } from '../vfx/moves/impactBurst';
import { playLungePunchFlash, preloadLungeVfxAssets } from '../vfx/moves/lungeImpact';
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
// A second safety valve alongside MAX_QUEUED_ATTACKS above, for the case that
// actually shows up first in a busy match: queue depth never hits 16, but an
// individual attack still sits behind a handful of others for several hundred
// ms+ before a slot frees. Both attacker and target keep simulating live the
// whole time (wandering, re-targeting, even fainting-and-respawning-as-a-
// corpse-position) — see enqueueAttack's own comment — so replaying that
// attack with its enqueue-time snapshot once it's this old draws a beam/pose
// wherever those Pokémon *were*, which by now can be nowhere near either of
// them: a beam or flame jet seemingly out of thin air in a random patch of
// the arena. Skipping the visual for anything queued longer than this doesn't
// lose anything the player would've correctly understood anyway — the HP bar
// already moved when the hit actually landed (see MAX_QUEUED_ATTACKS's own
// comment on damage being resolved regardless) — it just stops a stale replay
// from looking like an attack that came from nowhere.
const MAX_ATTACK_QUEUE_AGE_MS = 600;

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
    preloadPoisonVfxAssets(this);
    preloadHydroPumpVfxAssets(this);
    preloadThunderVfxAssets(this);
    preloadIceShardVfxAssets(this);
    preloadBubbleVfxAssets(this);
    preloadLeafVfxAssets(this);
    preloadRockBurstVfxAssets(this);
    preloadVortexVfxAssets(this);
    preloadBeamVfxAssets(this);
    preloadFlameVfxAssets(this);
    preloadLungeVfxAssets(this);
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

  // Uses the moveUsed event's own attackerPosition/targetPositions (not live
  // state.pokemon[...].position) — engine.ts snapshots those onto the event
  // at the exact instant the move fires, which matters because live position
  // can change later in this very same tick: a KOing hit has sweepFaints()
  // null out the attacker's targetInstanceId (see primaryTargetId's own
  // comment below), and a match-ending hit has completeMatch() teleport the
  // sole winner to the arena center for its victory pose — both run after
  // maybeAct() has already fired this move but before this ever drains.
  // Reading live position for that second case would render a finishing
  // ranged attack's beam/jet as if it came from the arena center instead of
  // wherever the attacker actually stood when it fired. collisionRadius is
  // still read live since, unlike position, it never changes after spawn.
  private enqueueAttack(event: MoveUsedEvent, state: Readonly<SimState>): void {
    const attacker = state.pokemon[event.attackerId];
    if (!attacker) return; // shouldn't happen — a moveUsed event's own attacker always exists this same tick
    // event.primaryTargetId (not attacker.targetInstanceId) — a KOing hit has
    // sweepFaints() null out the attacker's live targetInstanceId later in
    // this same tick (see engine.ts), before this ever drains, so reading the
    // live field here would lose the target on every finishing blow and leave
    // the attacker facing a stale direction while its VFX still (correctly)
    // flies at the real target. The event's own primaryTargetId is a fixed
    // snapshot from when the move actually fired, so it's never affected.
    const engagedTargetId = event.primaryTargetId;
    const engagedPosition = engagedTargetId ? event.targetPositions[engagedTargetId] : undefined;
    const engagedSource = engagedTargetId ? state.pokemon[engagedTargetId] : undefined;
    const hitTargets: { position: Vec2; collisionRadius: number }[] = [];
    for (const targetId of event.targetIds) {
      if (!event.hit[targetId]) continue;
      const target = state.pokemon[targetId];
      const position = event.targetPositions[targetId];
      if (target && position) hitTargets.push({ position, collisionRadius: target.collisionRadius });
    }

    this.attackQueue.push({
      event,
      attackerPosition: event.attackerPosition,
      engagedTarget:
        engagedSource && engagedPosition
          ? { position: engagedPosition, collisionRadius: engagedSource.collisionRadius }
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
    const nowMs = this.engine.getState().elapsedMs;
    while (this.activeAttackSlots < MAX_CONCURRENT_ATTACKS && this.attackQueue.length > 0) {
      const attack = this.attackQueue.shift()!;
      // See MAX_ATTACK_QUEUE_AGE_MS: too old to still show up where either
      // Pokémon visually is — skip the visual (for free — no slot consumed)
      // rather than draw it floating in whatever spot they've since left.
      if (nowMs - attack.event.atMs > MAX_ATTACK_QUEUE_AGE_MS) continue;
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
          for (const target of hitTargets) {
            playImpactBurst(this, target.position.x, target.position.y, move.type);
            playLungePunchFlash(this, target.position.x, target.position.y);
          }
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
    } else if (family === 'thunder') {
      for (const target of hitTargets) {
        playThunderAttack(this, attackerPosition.x, attackerPosition.y, target.position.x, target.position.y, move.type);
      }
    } else if (family === 'leaf') {
      for (const target of hitTargets) {
        playLeafAttack(this, attackerPosition.x, attackerPosition.y, target.position.x, target.position.y, move.type);
      }
    } else if (family === 'bubble') {
      for (const target of hitTargets) {
        playBubbleAttack(this, attackerPosition.x, attackerPosition.y, target.position.x, target.position.y, move.type);
      }
    } else if (family === 'wave') {
      for (const target of hitTargets) {
        playWaveAttack(this, attackerPosition.x, attackerPosition.y, target.position.x, target.position.y, move.type);
      }
    } else if (family === 'iceShard') {
      for (const target of hitTargets) {
        playIceShardAttack(this, attackerPosition.x, attackerPosition.y, target.position.x, target.position.y, move.type);
      }
    } else if (family === 'vortex') {
      for (const target of hitTargets) {
        playVortexAttack(this, attackerPosition.x, attackerPosition.y, target.position.x, target.position.y, move.type);
      }
    } else if (family === 'rockBurst') {
      for (const target of hitTargets) {
        playRockBurstAttack(this, attackerPosition.x, attackerPosition.y, target.position.x, target.position.y, move.type);
      }
    } else if (family === 'poison') {
      for (const target of hitTargets) {
        playPoisonAttack(this, attackerPosition.x, attackerPosition.y, target.position.x, target.position.y, move.type);
      }
    } else if (family === 'hydroPump') {
      for (const target of hitTargets) {
        playHydroPumpAttack(this, attackerPosition.x, attackerPosition.y, target.position.x, target.position.y, move.type);
      }
    } else {
      for (const target of hitTargets) {
        playMoveImpact(this, attackerPosition.x, attackerPosition.y, target.position.x, target.position.y, move.type);
      }
    }

    return { soundHandle, hideMoveLabel, unlockPosition };
  }
}
