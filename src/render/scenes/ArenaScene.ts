import Phaser from 'phaser';
import type { EngineLike } from '../../sim/engineLike';
import type { PokemonInstance, SimState } from '../../sim/types';
import { EventCursor } from '../../sim/events';
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

const MAX_CONCURRENT_ATTACKS = 2;
const ATTACK_QUEUE_STAGGER_MIN_MS = 500;
const ATTACK_QUEUE_STAGGER_MAX_MS = 1000;
// Roughly the longest a single attack's visuals stay on screen (beam/flame
// charge+extend, lunge dash+impact burst, etc.) — used to know when a
// concurrency slot frees up, and (see handleMoveUsed's callers) when to cut
// off the move-name label and sound effect. An approximation is fine since
// none of the vfx helpers currently report completion. 800ms rather than a
// shorter value so the animation is actually perceivable rather than a blip.
const ATTACK_VISUAL_DURATION_MS = 1200;
// Safety valve: if the sim produces attacks faster than the pacing above can
// drain them (e.g. many Pokémon off cooldown in the same burst), don't let
// the backlog grow without bound — drop the oldest queued attacks so
// on-screen animations never fall far behind the live simulation. Damage/HP
// is already fully resolved in the sim regardless of whether the animation plays.
const MAX_QUEUED_ATTACKS = 6;

/** Owns the tick loop (drives engine.tick each frame) and renders whatever the
 * engine's SimState says is true — it never mutates simulation state itself. */
export class ArenaScene extends Phaser.Scene {
  private engine!: EngineLike;
  private cursor!: EventCursor;
  private highlightInstanceId: string | null = null;
  private readonly sprites = new Map<string, PokemonSprite>();
  private readonly attackQueue: MoveUsedEvent[] = [];
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

    this.consumeEvents();
  }

  private consumeEvents(): void {
    const events = this.cursor.drain();

    for (const event of events) {
      if (event.type === 'moveUsed') {
        this.enqueueAttack(event);
      } else if (event.type === 'fainted') {
        const sprite = this.sprites.get(event.instanceId);
        sprite?.playFaintAndDestroy(() => this.sprites.delete(event.instanceId));
        this.removeQueuedAttacksBy(event.instanceId);
      }
    }

    this.pumpAttackQueue();
  }

  private enqueueAttack(event: MoveUsedEvent): void {
    this.attackQueue.push(event);
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
      if (this.attackQueue[i].attackerId === instanceId) this.attackQueue.splice(i, 1);
    }
  }

  private pumpAttackQueue(): void {
    while (this.activeAttackSlots < MAX_CONCURRENT_ATTACKS && this.attackQueue.length > 0) {
      const event = this.attackQueue.shift()!;
      this.activeAttackSlots += 1;
      const attackEffects = this.handleMoveUsed(event, this.engine.getState());
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
    event: MoveUsedEvent,
    state: Readonly<SimState>
  ): { soundHandle: MoveSoundHandle | undefined; hideMoveLabel: () => void; unlockPosition: () => void } | undefined {
    const attacker = state.pokemon[event.attackerId];
    const attackerSprite = this.sprites.get(event.attackerId);
    const move = event.moveId === STRUGGLE_MOVE_ID ? STRUGGLE_MOVE : getMoveDefinition(event.moveId);
    if (!attacker || !move || !attackerSprite) return undefined;

    const hideMoveLabel = attackerSprite.showMoveLabel(move);
    const soundHandle = playMoveSound(this, move);
    const { family } = resolveMoveAnimation(move);
    const ranged = family !== 'lunge';
    // The sim's own action-cooldown/wander transition kicks in almost
    // immediately after this move fires — well before this attack's on-screen
    // visual window (ATTACK_VISUAL_DURATION_MS, released below) closes — so a
    // ranged attacker would otherwise visibly drift off mid-pose. A lunge
    // attacker is exempt: it's *supposed* to move (playLungeAttack's cosmetic
    // dash toward the target), so freezing it here would fight that.
    const unlockPosition = ranged ? attackerSprite.lockPosition() : () => {};
    // Face toward whoever the attacker is actually engaged with (not
    // necessarily event.targetIds[0] — a spread move's target list isn't
    // ordered by "primary"), so the swing always points the right way even
    // though the 'attack' AI state itself never turns to face its target.
    const engagedTarget = attacker.targetInstanceId ? state.pokemon[attacker.targetInstanceId] : undefined;
    // Every family but lunge holds ground (see movement.ts's 'attack' AI
    // state) and fires from range, so prefer the species' dedicated
    // ranged-attack pose over the generic melee-swing Attack frame there.
    attackerSprite.playPmdAttack(attacker.position, engagedTarget?.position, ranged);

    const hitTargets: PokemonInstance[] = [];
    for (const targetId of event.targetIds) {
      if (!event.hit[targetId]) continue;
      const target = state.pokemon[targetId];
      if (target) hitTargets.push(target);
    }

    if (family === 'lunge') {
      // A lunge repositions the attacker itself, so it only makes sense to
      // dash toward one point even for a (rare) multi-hit physical move —
      // the engaged target if there is one, else whichever hit target the
      // sim picked first. The impact flash still plays at every hit target.
      const lungeTarget = engagedTarget ?? hitTargets[0];
      if (lungeTarget) {
        attackerSprite.playLungeAttack(attacker.position, lungeTarget.position, lungeTarget.collisionRadius, () => {
          for (const target of hitTargets) playImpactBurst(this, target.position.x, target.position.y, move.type);
        });
      }
    } else if (family === 'beam') {
      for (const target of hitTargets) {
        playBeamAttack(this, attacker.position.x, attacker.position.y, target.position.x, target.position.y, move.type);
      }
    } else if (family === 'flame') {
      for (const target of hitTargets) {
        playFlameAttack(this, attacker.position.x, attacker.position.y, target.position.x, target.position.y, move.type);
      }
    } else {
      for (const target of hitTargets) {
        playMoveImpact(this, attacker.position.x, attacker.position.y, target.position.x, target.position.y, move.type);
      }
    }

    return { soundHandle, hideMoveLabel, unlockPosition };
  }
}
