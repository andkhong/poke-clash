import Phaser from 'phaser';
import { ARENA_TOP_PADDING, isMobileArena } from '../../sim/constants';

// The arena floor. A portrait (mobile) arena shows one of the route images
// in map-assets/ at the repo root, scaled to cover the arena and centred (a
// sliver of each side is cropped, since the images are a little wider than
// the 900x1950 arena). A landscape (desktop) arena still gets the tiled
// ground below: cropped swatches from a CC0 tileset ("Top Down Grass, Beach
// and Water Tileset", OpenGameArt) repeated via TileSprite, with a
// procedural rock border.

/** Route images for the portrait arena. A match shows the first entry; to
 * try another, put the file in map-assets/ and list it here. Once there's
 * more than one worth keeping, the pick needs to come from something every
 * client of a multiplayer match shares (the match seed), not Math.random. */
const PORTRAIT_MAPS = [
  { key: 'map-1', url: new URL('../../../map-assets/map-1.jpeg', import.meta.url).href },
] as const;

const KEYS = {
  dirt: 'tileset-dirt',
  grass: 'tileset-grass',
};

export function preloadArenaTileset(scene: Phaser.Scene): void {
  scene.load.image(KEYS.dirt, new URL('./assets/dirt_swatch.png', import.meta.url).href);
  scene.load.image(KEYS.grass, new URL('./assets/grass_swatch.png', import.meta.url).href);
  for (const map of PORTRAIT_MAPS) scene.load.image(map.key, map.url);
}

export function createArenaBackground(scene: Phaser.Scene, width: number, height: number): void {
  const portraitMap = PORTRAIT_MAPS[0];
  if (isMobileArena({ width, height }) && scene.textures.exists(portraitMap.key)) {
    drawCoverImage(scene, portraitMap.key, width, height);
    return;
  }

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
 * whatever overflows the arena on the long side is outside the camera. */
function drawCoverImage(scene: Phaser.Scene, key: string, width: number, height: number): void {
  const source = scene.textures.get(key).getSourceImage();
  const scale = Math.max(width / source.width, height / source.height);
  scene.add.image(width / 2, height / 2, key).setScale(scale).setDepth(-100);
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
