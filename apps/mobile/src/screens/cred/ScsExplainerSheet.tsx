import React from 'react';
import { Sheet, Section, AppText, AppButton } from '../../ui';
import { credTierColor, credTierLabel, credTierFor, type CredTier } from '../../ui/primitives/CredBadge';
import { XStack, YStack, useThemeName } from 'tamagui';

function TierRow({ tier, dark }: { tier: CredTier; dark: boolean }) {
  const c = credTierColor(tier, { dark });
  return (
    <XStack alignItems="center" justifyContent="space-between" paddingVertical="$2">
      <XStack alignItems="center" gap="$2">
        <XStack width={10} height={10} borderRadius={999} backgroundColor={c} />
        <AppText variant="body" fontWeight="700">
          {credTierLabel(tier)}
        </AppText>
      </XStack>
      <AppText variant="caption" color="$gray10">
        {tier === 'onyx'
          ? '850+'
          : tier === 'gold'
            ? '700–849'
            : tier === 'silver'
              ? '550–699'
              : tier === 'bronze'
                ? '400–549'
                : '0–399'}
      </AppText>
    </XStack>
  );
}

export function ScsExplainerSheet({
  open,
  onClose,
  scs,
}: {
  open: boolean;
  onClose: () => void;
  scs?: number | null;
}) {
  const themeName = useThemeName();
  const dark = String(themeName).includes('dark');
  const tier = credTierFor(scs);
  return (
    <Sheet isOpen={open} onClose={onClose}>
      <Section title="Social Credit Score (SCS)" subtitle="Signal without gamification.">
        <AppText variant="body">
          SCS is a single credibility number. It is intentionally muted: no ranks, no streaks, no leaderboards.
        </AppText>
        <AppText variant="body">
          In Tribal World it reflects depth within your Trybe. In The Gathering it emphasizes cross‑Trybe resonance.
        </AppText>
        <YStack gap="$2" paddingTop="$2">
          <AppText variant="body" fontWeight="700">
            Your status
          </AppText>
          <AppText variant="caption" color="$gray10">
            Current class: {credTierLabel(tier)}
          </AppText>
          <TierRow tier="onyx" dark={dark} />
          <TierRow tier="gold" dark={dark} />
          <TierRow tier="silver" dark={dark} />
          <TierRow tier="bronze" dark={dark} />
          <TierRow tier="baseline" dark={dark} />
          <AppText variant="caption" color="$gray10">
            Status classes are designed to be legible, not addictive. They influence eligibility and rate limits, not social clout mechanics.
          </AppText>
        </YStack>
        <AppText variant="caption">
          We don’t sell personal data. We study patterns, not people.
        </AppText>
        <AppButton tone="primary" onPress={onClose}>
          Got it
        </AppButton>
      </Section>
    </Sheet>
  );
}


