import React from 'react';
import { Pressable, ScrollView } from 'react-native';
import { XStack, useThemeName } from 'tamagui';
import { AppText } from './Text';

type Props = {
  label: string;
  active?: boolean;
  onPress?: () => void;
  accessibilityLabel?: string;
};

export function Pill({ label, active, onPress, accessibilityLabel }: Props) {
  const themeName = useThemeName();
  const isDark = String(themeName).includes('dark');
  const inactiveBg = isDark ? '#111827' : '#E9EAEE';
  const activeBg = isDark ? '#E5E7EB' : '#0B0B0F';
  const activeText = isDark ? '#0B0B0F' : '#fff';
  const inactiveText = isDark ? '#E5E7EB' : '#0B0B0F';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={onPress}
      style={({ pressed }) => ({
        opacity: pressed ? 0.7 : 1,
      })}
      hitSlop={8}
    >
      <XStack
        backgroundColor={active ? activeBg : inactiveBg}
        borderRadius={999}
        paddingHorizontal={12}
        paddingVertical={7}
        alignItems="center"
        justifyContent="center"
      >
        <AppText
          variant="caption"
          fontWeight={active ? '700' : '600'}
          color={active ? activeText : inactiveText}
          numberOfLines={1}
          ellipsizeMode="tail"
        >
          {label}
        </AppText>
      </XStack>
    </Pressable>
  );
}

export function PillRow({ children }: { children: React.ReactNode }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <XStack gap="$2" alignItems="center" paddingVertical="$0" paddingRight="$2">
        {children}
      </XStack>
    </ScrollView>
  );
}


