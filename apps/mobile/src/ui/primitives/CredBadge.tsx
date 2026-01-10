import React from 'react';
import { Pressable } from 'react-native';
import { XStack } from 'tamagui';
import { CheckCircle2 } from '@tamagui/lucide-icons';
import { AppText } from './Text';

export type CredTier = 'baseline' | 'bronze' | 'silver' | 'gold' | 'onyx';

export function credTierFor(scs?: number | null): CredTier {
  const v = typeof scs === 'number' && Number.isFinite(scs) ? scs : null;
  if (v === null) return 'baseline';
  if (v >= 850) return 'onyx';
  if (v >= 700) return 'gold';
  if (v >= 550) return 'silver';
  if (v >= 400) return 'bronze';
  return 'baseline';
}

export function credTierLabel(tier: CredTier) {
  if (tier === 'onyx') return 'Onyx';
  if (tier === 'gold') return 'Gold';
  if (tier === 'silver') return 'Silver';
  if (tier === 'bronze') return 'Bronze';
  return 'Baseline';
}

export function credTierColor(tier: CredTier, opts?: { dark?: boolean }) {
  const dark = Boolean(opts?.dark);
  if (tier === 'onyx') return dark ? '#E5E7EB' : '#111827';
  if (tier === 'gold') return '#F59E0B';
  if (tier === 'silver') return '#94A3B8';
  if (tier === 'bronze') return '#D97706';
  return dark ? 'rgba(229,231,235,0.35)' : '#9CA3AF';
}

export function CredBadge({
  scs,
  onPress,
  accessibilityLabel,
  showText = false,
  dark,
}: {
  scs?: number | null;
  onPress?: () => void;
  accessibilityLabel?: string;
  showText?: boolean;
  dark?: boolean;
}) {
  const tier = credTierFor(scs);
  const color = credTierColor(tier, { dark });
  const label = credTierLabel(tier);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? `Credibility status: ${label}`}
      accessibilityHint="Opens an explanation"
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
    >
      <XStack alignItems="center" gap="$1">
        <CheckCircle2 size={14} color={color} />
        {showText ? (
          <AppText variant="meta" color={dark ? '#E5E7EB' : '#111827'}>
            {label}
          </AppText>
        ) : null}
      </XStack>
    </Pressable>
  );
}


