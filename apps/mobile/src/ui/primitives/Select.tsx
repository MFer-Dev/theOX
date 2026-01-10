import React, { useState } from 'react';
import { TouchableOpacity } from 'react-native';
import { Card, YStack } from 'tamagui';
import { Sheet } from './Sheet';
import { AppText } from './Text';

type Option = { label: string; value: string };

type Props = {
  label?: string;
  value?: string;
  options: Option[];
  placeholder?: string;
  onChange: (value: string) => void;
};

export const Select = ({ label, value, options, placeholder = 'Select', onChange }: Props) => {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);
  return (
    <YStack gap="$2">
      {label ? <AppText variant="meta">{label}</AppText> : null}
      <TouchableOpacity
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={label ?? placeholder}
        accessibilityHint="Opens selection sheet"
      >
        <Card padding="$3" bordered>
          <AppText variant="body">{current?.label ?? placeholder}</AppText>
        </Card>
      </TouchableOpacity>
      <Sheet isOpen={open} onClose={() => setOpen(false)}>
        <YStack gap="$3">
          <AppText variant="title">{label ?? 'Choose'}</AppText>
          {options.map((opt) => (
            <TouchableOpacity
              key={opt.value}
              onPress={() => {
                onChange(opt.value);
                setOpen(false);
              }}
              accessibilityRole="button"
              accessibilityLabel={opt.label}
            >
              <Card padding="$3" marginBottom="$2" bordered>
                <AppText variant="body">{opt.label}</AppText>
              </Card>
            </TouchableOpacity>
          ))}
        </YStack>
      </Sheet>
    </YStack>
  );
};

