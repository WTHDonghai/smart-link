import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import module from 'node:module';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtimeFiles = [
  path.join(rootDir, 'dist-electron', 'main.js'),
  path.join(rootDir, 'dist-electron', 'preload.cjs'),
];

export function packageName(importSource) {
  if (importSource.startsWith('node:') || importSource.startsWith('.') || importSource.startsWith('/')) {
    return null;
  }
  return importSource.startsWith('@')
    ? importSource.split('/').slice(0, 2).join('/')
    : importSource.split('/')[0];
}

export function findMissingRuntimeDependencies({ source, dependencies }) {
  const importPattern = /(?:\bfrom\s+|\brequire\s*\(|\bimport\s*\(|\bimport\s+)\s*["']([^"']+)["']/g;
  const imports = new Set();

  for (const match of source.matchAll(importPattern)) {
    const name = packageName(match[1]);
    if (name) imports.add(name);
  }

  return [...imports]
    .filter((name) => name !== 'electron' && !module.builtinModules.includes(name))
    .filter((name) => !Object.hasOwn(dependencies, name))
    .sort();
}

const missing = runtimeFiles
  .filter((file) => fs.existsSync(file))
  .flatMap((file) => findMissingRuntimeDependencies({
    source: fs.readFileSync(file, 'utf8'),
    dependencies: JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8')).dependencies,
  }).map((name) => `${path.relative(rootDir, file)}: ${name}`));

if (missing.length > 0) {
  console.error(`桌面运行时缺少 dependencies:\n${missing.map((name) => `- ${name}`).join('\n')}`);
  process.exit(1);
}
