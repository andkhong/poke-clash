import Phaser from 'phaser';

// Ground textures are cropped swatches from a real CC0 tileset ("Top Down
// Grass, Beach and Water Tileset" by the OpenGameArt CC0 collection) rather
// than a Pokémon-branded asset. Repeated via TileSprite instead of relying on
// the source tileset's exact tile-grid alignment (which wasn't documented) —
// simpler and robust, at the cost of true multi-tile transition art. The rock
// border is procedural since no matching rock tile was sourced this session;
// swap in real tiles later without touching ArenaScene.
const KEYS = {
  dirt: 'tileset-dirt',
  grass: 'tileset-grass',
};

export function preloadArenaTileset(scene: Phaser.Scene): void {
  scene.load.image(KEYS.dirt, new URL('./assets/dirt_swatch.png', import.meta.url).href);
  scene.load.image(KEYS.grass, new URL('./assets/grass_swatch.png', import.meta.url).href);
}

export function createArenaBackground(scene: Phaser.Scene, width: number, height: number): void {
  scene.add.tileSprite(0, 0, width, height, KEYS.dirt).setOrigin(0, 0).setDepth(-100);

  const grassW = width * 0.34;
  const grassH = height * 0.22;
  scene.add
    .tileSprite(width - grassW, height - grassH, grassW, grassH, KEYS.grass)
    .setOrigin(0, 0)
    .setDepth(-90);

  drawRockBorder(scene, width, height);
}

function drawRockBorder(scene: Phaser.Scene, width: number, height: number): void {
  const graphics = scene.add.graphics().setDepth(-80);
  const spacing = 34;
  const margin = 12;

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
    placeRock(x, margin);
    placeRock(x, height - margin);
  }
  for (let y = margin + spacing; y < height - margin; y += spacing) {
    placeRock(margin, y);
    placeRock(width - margin, y);
  }
}
