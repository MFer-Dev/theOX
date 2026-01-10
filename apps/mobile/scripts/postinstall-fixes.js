/* Copy fixed upstream files into node_modules to keep Android build stable. */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const fixes = [
  {
    src: path.join(root, 'patches/files/react-native/MatrixMathHelper.java'),
    dest: path.join(
      root,
      'node_modules',
      'react-native',
      'ReactAndroid',
      'src',
      'main',
      'java',
      'com',
      'facebook',
      'react',
      'uimanager',
      'MatrixMathHelper.java',
    ),
  },
  {
    src: path.join(
      root,
      'patches/files/react-native-svg/android/src/main/java/com/horcrux/svg/RenderableViewManager.java',
    ),
    dest: path.join(
      root,
      'node_modules',
      'react-native-svg',
      'android',
      'src',
      'main',
      'java',
      'com',
      'horcrux',
      'svg',
      'RenderableViewManager.java',
    ),
  },
  {
    src: path.join(
      root,
      'patches/files/react-native-svg/android/src/main/java/com/horcrux/svg/SvgViewManager.java',
    ),
    dest: path.join(
      root,
      'node_modules',
      'react-native-svg',
      'android',
      'src',
      'main',
      'java',
      'com',
      'horcrux',
      'svg',
      'SvgViewManager.java',
    ),
  },
];

for (const { src, dest } of fixes) {
  if (!fs.existsSync(src)) {
    console.warn(`postinstall-fixes: source missing ${src}`);
    continue;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  console.log(`postinstall-fixes: applied ${path.basename(src)}`);
}

