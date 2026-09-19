function readUpdateFeedUrl() {
  const value = process.env.SMARTLINK_UPDATE_FEED_URL?.trim() || '';
  if (!value) {
    return '';
  }

  let updateUrl;
  try {
    updateUrl = new URL(value);
  } catch {
    throw new Error(`SMARTLINK_UPDATE_FEED_URL 不是有效 URL: ${value}`);
  }
  if (updateUrl.protocol !== 'https:') {
    throw new Error('SMARTLINK_UPDATE_FEED_URL 必须使用 HTTPS');
  }
  if (!updateUrl.pathname.endsWith('/')) {
    throw new Error('SMARTLINK_UPDATE_FEED_URL 必须指向以 / 结尾的更新目录');
  }
  return updateUrl.toString();
}

const updateFeedUrl = readUpdateFeedUrl();
const publish = updateFeedUrl
  ? [{ provider: 'generic', url: updateFeedUrl }]
  : undefined;

export default {
  appId: 'com.foxhis.smartlinkauto',
  productName: 'Smart Link Auto',
  asar: true,
  directories: {
    output: 'release/desktop',
  },
  files: [
    'dist/**/*',
    'dist-electron/**/*',
    'package.json',
  ],
  publish,
  win: {
    icon: 'packaging/icon.ico',
    target: ['nsis'],
    artifactName: '${productName}-Setup-${version}-${arch}.${ext}',
  },
  nsis: {
    oneClick: true,
    runAfterFinish: false,
  },
};
