import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv, type Plugin } from 'vite';

function crawlerApiPlugin(): Plugin {
  return {
    name: 'smartlink-crawler-api',
    async configureServer(server) {
      const { createCrawlerApiMiddleware } = await import('./src/server/crawlerMiddleware');
      const { createDutyApiMiddleware } = await import('./src/server/dutyMiddleware');
      server.middlewares.use(createCrawlerApiMiddleware());
      server.middlewares.use(createDutyApiMiddleware());
    },
    async configurePreviewServer(server) {
      const { createCrawlerApiMiddleware } = await import('./src/server/crawlerMiddleware');
      const { createDutyApiMiddleware } = await import('./src/server/dutyMiddleware');
      server.middlewares.use(createCrawlerApiMiddleware());
      server.middlewares.use(createDutyApiMiddleware());
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  // 同步环境变量至当前 Node 进程，确保 Vite 中间件及服务端爬虫引擎具备相同变量可见性
  Object.assign(process.env, env);

  return {
    base: './',
    plugins: [react(), tailwindcss(), crawlerApiPlugin()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      port: 3000,
      host: '0.0.0.0',
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
    preview: {
      port: 3000,
      host: '0.0.0.0',
    },
  };
});
