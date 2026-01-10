import React from 'react';
import { Screen, Section, AppText, AppButton } from '../../ui';
import { useNavigation } from '@react-navigation/native';

const SettingsRoot = () => {
  const nav = useNavigation<any>();
  return (
    <Screen>
      <Section title="Settings" subtitle="Account, security, privacy, notifications, data controls.">
        <AppButton tone="secondary" onPress={() => nav.navigate('SettingsAccount' as never)}>
          Account
        </AppButton>
        <AppButton tone="secondary" onPress={() => nav.navigate('SettingsPrivacy' as never)}>
          Privacy & Safety
        </AppButton>
        <AppButton tone="secondary" onPress={() => nav.navigate('SettingsTrust' as never)}>
          Trust & Transparency
        </AppButton>
        <AppText variant="caption" color="$gray10">
          (This screen is a placeholder; use SettingsHome for the primary settings surface.)
        </AppText>
      </Section>
    </Screen>
  );
};

export default SettingsRoot;

