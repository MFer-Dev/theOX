import React from 'react';
import type { ComponentType } from 'react';

// Thin wrapper so we can standardize size/color usage in one place.
// Icons come from @tamagui/lucide-icons (SVG-based, cross-platform).

export type IconComponent = ComponentType<any>;

type Props = {
  icon: IconComponent;
  size?: any;
  color?: any;
};

export function Icon({ icon: IconImpl, size = '$1', color = '$color' }: Props) {
  return <IconImpl size={size} color={color} />;
}


