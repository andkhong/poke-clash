// Shared by the landing page's nav, footer, featured frame and room cards.

/** Reuses the in-battle Pokéball sprite (see pokeballAsset.ts) as the brand
 * mark — same URL-import trick Phaser's loader uses, since this project has
 * no image module typings for a plain `import x from './x.png'`. The path is
 * relative to this file: src/ui/landing → src/render. */
export const pokeballUrl = new URL('../../render/sprites/assets/pokeball.png', import.meta.url).href;

export const KO_FI_URL = 'https://ko-fi.com/hermito';
