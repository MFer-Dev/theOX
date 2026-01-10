import React from 'react';
import { XStack, YStack } from 'tamagui';
import { AppText } from '../primitives/Text';
import { Icon, type IconComponent } from '../primitives/Icon';
import { Card } from '../primitives/Card';
import { ChevronRight } from '@tamagui/lucide-icons';

type Props = {
  title: string;
  subtitle?: string;
  icon?: IconComponent;
  onPress?: () => void;
};

export function SettingsRow({ title, subtitle, icon, onPress }: Props) {
  return (
    <Card
      onPress={onPress}
      paddingHorizontal="$3"
      paddingVertical="$3"
      minHeight={52}
      justifyContent="center"
    >
      <XStack alignItems="center" justifyContent="space-between" gap="$3">
        <XStack alignItems="center" gap="$3" flex={1}>
          {icon ? <Icon icon={icon} /> : null}
          <YStack gap="$1" flex={1}>
            <AppText variant="body" fontWeight="600">
              {title}
            </AppText>
            {subtitle ? <AppText variant="caption">{subtitle}</AppText> : null}
          </YStack>
        </XStack>
        <ChevronRight size="$1" color="$gray10" />
      </XStack>
    </Card>
  );
}


