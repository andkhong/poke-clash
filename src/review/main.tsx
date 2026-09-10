import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ReviewApp } from './ReviewApp';

// The move-VFX review page (review.html) — a second entry alongside the
// game's own main.tsx. Same font warm-up: the in-battle move label
// (PokemonSprite.showMoveLabel) is drawn on the stage here too.
void document.fonts.load('13px "Press Start 2P"');

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root element not found');

createRoot(rootEl).render(
  <StrictMode>
    <ReviewApp />
  </StrictMode>
);
