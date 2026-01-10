import React from 'react';
import { XStack, Text, XStackProps } from 'tamagui';

type BadgeTone = 'accent' | 'muted' | 'warn' | 'success';

export const Badge = ({ tone = 'accent', children, ...rest }: XStackProps & { tone?: BadgeTone; children: React.ReactNode }) => {
  const colors: Record<BadgeTone, { bg: string; fg: string }> = {
    accent: { bg: '$accentSoft', fg: '$accent' },
    muted: { bg: '$badgeMuted', fg: '$gray10' },
    warn: { bg: '$yellow4', fg: '$yellow10' },
    success: { bg: '$green4', fg: '$green10' },
  };
  const c = colors[tone] ?? colors.accent;
  return (
    <XStack
      paddingHorizontal="$2"
      paddingVertical="$1"
      borderRadius="$10"
      backgroundColor={c.bg}
      alignItems="center"
      justifyContent="center"
      {...rest}
    >
      <Text fontSize={12} color={c.fg} fontWeight="600">
        {children}
      </Text>
    </XStack>
  );
};

