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

    // React 18 StrictMode double-invokes this effect in dev; if the previous
    // instance's cleanup hasn't fully torn down yet, destroy it before
    // creating a new one rather than ending up with two live games.
    if (gameRef.current) {
      gameRef.current.destroy(true);
      gameRef.current = null;
    }

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
      // No `scene` in the initial config — that form auto-boots the scene
      // immediately with no init data, which crashed init() reading
      // `data.engine` before this explicit start() (with real data) ever
      // got a chance to run. Registering with autoStart=false avoids that.
    });
    gameRef.current = game;

    // This Phaser version has no config flag to opt out of auto-pausing on
    // blur/hidden (Phaser.Core.Game#onHidden / #onBlur call loop.pause() /
    // loop.blur() directly) — a match is meant to keep running like the
    // ambient/passive viewing experience in the source videos even if the
    // tab isn't focused, so those hooks are neutralized here.
    const gameInternals = game as unknown as { onHidden: () => void; onBlur: () => void };
    gameInternals.onHidden = () => {};
    gameInternals.onBlur = () => {};

    game.scene.add('Arena', ArenaScene, false);
    game.scene.start('Arena', { engine });

    return () => {
      game.destroy(true);
      if (gameRef.current === game) gameRef.current = null;
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
