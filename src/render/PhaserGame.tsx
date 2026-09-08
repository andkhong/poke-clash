import { useEffect, useRef } from 'react';
import Phaser from 'phaser';
import type { EngineLike } from '../sim/engineLike';
import { ArenaScene } from './scenes/ArenaScene';
import { ARENA_HEIGHT, ARENA_WIDTH } from '../app/config';

export interface StageRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface PhaserGameProps {
  engine: EngineLike;
  highlightInstanceId?: string | null;
  /** Reports the actual on-screen rect of the game canvas (in px, relative to
   * this component's own container) every time Phaser's FIT scaling
   * recomputes it — lets overlay HUD elements (RosterPanel, BannerOverlay)
   * position themselves against the visible map instead of the full
   * (possibly letterboxed) container. */
  onStageRectChange?: (rect: StageRect) => void;
}

export function PhaserGame({ engine, highlightInstanceId = null, onStageRectChange }: PhaserGameProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const onStageRectChangeRef = useRef(onStageRectChange);
  onStageRectChangeRef.current = onStageRectChange;

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
    game.scene.start('Arena', { engine, highlightInstanceId });

    const container = containerRef.current;
    const reportStageRect = (): void => {
      const canvas = game.canvas;
      if (!canvas || !onStageRectChangeRef.current) return;
      const containerRect = container.getBoundingClientRect();
      const canvasRect = canvas.getBoundingClientRect();
      onStageRectChangeRef.current({
        left: canvasRect.left - containerRect.left,
        top: canvasRect.top - containerRect.top,
        width: canvasRect.width,
        height: canvasRect.height,
      });
    };

    // A ResizeObserver (rather than a plain window 'resize' listener, or only
    // Phaser's own scale 'resize' event) is the one hook that reliably fires
    // for every way the canvas's on-screen box can change — including its
    // very first layout pass, which happens on a later frame than this
    // synchronous `new Phaser.Game(...)` call returns, so reading
    // getBoundingClientRect() here immediately would race it. Both the canvas
    // (catches its own size changing) and the container (catches it being
    // re-centered when the container's aspect ratio shifts but the
    // FIT-computed canvas size doesn't) are observed.
    const resizeObserver = new ResizeObserver(reportStageRect);
    resizeObserver.observe(game.canvas);
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      game.destroy(true);
      if (gameRef.current === game) gameRef.current = null;
    };
    // Intentionally only re-mount if the engine instance itself changes (a
    // new match) — Phaser owns its own render loop after that. highlightInstanceId
    // is fixed for the whole match anyway (a multiplayer player's pick can't
    // change once the battle starts), so capturing it once here is correct.
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
