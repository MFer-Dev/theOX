import React from 'react';
import { Text as TText, View, Button as TButton, Input as TInput, YStack, XStack, Select as TSelect, Adapt, SelectProps } from 'tamagui';

const mapSpace = (props: any) => {
  const { space, ...rest } = props || {};
  return space ? { gap: space === 'md' ? '$3' : '$2', ...rest } : rest;
};

export const Box = (p: any) => <View {...mapSpace(p)} />;
export const VStack = (p: any) => <YStack {...mapSpace(p)} />;
export const HStack = (p: any) => <XStack {...mapSpace(p)} />;
export const Heading = (props: any) => <TText fontSize={22} fontWeight="700" {...props} />;
export const Text = TText;
export const Button = (props: any) => <TButton {...props} />;
export const Input = (props: any) => <TInput {...props} />;
export const InputField = TInput;

// Local Alert compat component.
// Important: do NOT mutate Tamagui exports (can throw "property is not configurable" in Hermes).
type AlertAction = 'info' | 'success' | 'warning' | 'error';
type AlertProps = {
  action?: AlertAction;
  children?: React.ReactNode;
};

const alertTone = (action: AlertAction) => {
  switch (action) {
    case 'success':
      return { bg: '$backgroundLight50', border: '$success' };
    case 'warning':
      return { bg: '$backgroundLight50', border: '$warn' };
    case 'error':
      return { bg: '$backgroundLight50', border: '$danger' };
    case 'info':
    default:
      return { bg: '$backgroundLight50', border: '$borderLight200' };
  }
};

const AlertBase = ({ action = 'info', children, ...rest }: AlertProps & any) => {
  const t = alertTone(action);
  return (
    <YStack
      padding="$3"
      borderRadius="$3"
      borderWidth={1}
      backgroundColor={t.bg}
      borderColor={t.border}
      {...rest}
    >
      {children}
    </YStack>
  );
};

const AlertText = (props: any) => <TText {...props} />;

export const Alert: any = AlertBase;
Alert.Text = AlertText;

export const Select = (props: SelectProps) => <TSelect {...props} />;
export const SelectTrigger = TSelect.Trigger;
export const SelectInput = TSelect.Value;
export const SelectPortal = Adapt;
export const SelectContent = TSelect.Content;
export const SelectItem = TSelect.Item;

