import Phaser from 'phaser';
import { ARENA_TOP_PADDING } from '../../sim/constants';

// The move-review stage's floor (see src/review): the fenced pitch in
// map-assets/wide-background, positioned around the two fighters. Should
// the image fail to load it gets the tiled ground instead: cropped swatches
// from a CC0 tileset ("Top Down Grass, Beach and Water Tileset",
// OpenGameArt) repeated via TileSprite, with a procedural rock border.
// (Play Mode draws its own stadium, see stadiumBackground.ts.)

/** The review stage's floor — see WIDE_ARENA_MAP in constants.ts before
 * swapping this for another image: the wide arena's playable border is
 * measured off this one. What ships is a 1920x1080 WebP (the desktop arena's own size,
 * ~150KB) made from the full-size wide-background.jpg beside it (2.3MB),
 * which stays in the repo as the master:
 *   node -e "require('sharp')('map-assets/wide-background.jpg').resize(1920).webp({quality:82}).toFile('map-assets/wide-background.webp')" */
const LANDSCAPE_MAP = {
  key: 'wide-background',
  url: new URL('../../../map-assets/wide-background.webp', import.meta.url).href,
} as const;

const KEYS = {
  dirt: 'tileset-dirt',
  grass: 'tileset-grass',
};

/** Queues the review stage's map image and the tiled ground's swatches (its fallback). */
export function preloadArenaTileset(scene: Phaser.Scene): void {
  scene.load.image(KEYS.dirt, new URL('./assets/dirt_swatch.png', import.meta.url).href);
  scene.load.image(KEYS.grass, new URL('./assets/grass_swatch.png', import.meta.url).href);
  scene.load.image(LANDSCAPE_MAP.key, LANDSCAPE_MAP.url);
}

/** The tiled dirt/grass ground with a rock border — the review stage's
 * fallback when its map image is missing. */
function createTiledArenaBackground(scene: Phaser.Scene, width: number, height: number): void {
  scene.add.tileSprite(0, 0, width, height, KEYS.dirt).setOrigin(0, 0).setDepth(-100);

  const grassW = width * 0.34;
  const grassH = height * 0.22;
  scene.add
    .tileSprite(width - grassW, height - grassH, grassW, grassH, KEYS.grass)
    .setOrigin(0, 0)
    .setDepth(-90);

  drawRockBorder(scene, width, height);
}

/** Draws the image scaled up just enough to cover `viewport`, but centred on
 * `focal` rather than on the viewport's own midpoint — so a landmark printed
 * at the image's center (the wide map's pokéball) lines up with wherever
 * `focal` is instead of with the screen's center. */
function drawCoverImageAt(
  scene: Phaser.Scene,
  key: string,
  viewport: { x: number; y: number; width: number; height: number },
  focal: { x: number; y: number }
): void {
  const source = scene.textures.get(key).getSourceImage();
  const scale = Math.max(
    (2 * Math.max(focal.x - viewport.x, viewport.x + viewport.width - focal.x)) / source.width,
    (2 * Math.max(focal.y - viewport.y, viewport.y + viewport.height - focal.y)) / source.height
  );
  scene.add.image(focal.x, focal.y, key).setScale(scale).setDepth(-100);
}

/** The move-review stage's floor (see ReviewScene): the same wide-background
 * map a landscape match arena uses, but positioned so its printed pokéball —
 * dead center of the source image — lands on `focal` (the point the two
 * fighters are centred around), which sits a bit off the viewport's own
 * midpoint. Falls back to the tiled ground if the image didn't load. */
export function createReviewArenaBackground(
  scene: Phaser.Scene,
  viewport: { x: number; y: number; width: number; height: number },
  focal: { x: number; y: number }
): void {
  if (scene.textures.exists(LANDSCAPE_MAP.key)) {
    drawCoverImageAt(scene, LANDSCAPE_MAP.key, viewport, focal);
    return;
  }
  createTiledArenaBackground(scene, viewport.x + viewport.width, viewport.y + viewport.height);
}

function drawRockBorder(scene: Phaser.Scene, width: number, height: number): void {
  const graphics = scene.add.graphics().setDepth(-80);
  const spacing = 34;
  const margin = 12;
  // The top edge of the fenced-in playable area sits at ARENA_TOP_PADDING
  // (movement.ts clamps every Pokémon's position to stay below this same
  // line) rather than at `margin` like the other three sides — that strip
  // above the fence is reserved screen space for the roster/HP HUD overlay
  // (RosterPanel), so the fence also visually marks where the HUD's "no-go"
  // zone ends.
  const topY = ARENA_TOP_PADDING;

  const placeRock = (x: number, y: number): void => {
    const r = Phaser.Math.Between(8, 14);
    const jx = Phaser.Math.Between(-5, 5);
    const jy = Phaser.Math.Between(-5, 5);
    graphics.fillStyle(0x4f473f, 1);
    graphics.fillCircle(x + jx, y + jy + 2, r);
    graphics.fillStyle(0x6b6259, 1);
    graphics.fillCircle(x + jx, y + jy, r);
  };

  for (let x = margin; x < width; x += spacing) {
    placeRock(x, topY);
    placeRock(x, height - margin);
  }
  for (let y = topY + spacing; y < height - margin; y += spacing) {
    placeRock(margin, y);
    placeRock(width - margin, y);
  }
}
