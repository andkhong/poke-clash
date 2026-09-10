import { useEffect, useRef } from 'react';
import Phaser from 'phaser';
import { REVIEW_STAGE_HEIGHT, REVIEW_STAGE_WIDTH, ReviewScene, type ReviewSceneData } from './ReviewScene';

interface ReviewStageProps {
  /** The fighters and layout to boot with; later changes go through the
   * scene's own setters (see ReviewApp), not a remount. */
  initial: ReviewSceneData;
  /** Called with the scene once the game exists, and with null on teardown. */
  onScene: (scene: ReviewScene | null) => void;
}

/** Mounts the review stage's Phaser game — same config as the match's
 * PhaserGame (FIT-scaled canvas, no auto-pause on blur) — into a 16:9 box. */
export function ReviewStage({ initial, onScene }: ReviewStageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const initialRef = useRef(initial);
  const onSceneRef = useRef(onScene);
  onSceneRef.current = onScene;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    // React 18 StrictMode double-invokes this effect in dev; tear down a
    // previous instance rather than ending up with two live games.
    gameRef.current?.destroy(true);

    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: container,
      width: REVIEW_STAGE_WIDTH,
      height: REVIEW_STAGE_HEIGHT,
      backgroundColor: '#1a1a1a',
      scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    });
    gameRef.current = game;
    // Keep playing while the tab/window is unfocused, like a match does.
    const internals = game as unknown as { onHidden: () => void; onBlur: () => void };
    internals.onHidden = () => {};
    internals.onBlur = () => {};

    const scene = new ReviewScene();
    game.scene.add('Review', scene, false);
    game.scene.start('Review', initialRef.current);
    onSceneRef.current(scene);

    return () => {
      onSceneRef.current(null);
      game.destroy(true);
      if (gameRef.current === game) gameRef.current = null;
    };
  }, []);

  return <div ref={containerRef} className="stage" style={{ aspectRatio: `${REVIEW_STAGE_WIDTH} / ${REVIEW_STAGE_HEIGHT}` }} />;
}
