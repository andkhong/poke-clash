// ESLint 9 flat config, assembled only from packages already in
// devDependencies. `npm run lint` (eslint .) covers the app, both servers,
// the data pipeline, the Vite plugin and the build scripts; generated/static
// output and the asset mirrors are skipped.
import js from '@eslint/js';
import globals from 'globals';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default [
  {
    ignores: [
      'dist/**',
      'dist-server/**',
      'node_modules/**',
      'public/**',
      'pmd-sprite-mirror/**',
      'deploy-assets/**',
      'sound/**',
      'sound-track/**',
      'sound-optimized/**',
      'sound-track-optimized/**',
      'Gen 9 Move Animation Project/**',
      'examples/**',
      'data-pipeline/cache/**',
    ],
  },
  js.configs.recommended,
  ...tsPlugin.configs['flat/recommended'],
  {
    files: ['**/*.{ts,tsx,js,mjs}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parser: tsParser,
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
];
