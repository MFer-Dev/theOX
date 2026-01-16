module.exports = {
  root: true,
  extends: ['@react-native-community'],
  parserOptions: {
    project: './tsconfig.eslint.json',
  },
  rules: {
    'prettier/prettier': 'off',
    curly: 'off',
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    'react-native/no-inline-styles': 'off',
    'no-bitwise': 'off',
    'react-hooks/exhaustive-deps': 'warn',
    'react/no-unstable-nested-components': 'warn',
  },
};

