import React, { useRef } from 'react';
import { Input, Label, XStack, YStack, useTheme } from 'tamagui';
import { AppText } from './Text';
import { APP_RADIUS } from './style';

type FieldProps = any & {
  label?: string;
  helper?: string;
  error?: string;
  inputRef?: React.Ref<any>;
};

export const TextField = (props: any) => <Input {...props} />;

export const FormField = ({ label, helper, error, inputRef, ...props }: FieldProps) => {
  const theme = useTheme();
  const textColor = (theme as any)?.color?.get?.() ?? '#0B0B0F';
  const placeholderTextColor = (theme as any)?.gray10?.get?.() ?? '#6B7280';
  const selectionColor = (theme as any)?.accent?.get?.() ?? '#0B0B0F';

  return (
    <YStack gap="$2">
      {label ? (
        <Label>
          <AppText variant="meta">{label}</AppText>
        </Label>
      ) : null}
      <Input
        ref={inputRef as any}
        borderWidth={1}
        borderColor={error ? '$red9' : '$borderColor'}
        borderRadius={APP_RADIUS}
        backgroundColor="$backgroundStrong"
        paddingHorizontal="$3"
        fontSize={16}
        color={textColor}
        placeholderTextColor={placeholderTextColor}
        selectionColor={selectionColor}
        accessibilityLabel={props.accessibilityLabel ?? label}
        accessibilityHint={helper}
        accessibilityState={{ invalid: Boolean(error) }}
        minHeight={52}
        focusStyle={{ borderColor: '$accent' }}
        {...props}
      />
      {helper && !error ? <AppText variant="caption">{helper}</AppText> : null}
      {error ? (
        <AppText variant="caption" color="$red9">
          {error}
        </AppText>
      ) : null}
    </YStack>
  );
};

export const OtpField = ({
  length = 6,
  onCodeChange,
  ...rest
}: { length?: number; onCodeChange?: (code: string) => void } & any) => {
  const theme = useTheme();
  const textColor = (theme as any)?.color?.get?.() ?? '#0B0B0F';
  const selectionColor = (theme as any)?.accent?.get?.() ?? '#0B0B0F';
  const refs = useRef<Array<any>>([]);
  const values = useRef<string[]>(Array(length).fill(''));

  const update = (idx: number, val: string) => {
    values.current[idx] = val.slice(-1);
    onCodeChange?.(values.current.join(''));
    if (val && idx < length - 1) {
      refs.current[idx + 1]?.focus();
    }
  };

  return (
    <XStack gap="$2" justifyContent="space-between">
      {Array.from({ length }).map((_, idx) => (
        <Input
          key={idx}
          ref={(r: any) => (refs.current[idx] = r)}
          width={44}
          textAlign="center"
          keyboardType="number-pad"
          maxLength={1}
          minHeight={52}
          borderRadius={APP_RADIUS}
          borderColor="$borderColor"
          backgroundColor="$backgroundStrong"
          color={textColor}
          selectionColor={selectionColor}
          accessibilityLabel={`OTP digit ${idx + 1}`}
          onChangeText={(val: any) => update(idx, typeof val === 'string' ? val : val?.nativeEvent?.text ?? '')}
          {...rest}
        />
      ))}
    </XStack>
  );
};

