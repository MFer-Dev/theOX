export const components = {
  buttons: {
    sizes: {
      md: { pv: 12, ph: 16 },
      sm: { pv: 8, ph: 12 },
    },
    variants: ['primary', 'secondary', 'ghost', 'destructive'] as const,
  },
  inputs: {
    height: 48,
    padding: 12,
  },
  badges: {
    variants: ['accent', 'muted', 'warn', 'success'] as const,
  },
};

