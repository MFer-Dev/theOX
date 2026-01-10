import React from 'react';
import { XStack, XStackProps } from 'tamagui';
import { APP_RADIUS } from './style';

export const Row = (props: XStackProps) => (
  <XStack
    alignItems="center"
    justifyContent="space-between"
    padding="$3"
    borderRadius={APP_RADIUS}
    backgroundColor="$backgroundStrong"
    {...props}
  />
);

