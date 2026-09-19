import { describe, it, expect } from 'vitest';
import viteConfig from '../../vite.config';
import rendererServerConfig from '../../src/config/rendererServer.json';

describe('renderer asset server configuration', () => {
  it('disables Vite built-in environment exposure for every command', async () => {
    for (const command of ['serve', 'build'] as const) {
      const config = await viteConfig({ command, mode: 'development' });

      expect(config.envPrefix).toEqual([]);
      expect(config.define).toBeUndefined();
      expect(config.resolve?.conditions).toEqual(['browser']);
    }
  });

  it('binds the local renderer asset server to localhost only', async () => {
    const config = await viteConfig({ command: 'serve', mode: 'development' });

    expect(config.server?.host).toBe('127.0.0.1');
    expect(config.server?.port).toBe(3000);
  });

  it('exposes one renderer server URL contract to runtime consumers', () => {
    const parsedUrl = new URL(rendererServerConfig.url);

    expect(parsedUrl.hostname).toBe(rendererServerConfig.hostname);
    expect(parsedUrl.port).toBe(String(rendererServerConfig.port));
    expect(parsedUrl.protocol).toBe('http:');
  });
});
