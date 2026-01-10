import { tokens, colors as baseColors } from './tokens';

export type ThemeMode = 'default' | 'purge';

const baseTheme = {
  colors: baseColors,
  typography: tokens.typography,
  spacing: tokens.spacing,
  radius: tokens.radius,
  elevation: tokens.elevation,
  motion: tokens.motion,
};

const purgeOverrides = {
  colors: {
    ...baseColors,
    brand: {
      ...baseColors.brand,
      accent: baseColors.brand.purge,
    },
    bg: {
      ...baseColors.bg,
      elevated: '#F5F3FF', // subtle tint for purge state (Lavender-like)
    },
  },
};

export const theme = {
  default: baseTheme,
  purge: {
    ...baseTheme,
    ...purgeOverrides,
  },
};

export const getTheme = (mode: ThemeMode = 'default') => theme[mode] ?? theme.default;

