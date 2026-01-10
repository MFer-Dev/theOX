export type TypeVariant = 'display' | 'title' | 'body' | 'meta' | 'caption';

export const typography = {
  // Premium, calm type scale (tight tracking only on headlines).
  display: { fontSize: 30, fontWeight: '800', letterSpacing: -0.6 },
  title: { fontSize: 18, fontWeight: '700', letterSpacing: -0.2 },
  body: { fontSize: 16, fontWeight: '400', letterSpacing: 0 },
  meta: { fontSize: 13, fontWeight: '500', letterSpacing: 0.1, color: '$gray10' },
  caption: { fontSize: 12, fontWeight: '500', letterSpacing: 0.1, color: '$gray10' },
};
