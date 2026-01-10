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
};

