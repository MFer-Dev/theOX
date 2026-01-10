import React from 'react';
import { YStack, Text, YStackProps } from 'tamagui';
import { APP_RADIUS } from './style';

export const Banner = ({ tone = 'info', children, ...rest }: YStackProps & { tone?: 'info' | 'warn' | 'danger' }) => {
  const bg = tone === 'warn' ? '$yellow3' : tone === 'danger' ? '$red3' : '$banner';
  return (
    <YStack padding="$3" borderRadius={APP_RADIUS} backgroundColor={bg} {...rest}>
      <Text>{children}</Text>
    </YStack>
  );
};

