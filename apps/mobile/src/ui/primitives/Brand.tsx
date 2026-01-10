import React from 'react';
import { View } from 'react-native';
// Brand assets live at /apps/public (workspace root)
import WordmarkSvg from '../../../../public/wordmark.svg';
import MarkSvg from '../../../../public/graphic.svg';

export function BrandWordmark({
  width = 120,
  height = 18,
  color,
}: {
  width?: number;
  height?: number;
  color?: string;
}) {
  // Use an explicit box so the SVG can "meet" within it (preserves aspect ratio).
  return (
    <View accessibilityLabel="Trybl" accessible>
      <WordmarkSvg width={width} height={height} color={color} />
    </View>
  );
}

export function BrandMark({ size = 96, color }: { size?: number; color?: string }) {
  return (
    <View accessibilityLabel="Trybl logo" accessible>
      <MarkSvg width={size} height={size} color={color} />
    </View>
  );
}


