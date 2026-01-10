import { createTamagui, createTokens } from 'tamagui';
import { config as baseConfig } from '@tamagui/config/v3';

const tokens = createTokens({
  ...baseConfig.tokens,
  color: {
    ...baseConfig.tokens.color,
    // Brand: neutral, premium (avoid “childish” candy accents).
    accent: '#0B0B0F',
    accentSoft: '#E7E7EA',
    badge: '#0B0B0F',
    badgeMuted: '#E7E7EA',
    banner: '#0B0B0F',
    danger: '#ef4444',
    success: '#16a34a',
    warn: '#f59e0b',
    backgroundLight0: (baseConfig.tokens.color as any).gray1,
    backgroundLight50: (baseConfig.tokens.color as any).gray2,
    borderLight200: (baseConfig.tokens.color as any).gray5,
    textLight500: (baseConfig.tokens.color as any).gray10,
  },
});

const themes = {
  default: {
    ...baseConfig.themes.light,
    background: '#F6F7F9',
    backgroundStrong: '#FFFFFF',
    // Make surface outlines consistently visible (esp. inputs/cards).
    borderColor: 'rgba(15, 23, 42, 0.12)',
    accent: tokens.color.accent,
    badge: tokens.color.badge,
    badgeMuted: tokens.color.badgeMuted,
    banner: tokens.color.banner,
  },
  default_dark: {
    ...baseConfig.themes.dark,
    background: '#0B0B0F',
    backgroundStrong: '#111827',
    // Dark mode borders need more contrast than Tamagui defaults.
    borderColor: 'rgba(229, 231, 235, 0.18)',
    // In dark themes, accent must be light so primary buttons remain readable.
    accent: '#E5E7EB',
    badge: tokens.color.badge,
    badgeMuted: tokens.color.badgeMuted,
    banner: tokens.color.banner,
  },
  purge: {
    ...baseConfig.themes.light,
    // Event theme still stays premium: dark neutral accents with subtle tint.
    background: '#F5F7FB',
    backgroundStrong: '#FFFFFF',
    borderColor: 'rgba(15, 23, 42, 0.12)',
    accent: '#111827',
    badge: '#111827',
    badgeMuted: '#E5E7EB',
    banner: '#111827',
  },
  purge_dark: {
    ...baseConfig.themes.dark,
    // Gathering dark: colder + more cinematic.
    background: '#070A12',
    backgroundStrong: '#0E162A',
    borderColor: 'rgba(229, 231, 235, 0.20)',
    accent: '#E5E7EB',
    badge: '#E5E7EB',
    badgeMuted: 'rgba(229,231,235,0.14)',
    banner: '#E5E7EB',
  },
};

export default createTamagui({
  ...baseConfig,
  themes,
  tokens,
});

export type AppConfig = typeof import('./tamagui.config').default;

