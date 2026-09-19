import fs from 'node:fs';
import path from 'node:path';

export function normalizeWindowsUpdateMetadata(metadataPath) {
  let metadata;
  try {
    metadata = fs.readFileSync(metadataPath, 'utf8');
  } catch (error) {
    throw new Error(`无法读取 Windows 更新元数据: ${error instanceof Error ? error.message : String(error)}`);
  }

  const match = metadata.match(/^updaterCacheDirName:\s*(.+?)\s*$/m);
  const cacheDirName = match?.[1]?.trim().replace(/^(['"])(.*)\1$/, '$2').trim();
  if (!cacheDirName) {
    throw new Error('Windows 更新元数据缺少 updaterCacheDirName');
  }

  const normalizedMetadata = `updaterCacheDirName: ${cacheDirName}\n`;
  fs.writeFileSync(metadataPath, normalizedMetadata, 'utf8');
  return { updaterCacheDirName: cacheDirName };
}

export function updateMetadataPathForPackContext(context) {
  return path.join(path.resolve(context.appOutDir), 'resources', 'app-update.yml');
}

function hasNsisTarget(targets) {
  return Array.isArray(targets) && targets.some((target) =>
    target?.name === 'nsis' || target?.name?.startsWith('nsis-')
  );
}

export async function afterPack(context) {
  if (context.electronPlatformName !== 'win32' || !hasNsisTarget(context.targets)) {
    return;
  }

  normalizeWindowsUpdateMetadata(updateMetadataPathForPackContext(context));
  console.log('Prepared Windows updater metadata for the platform descriptor feed');
}
