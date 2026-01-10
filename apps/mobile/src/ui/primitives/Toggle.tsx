import React from 'react';
import { Switch } from 'react-native';
import { XStack } from 'tamagui';
import { AppText } from './Text';

type Props = {
  label?: string;
  value: boolean;
  onValueChange: (val: boolean) => void;
  disabled?: boolean;
};

export const Toggle = ({ label, value, onValueChange, disabled }: Props) => (
  <XStack alignItems="center" justifyContent="space-between" width="100%">
    {label ? <AppText variant="body">{label}</AppText> : null}
    <Switch
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value, disabled }}
    />
  </XStack>
);

