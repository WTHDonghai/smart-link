import fs from 'node:fs';
import path from 'node:path';

export class EnvFileError extends Error {
  readonly filePath: string;
  readonly lineNumber?: number;

  constructor(message: string, filePath: string, lineNumber?: number, cause?: unknown) {
    super(message, { cause });
    this.name = 'EnvFileError';
    this.filePath = filePath;
    this.lineNumber = lineNumber;
  }
}

const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

function parseEnvValue(raw: string): string {
  const value = raw.trim();

  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
    return value
      .slice(1, -1)
      .replace(/\\(["\\nrt])/g, (_: string, escaped: string) => {
        switch (escaped) {
          case 'n':
            return '\n';
          case 'r':
            return '\r';
          case 't':
            return '\t';
          default:
            return escaped;
        }
      });
  }

  if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) {
    return value.slice(1, -1);
  }

  const commentIndex = value.indexOf(' #');
  return commentIndex >= 0 ? value.slice(0, commentIndex).trim() : value;
}

function parseEnvFile(filePath: string): Record<string, string> {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return {};
    }

    throw new EnvFileError(`无法读取环境配置文件: ${filePath}`, filePath, undefined, error);
  }

  const values: Record<string, string> = {};
  for (const [index, originalLine] of raw.split(/\r?\n/).entries()) {
    const lineNumber = index + 1;
    const line = originalLine.trim();
    if (!line || line.startsWith('#')) continue;

    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) {
      throw new EnvFileError(
        `环境配置格式无效，必须为 KEY=value: ${line}`,
        filePath,
        lineNumber
      );
    }

    const key = line.slice(0, separatorIndex).trim();
    if (!ENV_KEY_PATTERN.test(key)) {
      throw new EnvFileError(`环境配置键名无效: ${key}`, filePath, lineNumber);
    }

    values[key] = parseEnvValue(line.slice(separatorIndex + 1));
  }

  return values;
}

/**
 * 加载项目环境配置；后加载的文件覆盖先加载的文件，项目文件覆盖宿主进程变量。
 *
 * 优先级（低到高）：宿主环境 -> .env -> .env.local -> .env.[mode] -> .env.[mode].local
 */
export function loadProjectEnv(
  mode: string,
  cwd: string = process.cwd(),
  hostEnvironment: Record<string, string | undefined> = process.env
): Record<string, string> {
  const normalizedMode = mode.trim();
  if (!normalizedMode) {
    throw new Error('环境模式 mode 不能为空');
  }

  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(hostEnvironment)) {
    if (value !== undefined) values[key] = value;
  }

  const orderedFileNames = [
    '.env',
    '.env.local',
    `.env.${normalizedMode}`,
    `.env.${normalizedMode}.local`,
  ];

  for (const fileName of orderedFileNames) {
    Object.assign(values, parseEnvFile(path.resolve(cwd, fileName)));
  }

  return values;
}
