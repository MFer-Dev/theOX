import React from 'react';
import { ActivityIndicator } from 'react-native';
import { Button, ButtonProps, XStack, useThemeName } from 'tamagui';
import { AppText } from './Text';
import { APP_RADIUS } from './style';

type Props = ButtonProps & {
  tone?: 'primary' | 'secondary' | 'ghost' | 'destructive';
  loading?: boolean;
  icon?: React.ReactNode;
  fullWidth?: boolean;
  accessibilityLabel?: string;
};

export const AppButton = ({
  tone = 'primary',
  loading = false,
  disabled,
  icon,
  fullWidth,
  children,
  ...rest
}: Props) => {
  const themeName = useThemeName();
  const variants: Record<string, Partial<ButtonProps>> = {
    primary: { backgroundColor: '$accent', borderColor: '$accent' },
    secondary: { backgroundColor: '$backgroundStrong', borderColor: '$borderColor' },
    ghost: { backgroundColor: 'transparent', borderColor: 'transparent' },
    destructive: { backgroundColor: '$red10', borderColor: '$red10' },
  };
  const isDisabled = disabled || loading;
  const isDark = String(themeName).includes('dark');
  const primaryOnDarkText = '#0B0B0F';
  const primaryOnLightText = '#fff';
  const spinnerColor =
    tone === 'primary'
      ? isDark
        ? primaryOnDarkText
        : primaryOnLightText
      : tone === 'destructive'
      ? '#fff'
      : isDark
      ? '#E5E7EB'
      : '#111';
  const labelColor =
    tone === 'primary'
      ? isDark
        ? primaryOnDarkText
        : primaryOnLightText
      : tone === 'destructive'
      ? '#fff'
      : undefined;
  const isStringChild = typeof children === 'string';
  return (
    <Button
      {...variants[tone]}
      width={fullWidth ? '100%' : rest.width}
      opacity={isDisabled ? 0.6 : 1}
      disabled={isDisabled}
      minHeight={52}
      borderWidth={tone === 'secondary' ? 1 : 0}
      borderRadius={APP_RADIUS}
      paddingHorizontal="$4"
      pressStyle={{ opacity: 0.92 }}
      animation="quick"
      accessibilityRole="button"
      accessibilityLabel={rest.accessibilityLabel ?? (typeof children === 'string' ? children : undefined)}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      {...rest}
    >
      <XStack alignItems="center" gap="$2" justifyContent="center">
        {loading ? <ActivityIndicator color={spinnerColor} /> : icon}
        {children ? (
          isStringChild ? (
            <AppText variant="body" fontWeight="600" color={labelColor}>
              {children}
            </AppText>
          ) : (
            children
          )
        ) : null}
      </XStack>
    </Button>
  );
};

export const PrimaryButton = (p: Props) => <AppButton tone="primary" {...p} />;
export const SecondaryButton = (p: Props) => <AppButton tone="secondary" {...p} />;
export const GhostButton = (p: Props) => <AppButton tone="ghost" {...p} />;
export const DestructiveButton = (p: Props) => <AppButton tone="destructive" {...p} />;

