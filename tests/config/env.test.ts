import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getAppEnv } from '../../src/config/env';
import { APP_ENV_KEYS, selectAppEnv, type AppEnvSnapshot } from '../../src/types/env';
import { EnvFileError, loadProjectEnv } from '../../src/config/envLoader';

describe('public env contract', () => {
  const originalEnv = { ...process.env };
  const key = APP_ENV_KEYS.platformBaseUrl;
  const windowWithEnv = window as unknown as { host?: { env?: AppEnvSnapshot } };
  const originalHost = windowWithEnv.host;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env[key];
    delete windowWithEnv.host;
  });

  afterEach(() => {
    process.env = originalEnv;
    windowWithEnv.host = originalHost;
  });

  it('selectAppEnv keeps only non-empty contract keys and trims values', () => {
    const selected = selectAppEnv({
      UNKNOWN_SECRET: 'must-not-leak',
      [key]: '  https://config.example.com  ',
      [APP_ENV_KEYS.otaCatalogMeituan]: '   ',
    });

    expect(selected).toEqual({ [key]: 'https://config.example.com' });
  });

  it('getAppEnv reads an allowlisted key from process.env', () => {
    process.env[key] = 'https://process.example.com';

    expect(getAppEnv(key)).toBe('https://process.example.com');
  });

  it('getAppEnv reads an allowlisted key from host injection', () => {
    windowWithEnv.host = { env: { [key]: 'https://host.example.com' } };

    expect(getAppEnv(key)).toBe('https://host.example.com');
  });

  it('getAppEnv returns empty for an allowlisted but missing key', () => {
    expect(getAppEnv(key)).toBe('');
  });

  it('desktop host injection takes precedence over process.env', () => {
    windowWithEnv.host = { env: { [key]: 'https://host.example.com' } };
    process.env[key] = 'https://process.example.com';

    expect(getAppEnv(key)).toBe('https://host.example.com');
  });
});

describe('project env loader', () => {
  let envRoot: string;

  beforeEach(() => {
    envRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'smartlink-env-'));
  });

  afterEach(() => {
    fs.rmSync(envRoot, { recursive: true, force: true });
  });

  it('applies project files over the host environment in a documented order', () => {
    fs.writeFileSync(path.join(envRoot, '.env'), 'SAMPLE_KEY=base\nHOST_KEY=file-base\n');
    fs.writeFileSync(path.join(envRoot, '.env.local'), 'SAMPLE_KEY=local\n');
    fs.writeFileSync(path.join(envRoot, '.env.development'), 'SAMPLE_KEY=mode\nONLY_MODE=yes\n');
    fs.writeFileSync(path.join(envRoot, '.env.development.local'), 'SAMPLE_KEY=mode-local\n');

    const env = loadProjectEnv('development', envRoot, {
      HOST_KEY: 'host',
      ONLY_HOST: 'host',
    });

    expect(env.SAMPLE_KEY).toBe('mode-local');
    expect(env.ONLY_MODE).toBe('yes');
    expect(env.HOST_KEY).toBe('file-base');
    expect(env.ONLY_HOST).toBe('host');
  });

  it('parses quoted values and preserves URL fragments', () => {
    fs.writeFileSync(
      path.join(envRoot, '.env'),
      [
        'PLAIN_URL=https://example.com/path',
        'QUOTED_URL="https://example.com/orders#/unhandled"',
        'COMMENTED_VALUE=value # explanation',
      ].join('\n')
    );

    const env = loadProjectEnv('development', envRoot, {});

    expect(env.PLAIN_URL).toBe('https://example.com/path');
    expect(env.QUOTED_URL).toBe('https://example.com/orders#/unhandled');
    expect(env.COMMENTED_VALUE).toBe('value');
  });

  it('fails fast with the file path and line number for invalid syntax', () => {
    const filePath = path.join(envRoot, '.env.development');
    fs.writeFileSync(filePath, 'VALID=yes\nINVALID_LINE\n');

    expect(() => loadProjectEnv('development', envRoot, {})).toThrow(EnvFileError);

    try {
      loadProjectEnv('development', envRoot, {});
      throw new Error('expected loadProjectEnv to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(EnvFileError);
      const envError = error as EnvFileError;
      expect(envError.filePath).toBe(filePath);
      expect(envError.lineNumber).toBe(2);
      expect(envError.message).toContain('INVALID_LINE');
    }
  });
});
