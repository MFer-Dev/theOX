import React from 'react';
import { Avatar as TAvatar, AvatarProps, Text } from 'tamagui';
import { APP_RADIUS } from './style';

type Props = AvatarProps & {
  name?: string;
  // Accept remote URL strings OR local Metro assets (require(...)).
  uri?: any;
  size?: number;
  generation?: string | null;
};

const firstLetter = (name?: string) => {
  const n = (name ?? '').trim();
  if (!n) return '?';
  const ch = n.replace(/^@/, '')[0] ?? '?';
  return String(ch).toUpperCase();
};

// WhatsApp-style deterministic color palette (premium, not neon).
const PALETTE = [
  '#2563EB', // blue
  '#7C3AED', // violet
  '#DB2777', // pink
  '#DC2626', // red
  '#EA580C', // orange
  '#16A34A', // green
  '#0891B2', // cyan
  '#4B5563', // slate
] as const;

const hashIndex = (seed: string, mod: number) => {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return mod ? h % mod : 0;
};

export function Avatar({ name, uri, size = 44, generation, ...rest }: Props) {
  const seed = (name ?? '').trim().toLowerCase() || '?';
  const bg = PALETTE[hashIndex(seed, PALETTE.length)];
  const fontSize = Math.max(14, Math.round(size * 0.42));
  const gen = String(generation ?? '').trim().toLowerCase();
  const ringColor =
    gen === 'genz'
      ? '#22C55E'
      : gen === 'millennial'
        ? '#A78BFA'
        : gen === 'genx'
          ? '#F59E0B'
          : gen === 'boomer'
            ? '#60A5FA'
            : null;
  const ringWidth = ringColor ? 2 : 0;
  return (
    <TAvatar
      circular
      size={size}
      borderRadius={APP_RADIUS}
      backgroundColor={bg}
      borderWidth={ringWidth}
      borderColor={ringColor ?? 'transparent'}
      {...rest}
    >
      {/* If uri is provided, try to render an image */}
      {uri ? <TAvatar.Image src={uri} /> : null}
      <TAvatar.Fallback delayMs={0}>
        <Text fontWeight="800" color="#FFFFFF" fontSize={fontSize}>
          {firstLetter(name)}
        </Text>
      </TAvatar.Fallback>
    </TAvatar>
  );
}


