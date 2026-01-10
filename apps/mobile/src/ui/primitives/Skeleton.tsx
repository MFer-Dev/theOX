import React from 'react';
import { View } from 'tamagui';

type Props = {
  width?: number | string;
  height?: number | string;
  radius?: number;
};

export const Skeleton = ({ width = '100%', height = 14, radius = 8 }: Props) => (
  <View width={width} height={height} backgroundColor="$gray5" borderRadius={radius} />
);

