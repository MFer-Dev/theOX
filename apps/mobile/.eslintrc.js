module.exports = {
  root: true,
  extends: ['@react-native-community'],
  parserOptions: {
    project: './tsconfig.eslint.json',
  },
  rules: {
    'prettier/prettier': 'off',
    curly: 'off',
  },
  overrides: [
    {
      files: ['src/screens/**/*.{ts,tsx}'],
      rules: {
        'no-restricted-imports': ['error', { paths: ['tamagui'], patterns: ['tamagui/*'] }],
      },
    },
  ],
};

