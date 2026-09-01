import { useEffect, useRef } from 'react';
import Phaser from 'phaser';
import type { SimulationEngine } from '../sim/engine';
import { ArenaScene } from './scenes/ArenaScene';
import { ARENA_HEIGHT, ARENA_WIDTH } from '../app/config';

interface PhaserGameProps {
  engine: SimulationEngine;
}

export function PhaserGame({ engine }: PhaserGameProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: containerRef.current,
      width: ARENA_WIDTH,
      height: ARENA_HEIGHT,
      backgroundColor: '#1a1a1a',
      scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
      },
      scene: [ArenaScene],
    });
    gameRef.current = game;
    game.scene.start('Arena', { engine });

    return () => {
      game.destroy(true);
      gameRef.current = null;
    };
    // Intentionally only re-mount if the engine instance itself changes
    // (a new match) — Phaser owns its own render loop after that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine]);

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    />
  );
}
