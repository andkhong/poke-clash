import Phaser from 'phaser';
import type { SimulationEngine } from '../../sim/engine';
import { EventCursor } from '../../sim/events';
import { STRUGGLE_MOVE, STRUGGLE_MOVE_ID } from '../../sim/struggle';
import { PokemonSprite } from '../sprites/PokemonSprite';
import { preloadArenaTileset, createArenaBackground } from '../tileset/arenaBackground';
import { preloadPokeballAsset } from '../sprites/pokeballAsset';
import { playMoveImpact } from '../vfx/moveEffects';
import { getMoveDefinition } from '../../data/loader';
import type { SpriteIndex } from '../../data/types';
import spriteIndexData from '../../data/generated/spriteIndex.json';

export interface ArenaSceneData {
  engine: SimulationEngine;
}

const spriteIndex = spriteIndexData as SpriteIndex;

/** Owns the tick loop (drives engine.tick each frame) and renders whatever the
 * engine's SimState says is true — it never mutates simulation state itself. */
export class ArenaScene extends Phaser.Scene {
  private engine!: SimulationEngine;
  private cursor!: EventCursor;
  private readonly sprites = new Map<string, PokemonSprite>();

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
    this.cursor = new EventCursor(this.engine);
    this.sprites.clear();
  }

  preload(): void {
    preloadArenaTileset(this);
    preloadPokeballAsset(this);
  }

  create(): void {
    if (!this.engine) return; // init() was skipped (no data) — see init()
    const state = this.engine.getState();
    createArenaBackground(this, state.arena.width, state.arena.height);

    // allInstanceIds is spawn order, which circlePosition() (matchSetup.ts)
    // already lays out clockwise from the top — so index order here is
    // exactly the clockwise Pokéball-drop sequence the sprite needs.
    state.allInstanceIds.forEach((id, index) => {
      const pokemon = state.pokemon[id];
      this.sprites.set(id, new PokemonSprite(this, pokemon, spriteIndex, index));
    });

    this.cameras.main.setBackgroundColor('#1a1a1a');
  }

  update(_time: number, delta: number): void {
    if (!this.engine) return;
    this.engine.tick(delta);
    const state = this.engine.getState();
    const now = state.elapsedMs;

    for (const id of state.livingOrder) {
      const pokemon = state.pokemon[id];
      this.sprites.get(id)?.update(pokemon, pokemon.position.x, pokemon.position.y, now);
    }

    this.consumeEvents();
  }

  private consumeEvents(): void {
    const events = this.cursor.drain();
    const state = this.engine.getState();

    for (const event of events) {
      if (event.type === 'moveUsed') {
        this.handleMoveUsed(event, state);
      } else if (event.type === 'fainted') {
        const sprite = this.sprites.get(event.instanceId);
        sprite?.playFaintAndDestroy(() => this.sprites.delete(event.instanceId));
      }
    }
  }

  private handleMoveUsed(
    event: Extract<import('../../sim/types').SimEvent, { type: 'moveUsed' }>,
    state: ReturnType<SimulationEngine['getState']>
  ): void {
    const attacker = state.pokemon[event.attackerId];
    const attackerSprite = this.sprites.get(event.attackerId);
    const move = event.moveId === STRUGGLE_MOVE_ID ? STRUGGLE_MOVE : getMoveDefinition(event.moveId);
    if (!attacker || !move || !attackerSprite) return;

    attackerSprite.showMoveLabel(move);

    for (const targetId of event.targetIds) {
      if (!event.hit[targetId]) continue;
      const target = state.pokemon[targetId];
      if (!target) continue;
      playMoveImpact(this, attacker.position.x, attacker.position.y, target.position.x, target.position.y, move.type);
    }
  }
}
