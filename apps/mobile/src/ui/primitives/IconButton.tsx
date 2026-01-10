import React from 'react';
import { AppButton } from './Button';
import { Icon, type IconComponent } from './Icon';

type Props = {
  icon: IconComponent;
  label: string;
  onPress?: () => void;
};

export function IconButton({ icon, label, onPress }: Props) {
  return (
    <AppButton
      tone="ghost"
      accessibilityLabel={label}
      onPress={onPress}
      // Header icons should not look like bordered buttons.
      backgroundColor="transparent"
      borderColor="transparent"
      borderWidth={0}
      paddingHorizontal="$2"
      width={44}
      pressStyle={{ opacity: 0.6 }}
      icon={<Icon icon={icon} />}
    >
      {null}
    </AppButton>
  );
}


