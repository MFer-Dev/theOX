const path = require('path');
const fs = require('fs');
const { getDefaultConfig } = require('@react-native/metro-config');
const { withTamagui } = require('@tamagui/metro-plugin');

const config = getDefaultConfig(__dirname);

// Support pnpm symlinks and workspace node_modules
config.resolver.unstable_enableSymlinks = true;
config.resolver.unstable_enablePackageExports = true;
const workspaceRoot = path.resolve(__dirname, '..', '..');
const workspaceNodeModules = path.resolve(workspaceRoot, 'node_modules');
const sharedSrc = path.resolve(workspaceRoot, 'platform', 'shared', 'src');
const sharedNodeModules = path.resolve(workspaceRoot, 'platform', 'shared', 'node_modules');
const publicDir = path.resolve(workspaceRoot, 'apps', 'public');
config.watchFolders = [path.resolve(__dirname, 'node_modules'), workspaceNodeModules, sharedSrc, sharedNodeModules, publicDir];

// SVG support (apps/public contains brand SVGs)
config.transformer = {
  ...config.transformer,
  babelTransformerPath: require.resolve('react-native-svg-transformer'),
};
config.resolver.assetExts = config.resolver.assetExts.filter((ext) => ext !== 'svg');
config.resolver.sourceExts = Array.from(new Set([...config.resolver.sourceExts, 'svg']));

// Explicit alias for shared workspace package
config.resolver.nodeModulesPaths = [workspaceNodeModules, path.resolve(__dirname, 'node_modules')];

const resolveMaybe = (preferred, fallback) => (fs.existsSync(preferred) ? preferred : fallback);
const resolveAtTamagui = (pkg) =>
  resolveMaybe(path.resolve(workspaceNodeModules, '@tamagui', pkg), path.resolve(__dirname, 'node_modules', '@tamagui', pkg));
const resolveTop = (pkg) => resolveMaybe(path.resolve(workspaceNodeModules, pkg), path.resolve(__dirname, 'node_modules', pkg));

config.resolver.extraNodeModules = {
  '@platform/shared': sharedSrc,
  '@babel/runtime': path.resolve(workspaceNodeModules, '@babel', 'runtime'),
  uuid: path.resolve(workspaceNodeModules, 'uuid'),
  crypto: path.resolve(__dirname, 'node_modules', 'react-native-crypto'),
  util: path.resolve(__dirname, 'node_modules', 'util'),
  net: path.resolve(__dirname, 'node_modules', 'react-native-tcp-socket'),
  url: path.resolve(__dirname, 'node_modules', 'url'),
  stream: path.resolve(__dirname, 'node_modules', 'stream-browserify'),
  events: path.resolve(__dirname, 'node_modules', 'events'),
  tls: path.resolve(__dirname, 'node_modules', 'react-native-crypto'),
  jwa: path.resolve(workspaceNodeModules, 'jwa'),
  fs: path.resolve(__dirname, 'node_modules', 'react-native-fs'),
  dns: path.resolve(__dirname, 'shims', 'empty.js'),
  path: path.resolve(__dirname, 'node_modules', 'path-browserify'),
  tamagui: resolveTop('tamagui'),
  '@tamagui/core': resolveAtTamagui('core'),
  '@tamagui/helpers': resolveAtTamagui('helpers'),
  '@tamagui/constants': resolveAtTamagui('constants'),
  '@tamagui/colors': resolveAtTamagui('colors'),
  '@tamagui/use-theme': resolveAtTamagui('use-theme'),
  '@tamagui/lucide-icons': resolveAtTamagui('lucide-icons'),
};

module.exports = withTamagui(config, {
  config: './tamagui.config.ts',
  components: ['tamagui'],
  useReactNativeWebLite: false,
});

