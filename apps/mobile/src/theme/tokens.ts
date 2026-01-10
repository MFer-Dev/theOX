// Sprint 8B Token Contract: single source of truth
export const colors = {
  brand: {
    primary: '#0F172A',
    accent: '#2563EB',
    purge: '#7C3AED',
  },
  bg: {
    base: '#FFFFFF',
    muted: '#F8FAFC',
    elevated: '#FFFFFF',
    inverse: '#020617',
  },
  text: {
    primary: '#020617',
    secondary: '#475569',
    muted: '#64748B',
    inverse: '#F8FAFC',
    danger: '#DC2626',
    success: '#16A34A',
    warning: '#D97706',
  },
  border: {
    subtle: '#E2E8F0',
    strong: '#CBD5E1',
  },
};

export const typography = {
  family: {
    sans: 'Inter',
    mono: 'JetBrainsMono',
  },
  size: {
    xs: 12,
    sm: 14,
    md: 16,
    lg: 18,
    xl: 22,
    xxl: 28,
  },
  weight: {
    regular: '400',
    medium: '500',
    semibold: '600',
    bold: '700',
  },
  lineHeight: {
    tight: 1.15,
    normal: 1.4,
    relaxed: 1.6,
  },
};

export const spacing = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
};

export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 18,
};

export const elevation = {
  none: 0,
  sm: 1,
  md: 4,
  lg: 8,
};

export const motion = {
  duration: {
    fast: 120,
    base: 180,
    slow: 280,
  },
  easing: {
    standard: 'cubic-bezier(0.2, 0, 0, 1)',
    emphasized: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
  },
};

export const tokens = {
  colors,
  typography,
  spacing,
  radius,
  elevation,
  motion,
};

