import Phaser from 'phaser';
import type { EngineLike } from '../../sim/engineLike';
import type { SimState, Vec2 } from '../../sim/types';
import { EventCursor } from '../../sim/events';
import { MAX_SIMULTANEOUS_ATTACKS, POST_ATTACK_HOLD_MS } from '../../sim/constants';
import { STRUGGLE_MOVE, STRUGGLE_MOVE_ID } from '../../sim/struggle';
import { PokemonSprite } from '../sprites/PokemonSprite';
import { preloadArenaTileset, createArenaBackground } from '../tileset/arenaBackground';
import { preloadPokeballAsset } from '../sprites/pokeballAsset';
import { frameDurationMs, playAnimation, type AnimationHandle } from '../vfx/anim/AnimPlayer';
import { animationScaleFor } from '../vfx/anim/geometry';
import { getLoadedMoveAnimation, getMoveAnimationEntry, queueAnimationLoads, requestMoveAnimation } from '../vfx/anim/moveAnimLoader';
import { playFallbackFlash } from '../vfx/anim/fallbackFlash';
import { resolveMoveAnimation } from '../vfx/moveAnimations';
import { playFamilyVfx, preloadFamilyVfxAssets } from '../vfx/moves/playFamilyVfx';
import { STATUS_COMMON_ANIMATIONS } from '../../data/moveAnimationFormat';
import { playMoveSound, type MoveSoundHandle } from '../sound/moveSound';
import { playBattleMusic } from '../sound/battleMusic';
import { installMasterLimiter } from '../sound/masterBus';
import { getMoveDefinition } from '../../data/loader';
import { teamColorHex } from '../../ui/teamColors';
import type { PmdSpriteIndex, SpriteIndex } from '../../data/types';
import spriteIndexData from '../../data/generated/spriteIndex.json';
import { pmdSpriteIndexUrl } from '../sprites/pmdSheetUrl';

export interface ArenaSceneData {
  engine: EngineLike;
  /** Instance id of the current multiplayer player's own pick, if any — rendered with a highlight ring. */
  highlightInstanceId?: string | null;
}

const spriteIndex = spriteIndexData as SpriteIndex;
// The PMD frame-metadata index is ~1.4 MB and only needed here, so it's a
// static file fetched in preload() (see pmdSpriteIndexUrl) rather than part
// of the bundle every visitor downloads for the menus.
const PMD_SPRITE_INDEX_KEY = 'pmd-sprite-index';

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
interface AttackTargetSnapshot {
  instanceId: string;
  position: Vec2;
  collisionRadius: number;
}

interface QueuedAttack {
  event: MoveUsedEvent;
  attackerPosition: Vec2;
  engagedTarget?: AttackTargetSnapshot;
  hitTargets: AttackTargetSnapshot[];
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

// How many attack visuals can be in flight at once. The sim's own attack
// gate (MAX_SIMULTANEOUS_ATTACKS, see engine.ts's stepActions) is what
// actually paces attacks now: it never lets more than that many be in their
// POST_ATTACK_HOLD_MS window at once, and leaves ATTACK_GAP_MS of quiet after
// each one ends, so ordinarily this cap is never even reached — every attack
// the sim produces gets its visual, and the "HP bar moved with no visible
// cause" overflow that a higher render-side cap used to guard against can't
// happen. Pinned to the same constant so the render side can never show
// more simultaneous attacks than the sim intends, even if a burst of events
// drains in one frame after a hitch (see MAX_ATTACK_QUEUE_AGE_MS for what
// happens to the stragglers).
const MAX_CONCURRENT_ATTACKS = MAX_SIMULTANEOUS_ATTACKS;
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
    this.load.json(PMD_SPRITE_INDEX_KEY, pmdSpriteIndexUrl());
    preloadArenaTileset(this);
    preloadPokeballAsset(this);
    preloadFamilyVfxAssets(this);
    // Every move this roster can actually use is known up front (each
    // Pokémon's four slots are fixed at match setup), so their animations
    // and sheets download with the rest of the arena's assets instead of on
    // first use — see moveAnimLoader.ts. Struggle is always possible.
    if (this.engine) {
      const state = this.engine.getState();
      const moveIds = new Set<number>([STRUGGLE_MOVE_ID]);
      for (const id of state.livingOrder) {
        for (const slot of state.pokemon[id]?.moves ?? []) moveIds.add(slot.moveId);
      }
      queueAnimationLoads(this, moveIds, Object.values(STATUS_COMMON_ANIMATIONS));
    }
  }

  create(): void {
    if (!this.engine) return; // init() was skipped (no data) — see init()
    const state = this.engine.getState();
    createArenaBackground(this, state.arena.width, state.arena.height);

    // Missing only if the fetch in preload() failed; every sprite then goes
    // through its hotlink/fallback tiers instead of drawing nothing.
    const pmdSpriteIndex = (this.cache.json.get(PMD_SPRITE_INDEX_KEY) as PmdSpriteIndex | undefined) ?? null;
    if (!pmdSpriteIndex) console.warn('[ArenaScene] PMD sprite index failed to load; falling back to hotlinked/static art');

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
    // Before any sound plays: the Pokéball-pop cries the sprites above are
    // about to fire overlap heavily, and everything is loudness-normalized
    // to targets hot enough to need this — see mix.ts.
    installMasterLimiter(this);
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
    const hitTargets: AttackTargetSnapshot[] = [];
    for (const targetId of event.targetIds) {
      if (!event.hit[targetId]) continue;
      const target = state.pokemon[targetId];
      const position = event.targetPositions[targetId];
      if (target && position) hitTargets.push({ instanceId: targetId, position, collisionRadius: target.collisionRadius });
    }

    this.attackQueue.push({
      event,
      attackerPosition: event.attackerPosition,
      engagedTarget:
        engagedTargetId && engagedSource && engagedPosition
          ? { instanceId: engagedTargetId, position: engagedPosition, collisionRadius: engagedSource.collisionRadius }
          : undefined,
      hitTargets,
    });
    while (this.attackQueue.length > MAX_QUEUED_ATTACKS) this.attackQueue.shift();
  }

  // A Pokémon can faint (e.g. from a burn/poison status tick) while its own
  // earlier move is still sitting in the queue waiting for a slot. Without
  // this, that stale attack would eventually get dequeued, find no attacker
  // sprite (handleMoveUsed's existing `!attackerSprite` guard), and silently
  // no-op — wasting one of the concurrency slots (and however long it sat
  // queued first) on nothing instead of letting a real pending attack play
  // sooner.
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
        // also what frees up the concurrency slot below; the animation
        // itself is paced to fit inside it — see frameDurationMs) — don't
        // let its sound effect, move-name callout, or position lock linger
        // past that point.
        attackEffects?.animation?.stop();
        attackEffects?.soundHandle?.stop();
        attackEffects?.hideMoveLabel();
        attackEffects?.unlockPosition();
        this.releaseAttackSlot();
      });
    }
  }

  // Just frees the slot — no need to explicitly re-pump the queue here.
  // update() calls consumeEvents() (which ends with pumpAttackQueue()) every
  // rendered frame regardless of what triggered this call, so the freed slot
  // gets noticed and refilled on the very next frame on its own. An earlier
  // version scheduled a further 250-500ms "stagger" delay here before
  // re-pumping, on top of that — which never actually staggered anything
  // (the per-frame pump always got there first) and just ate into how many
  // attacks could be drained per second, worsening the exact
  // dropped-attack/missing-visual problem MAX_CONCURRENT_ATTACKS's own
  // comment describes.
  private releaseAttackSlot(): void {
    this.activeAttackSlots -= 1;
  }

  private handleMoveUsed(attack: QueuedAttack): AttackEffects | undefined {
    const { event, attackerPosition, engagedTarget, hitTargets } = attack;
    const attackerSprite = this.sprites.get(event.attackerId);
    const move = event.moveId === STRUGGLE_MOVE_ID ? STRUGGLE_MOVE : getMoveDefinition(event.moveId);
    if (!move || !attackerSprite) return undefined;

    const hideMoveLabel = attackerSprite.showMoveLabel(move);
    const soundHandle = playMoveSound(this, move);
    // A move whose pack animation is a screen-wide effect (or that has no
    // pack animation at all) plays the arena's own family VFX instead —
    // see MoveAnimationIndexEntry.screen and moves/playFamilyVfx.ts.
    const entry = getMoveAnimationEntry(move.id);
    const family = !entry || entry.screen ? resolveMoveAnimation(move).family : null;
    // Melee-swing pose for a physical move or any animation that dashes the
    // attacker into its target (the pack marks those — see the index's
    // `melee`; the family VFX's own lunge); every other move holds ground
    // and fires from range, so prefer the species' dedicated ranged-attack
    // pose there.
    const ranged = family ? family !== 'lunge' : !(entry?.melee || move.category === 'physical');
    // The sim's own action-cooldown/wander transition kicks in almost
    // immediately after this move fires — well before this attack's on-screen
    // visual window (ATTACK_VISUAL_DURATION_MS, released below) closes — so
    // without this the attacker visibly drifts off mid-pose. The animation
    // moves the sprite via its own additive animOffset — entirely
    // independent of renderPos (see PokemonSprite.setAnimOffset) — so
    // locking renderPos here doesn't fight a dash at all, it just stops the
    // *base* position drifting for the remainder of the window.
    const unlockPosition = attackerSprite.lockPosition();
    // Face toward whoever the attacker was actually engaged with when this
    // fired (not necessarily event.targetIds[0] — a spread move's target
    // list isn't ordered by "primary"), so the swing always points the right
    // way even though the 'attack' AI state itself never turns to face its
    // target.
    attackerSprite.playPmdAttack(attackerPosition, engagedTarget?.position, ranged);

    // One attack, one target, one animation — never a beam/jet/dash to more
    // than one Pokémon. The sim itself now only ever lands a move on the
    // single engaged target (see engine.ts's resolveTargets), so hitTargets
    // holds at most one entry; this still deliberately picks exactly one
    // (the engaged target if it was hit, else the first hit) rather than
    // looping, so a multi-target event from an older game server in a
    // multiplayer room can't draw the fan of simultaneous effects this used
    // to produce. A self-targeting move (Swords Dance, ...) has no target at
    // all: its animation plays on the attacker, which the sim never counts
    // as a hit (see engine.ts's early return for `targeting === 'self'`).
    const hitTarget = pickVfxTarget(engagedTarget, hitTargets);
    const selfTargeting = move.targeting === 'self';
    // A miss still plays the attack, aimed at wherever the target stood
    // when the move fired — the target then dodges out of that spot (see
    // playMissReaction), so the effect visibly lands on empty ground.
    const missedTarget = !hitTarget && !selfTargeting ? engagedTarget : undefined;
    const target = hitTarget ?? missedTarget;
    if (family) {
      // Family VFX are one-shot effects flown from the fire-time snapshot
      // to the single target; a self-targeting move shows pose/label/sound
      // only, as it always has.
      if (target) playFamilyVfx(this, family, attackerPosition, target.position, target.collisionRadius, move.type, attackerSprite);
      if (missedTarget) this.playMissReaction(missedTarget, attackerPosition, family === 'lunge' ? LUNGE_MISS_DELAY_MS : FAMILY_MISS_DELAY_MS);
      return { soundHandle, hideMoveLabel, unlockPosition };
    }
    if (!target && !selfTargeting) return { soundHandle, hideMoveLabel, unlockPosition }; // nothing to aim at: pose/label/sound only

    // Anchors are read live every frame so the animation follows a target
    // that keeps walking during the attack, falling back to the positions
    // snapshotted when the move fired once a sprite is gone (fainted). A
    // missed target is deliberately NOT followed: the attack goes where it
    // was, and it steps away from there.
    const targetSprite = hitTarget ? this.sprites.get(hitTarget.instanceId) : undefined;
    const getAttacker = (): Vec2 => (attackerSprite.isDestroyed() ? attackerPosition : attackerSprite.getRenderPosition());
    const getTarget = (): Vec2 => {
      if (!target) return getAttacker();
      return targetSprite && !targetSprite.isDestroyed() ? targetSprite.getRenderPosition() : target.position;
    };
    const impact = target ? target.position : attackerPosition;

    const loaded = getLoadedMoveAnimation(this, move.id);
    if (!loaded) {
      // Not downloaded yet (a move outside the roster's preloaded slots, or
      // a failed fetch): show something at the point of impact now and
      // fetch it for the next use.
      playFallbackFlash(this, impact.x, impact.y, move.type);
      requestMoveAnimation(this, move.id);
      if (missedTarget) this.playMissReaction(missedTarget, attackerPosition, 0);
      return { soundHandle, hideMoveLabel, unlockPosition };
    }
    // A handful of the pack's animations only move or tint the battlers
    // and draw nothing themselves (Psychic, Confusion, Struggle, ...) —
    // layer the flash under those so a hit is never invisible.
    if (!loaded.sheetKey) playFallbackFlash(this, impact.x, impact.y, move.type);

    const animation = playAnimation({
      scene: this,
      data: loaded.data,
      sheetKey: loaded.sheetKey,
      getAttacker,
      getTarget,
      scale: animationScaleFor(attackerSprite.getOnScreenSize()),
      msPerFrame: frameDurationMs(loaded.data.frames.length, ATTACK_VISUAL_DURATION_MS),
      attacker: attackerSprite,
      target: hitTarget && targetSprite !== attackerSprite ? targetSprite : undefined,
    });
    if (missedTarget) {
      // Dodge once the attack has had time to arrive — most pack animations
      // reach the target somewhere in their first third.
      this.playMissReaction(missedTarget, attackerPosition, Math.min(MAX_MISS_DELAY_MS, animation.durationMs * MISS_DELAY_FRACTION));
    }

    return { soundHandle, hideMoveLabel, unlockPosition, animation };
  }

  /** The missed target's side of a miss: its sprite sidesteps the attack
   * and pops a "MISS" callout (see PokemonSprite.playDodge), `delayMs`
   * after the attack starts so the effect lands where it stood. */
  private playMissReaction(target: AttackTargetSnapshot, attackerPosition: Vec2, delayMs: number): void {
    this.sprites.get(target.instanceId)?.playDodge(attackerPosition, delayMs);
  }
}

/** When a missed target starts its dodge relative to the attack's start:
 * pack animations reach the target within roughly their first third
 * (capped, since long animations are time-compressed anyway); the family
 * VFX's beams/jets take ~200ms to arrive and a lunge lands at its 120ms
 * apex. */
const MISS_DELAY_FRACTION = 0.35;
const MAX_MISS_DELAY_MS = 300;
const FAMILY_MISS_DELAY_MS = 200;
const LUNGE_MISS_DELAY_MS = 100;

interface AttackEffects {
  soundHandle: MoveSoundHandle | undefined;
  hideMoveLabel: () => void;
  unlockPosition: () => void;
  animation?: AnimationHandle;
}

/** The single Pokémon an attack's VFX flies at: the one the attacker was
 * engaged with, provided the move actually connected with it, else whichever
 * hit the sim listed first; undefined when nothing was hit at all. */
function pickVfxTarget(
  engagedTarget: AttackTargetSnapshot | undefined,
  hitTargets: readonly AttackTargetSnapshot[]
): AttackTargetSnapshot | undefined {
  if (engagedTarget && hitTargets.some((t) => t.instanceId === engagedTarget.instanceId)) return engagedTarget;
  return hitTargets[0];
}
