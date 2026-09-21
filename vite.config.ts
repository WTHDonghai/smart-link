import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';
import { loadProjectEnv } from './src/config/envLoader';
import rendererServerConfig from './src/config/rendererServer.json';
import { PROCESS_ENV_KEYS } from './src/types/env';

export default defineConfig(({ mode }) => {
  const projectEnv = loadProjectEnv(mode, process.cwd());
  Object.assign(process.env, projectEnv);

  return {
    base: './',
    plugins: [react(), tailwindcss()],
    build: {
      target: 'chrome130',
    },
    envPrefix: [],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
      conditions: ['browser'],
    },
    server: {
      port: rendererServerConfig.port,
      host: rendererServerConfig.hostname,
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify: file watching is disabled to prevent flickering during agent edits.
      hmr: process.env[PROCESS_ENV_KEYS.disableHmr] !== 'true',
      watch: process.env[PROCESS_ENV_KEYS.disableHmr] === 'true' ? null : {},
    },
  };
});
