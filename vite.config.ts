import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const PMD_SPRITE_SERVER_PORT = process.env.PMD_SPRITE_SERVER_PORT ?? '4310';

export default defineConfig({
  plugins: [react()],
  server: {
    // Forwards to sprite-server/ (run separately via `npm run sprite:serve`
    // or `npm run dev:all`) so client code can fetch root-relative
    // /pmd-sprites/... URLs, same as it already does for /cries/....
    proxy: {
      '/pmd-sprites': `http://localhost:${PMD_SPRITE_SERVER_PORT}`,
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
