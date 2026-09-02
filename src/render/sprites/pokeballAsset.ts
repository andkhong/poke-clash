import Phaser from 'phaser';

export const POKEBALL_TEXTURE_KEY = 'pokeball-icon';

export function preloadPokeballAsset(scene: Phaser.Scene): void {
  scene.load.image(POKEBALL_TEXTURE_KEY, new URL('./assets/pokeball.png', import.meta.url).href);
}
