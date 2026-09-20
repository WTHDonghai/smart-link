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
    '.env.production',
    'package.json',
  ],
  afterPack: 'scripts/prepareDesktopUpdateMetadata.mjs',
  publish: [{
    provider: 'generic',
    url: 'https://updates.invalid/',
  }],
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
