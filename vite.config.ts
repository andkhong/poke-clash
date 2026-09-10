import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const PMD_SPRITE_SERVER_PORT = process.env.PMD_SPRITE_SERVER_PORT ?? '4310';
const GAME_SERVER_PORT = process.env.GAME_SERVER_PORT ?? '4311';

export default defineConfig({
  plugins: [react()],
  server: {
    // Forwards to sprite-server/ (run separately via `npm run sprite:serve`
    // or `npm run dev:all`) so client code can fetch root-relative
    // /pmd-sprites/... and /soundtracks/... URLs, same as it already does
    // for /cries/... and /move-sounds/... (static files under public/).
    // /api forwards to game-server/ (the
    // multiplayer room server) the same way, including its SSE room stream.
    proxy: {
      '/pmd-sprites': `http://localhost:${PMD_SPRITE_SERVER_PORT}`,
      '/soundtracks': `http://localhost:${PMD_SPRITE_SERVER_PORT}`,
      '/api': `http://localhost:${GAME_SERVER_PORT}`,
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'game-server/**/*.test.ts', 'sprite-server/**/*.test.ts'],
  },
});
