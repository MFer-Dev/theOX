import React from 'react';
import { YStack } from 'tamagui';
import { AppText } from '../primitives/Text';
export const layout = {
  screenPadding: 16,
  sectionGap: 12,
  rowGap: 10,
  ctaGap: 12,
  headerHeight: 56,
};

export const ScreenLayout = ({ children }: { children: React.ReactNode }) => (
  <YStack flex={1} padding="$4" gap="$4">
    {children}
  </YStack>
);

export const SectionLayout = ({ title, children }: { title?: string; children: React.ReactNode }) => (
  <YStack gap="$2">
    {title ? <AppText variant="title">{title}</AppText> : null}
    <YStack gap="$2">{children}</YStack>
  </YStack>
);


