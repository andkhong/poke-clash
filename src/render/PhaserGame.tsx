import { useEffect, useRef } from 'react';
import Phaser from 'phaser';
import type { EngineLike } from '../sim/engineLike';
import { ArenaScene } from './scenes/ArenaScene';

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
  /** Fired once, right after this Phaser instance's canvas exists — it's
   * stable for the life of the instance, so a consumer (see
   * useRoomThumbnailCapture) can hold onto it instead of re-reading it. */
  onCanvasReady?: (canvas: HTMLCanvasElement) => void;
  /** Keep the WebGL drawing buffer readable after each frame is presented
   * (Phaser's render.preserveDrawingBuffer) — needed only by a consumer
   * that reads pixels back off the canvas outside the render loop (see
   * useRoomThumbnailCapture). Off by default: retaining the buffer costs
   * an extra full-canvas copy per frame on most GPUs, which solo play and
   * the always-on showcase room (never captured) shouldn't pay. Read once
   * at mount, like the arena size. */
  captureFrames?: boolean;
}

export function PhaserGame({ engine, highlightInstanceId = null, onStageRectChange, onCanvasReady, captureFrames = false }: PhaserGameProps) {
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
      finishDestroyIfHidden(gameRef.current);
      gameRef.current = null;
    }

    // Read off the match's real arena (not a fixed constant) — a Custom
    // Battle "Small"/"Tiny" map, or the mobile-vs-wide-desktop arena picked at
    // match start (see app/config.ts's resolveMatchArena), would otherwise
    // render inside the wrong-sized canvas: content confined to a corner
    // instead of filling it, since Phaser's own FIT scaling only scales
    // *this* canvas to its container, it can't correct for the canvas
    // itself being the wrong resolution to begin with.
    const { width: arenaWidth, height: arenaHeight } = engine.getState().arena;
    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: containerRef.current,
      width: arenaWidth,
      height: arenaHeight,
      backgroundColor: '#1a1a1a',
      // WebGL clears its drawing buffer once a frame is presented unless
      // told to keep it — without this, useRoomThumbnailCapture's drawImage
      // (which runs on its own timer, well after any given frame finishes
      // presenting) reads back an already-cleared buffer and produces a
      // solid black capture. Standard Phaser screenshot-capture setting,
      // opted into per mount (see captureFrames) since it isn't free.
      render: { preserveDrawingBuffer: captureFrames },
      scale: {
        mode: Phaser.Scale.FIT,
        // The container below centres the canvas with flexbox; Phaser must
        // not also centre it. Its CENTER_BOTH works by writing margin-left/
        // top onto the canvas, and flexbox then centres the canvas *plus*
        // those margins — so a letterboxed canvas (the portrait arena on a
        // desktop-wide page) landed half the letterbox off-centre, and the
        // HUD overlay (positioned from the canvas's measured rect, see
        // reportStageRect) drifted with it whenever Phaser's periodic
        // re-centre moved the canvas without resizing it: roster/HP bars
        // sitting off to one side, the bottom-right buttons pushed out of
        // the frame's clipped area.
        autoCenter: Phaser.Scale.NO_CENTER,
      },
      // No `scene` in the initial config — that form auto-boots the scene
      // immediately with no init data, which crashed init() reading
      // `data.engine` before this explicit start() (with real data) ever
      // got a chance to run. Registering with autoStart=false avoids that.
    });
    gameRef.current = game;
    onCanvasReady?.(game.canvas);

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
    // Phaser's own re-fit (its ScaleManager polls the parent's size every
    // half second, and answers window resizes) rewrites the canvas's style
    // size; the observer above sees that too, but listening here as well
    // costs nothing and keeps the overlay right even if a re-fit ever moves
    // the canvas without changing its measured size.
    game.scale.on(Phaser.Scale.Events.RESIZE, reportStageRect);

    return () => {
      resizeObserver.disconnect();
      game.scale.off(Phaser.Scale.Events.RESIZE, reportStageRect);
      game.destroy(true);
      finishDestroyIfHidden(game);
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

/** Game#destroy only flags the game; the actual teardown (Phaser's private
 * Game#runDestroy) runs at the start of its next frame. That frame never
 * comes while the tab is hidden — the loop is requestAnimationFrame-driven
 * and a hidden tab gets no animation frames — so a landing page left in a
 * background tab stacked up one still-live Game (its WebGL context,
 * AudioContext and listeners) per showcase-room round, all torn down at
 * once whenever the tab was next looked at. Nothing here ever runs from
 * inside a Phaser step, so the teardown can simply be finished now. Only
 * for a game that has actually started: an unstarted one (React
 * StrictMode's dev double-mount destroys a game the same instant it's
 * created) still has its boot pending, and that boot would restart the loop
 * on an already-torn-down game — its own first step handles the flag. */
function finishDestroyIfHidden(game: Phaser.Game): void {
  if (document.visibilityState !== 'hidden' || !game.isRunning) return;
  (game as unknown as { runDestroy: () => void }).runDestroy();
}
