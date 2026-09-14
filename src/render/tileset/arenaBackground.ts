import Phaser from 'phaser';
import { ARENA_TOP_PADDING, isMobileArena } from '../../sim/constants';
import type { ArenaBounds } from '../../sim/types';

// The arena floor: one of the hand-made map images in map-assets/ at the
// repo root, scaled to cover the arena and centred. A portrait (mobile)
// arena shows a route image (a sliver of each side is cropped, since it's a
// little wider than the 900x1950 arena); a landscape (desktop) arena shows
// the fenced pitch in wide-background.jpg, whose 16:9 matches the desktop
// arena exactly so nothing is cropped — the fence in that image is the
// playable area's border, which the sim enforces from the same measurements
// (see constants.ts's WIDE_ARENA_MAP / getFenceInsets). The move-review
// stage (and either arena, should its image fail to load) gets the tiled
// ground instead: cropped swatches from a CC0 tileset ("Top Down Grass,
// Beach and Water Tileset", OpenGameArt) repeated via TileSprite, with a
// procedural rock border.

/** Route images for the portrait arena. A match shows the first entry; to
 * try another, put the file in map-assets/ and list it here. Once there's
 * more than one worth keeping, the pick needs to come from something every
 * client of a multiplayer match shares (the match seed), not Math.random. */
const PORTRAIT_MAPS = [
  { key: 'map-1', url: new URL('../../../map-assets/map-1.jpeg', import.meta.url).href },
] as const;

/** The landscape arena's floor — see WIDE_ARENA_MAP in constants.ts before
 * swapping this for another image: the fence border there is measured off
 * this one. What ships is a 1920x1080 WebP (the desktop arena's own size,
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

/** The map image an arena of this shape draws. */
function mapForArena(arena: ArenaBounds): { key: string; url: string } {
  return isMobileArena(arena) ? PORTRAIT_MAPS[0] : LANDSCAPE_MAP;
}

/** Queues the tiled ground's swatches (every floor's fallback) and the one
 * map image the scene will draw: the one for `map`'s shape for a match arena,
 * the landscape map for the move-review stage ('review'), or none (null).
 * Never both maps — the wide one is most of an arena's first download, so a
 * portrait match shouldn't fetch it, nor a wide one the route image. */
export function preloadArenaTileset(scene: Phaser.Scene, map: ArenaBounds | 'review' | null): void {
  scene.load.image(KEYS.dirt, new URL('./assets/dirt_swatch.png', import.meta.url).href);
  scene.load.image(KEYS.grass, new URL('./assets/grass_swatch.png', import.meta.url).href);
  if (map === null) return;
  const image = map === 'review' ? LANDSCAPE_MAP : mapForArena(map);
  scene.load.image(image.key, image.url);
}

/** A match arena's floor: the map image for its shape, or the tiled ground
 * if that image didn't load. */
export function createArenaBackground(scene: Phaser.Scene, width: number, height: number): void {
  const map = mapForArena({ width, height });
  if (scene.textures.exists(map.key)) {
    drawCoverImage(scene, map.key, width, height);
    return;
  }
  createTiledArenaBackground(scene, width, height);
}

/** The tiled dirt/grass ground with a rock border — the move-review stage's
 * floor (see ReviewScene), and the fallback for a match arena whose map
 * image is missing. */
export function createTiledArenaBackground(scene: Phaser.Scene, width: number, height: number): void {
  scene.add.tileSprite(0, 0, width, height, KEYS.dirt).setOrigin(0, 0).setDepth(-100);

  const grassW = width * 0.34;
  const grassH = height * 0.22;
  scene.add
    .tileSprite(width - grassW, height - grassH, grassW, grassH, KEYS.grass)
    .setOrigin(0, 0)
    .setDepth(-90);

  drawRockBorder(scene, width, height);
}

/** Draws the image centred on the arena, scaled up just enough to cover it;
 * whatever overflows the arena on the long side is outside the camera. The
 * same placement getFenceInsets (constants.ts) assumes when it maps the
 * wide map's fence into arena coordinates — keep the two in step. */
function drawCoverImage(scene: Phaser.Scene, key: string, width: number, height: number): void {
  drawCoverImageAt(scene, key, { x: 0, y: 0, width, height }, { x: width / 2, y: height / 2 });
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
