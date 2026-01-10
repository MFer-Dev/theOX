import React from 'react';
import { Pressable } from 'react-native';
import { Screen, Section, AppText, AppButton } from '../../ui';
import { useNavigation } from '@react-navigation/native';

type Props = {
  version?: string;
  onTerms?: () => void;
  onPrivacy?: () => void;
  onLicenses?: () => void;
};

export default function AboutScreen({ version, onTerms, onPrivacy, onLicenses }: Props) {
  const navigation = useNavigation<any>();
  const [tapCount, setTapCount] = React.useState(0);
  const [tapStart, setTapStart] = React.useState<number | null>(null);

  const onVersionTap = () => {
    const now = Date.now();
    const start = tapStart ?? now;
    if (now - start > 2500) {
      setTapStart(now);
      setTapCount(1);
      return;
    }
    const next = tapCount + 1;
    setTapStart(start);
    setTapCount(next);
    if (next >= 7) {
      setTapCount(0);
      setTapStart(null);
      navigation.navigate('DevTools' as never);
    }
  };
  return (
    <Screen>
      <Section title="About">
        <Pressable onPress={onVersionTap} accessibilityRole="button" accessibilityLabel="App version">
          <AppText variant="body">Version: {version ?? 'unknown'}</AppText>
        </Pressable>
        <AppButton tone="ghost" onPress={onTerms ?? (() => navigation.navigate('Terms' as never))}>
          Terms of Service
        </AppButton>
        <AppButton tone="ghost" onPress={onPrivacy ?? (() => navigation.navigate('Privacy' as never))}>
          Privacy Policy
        </AppButton>
        <AppButton tone="ghost" onPress={onLicenses ?? (() => navigation.navigate('Licenses' as never))}>
          Licenses
        </AppButton>
      </Section>
    </Screen>
  );
}

