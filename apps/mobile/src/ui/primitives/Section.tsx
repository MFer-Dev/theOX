import React from 'react';
import { YStack } from 'tamagui';
import { AppText } from './Text';

type Props = {
  title?: string;
  subtitle?: string;
  children?: React.ReactNode;
};

export const Section = ({ title, subtitle, children }: Props) => (
  <YStack gap="$3" marginBottom="$4">
    {(title || subtitle) && (
      <YStack gap="$1">
        {title ? <AppText variant="title">{title}</AppText> : null}
        {subtitle ? <AppText variant="meta">{subtitle}</AppText> : null}
      </YStack>
    )}
    {children}
  </YStack>
);

