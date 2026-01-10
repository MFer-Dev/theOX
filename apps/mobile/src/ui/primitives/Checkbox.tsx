import React from 'react';
import { Checkbox, CheckboxProps, Label, XStack } from 'tamagui';
import { AppText } from './Text';

type Props = CheckboxProps & {
  label?: string;
  helper?: string;
};

export const AppCheckbox = ({ label, helper, children, ...rest }: Props) => (
  <XStack alignItems="center" gap="$2">
    <Checkbox
      size="$3"
      accessibilityRole="checkbox"
      accessibilityLabel={label ?? (typeof children === 'string' ? (children as string) : undefined)}
      {...rest}
    >
      <Checkbox.Indicator>
        <AppText variant="body">✓</AppText>
      </Checkbox.Indicator>
    </Checkbox>
    <Label>
      <AppText variant="body">{label ?? children}</AppText>
      {helper ? <AppText variant="caption">{helper}</AppText> : null}
    </Label>
  </XStack>
);

