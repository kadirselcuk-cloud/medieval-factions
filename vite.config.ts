import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const pkg = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf-8'),
) as { version: string };

/**
 * GitHub Pages serves this project from a sub-path, so built asset URLs must be prefixed
 * with the repository name. The dev server always serves from the root.
 *
 * Override with VITE_BASE when the deployment target changes — a custom domain, or a
 * Capacitor build, both want `/`.
 */
const REPO_BASE = '/medieval-factions/';

export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: process.env['VITE_BASE'] ?? (command === 'build' ? REPO_BASE : '/'),
  // package.json is the single source of truth for the version (see CLAUDE.md).
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    port: 5173,
    strictPort: false,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
}));
