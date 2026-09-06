import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Root } from './Root';

// Kick off the move-label pixel font fetch as early as possible so it's
// already cached by the time the first in-battle move is used (PokemonSprite.ts).
void document.fonts.load('13px "Press Start 2P"');

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root element not found');

createRoot(rootEl).render(
  <StrictMode>
    <Root />
  </StrictMode>
);
