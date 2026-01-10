import React from 'react';
import { TouchableOpacity } from 'react-native';
import { XStack, YStack } from 'tamagui';
import { AppText } from './Text';

type Props = {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  actions?: React.ReactNode;
};

export const Header = ({ title, subtitle, onBack, actions }: Props) => (
  <XStack alignItems="center" justifyContent="space-between" paddingHorizontal="$4" paddingVertical="$3" gap="$3">
    <XStack alignItems="center" gap="$3">
      {onBack ? (
        <TouchableOpacity onPress={onBack} accessibilityLabel="Back">
          <AppText variant="title">{'<'}</AppText>
        </TouchableOpacity>
      ) : null}
      <YStack>
        <AppText variant="title">{title}</AppText>
        {subtitle ? <AppText variant="caption">{subtitle}</AppText> : null}
      </YStack>
    </XStack>
    {actions}
  </XStack>
);

