import React from 'react';
import { View } from 'react-native';
import { Screen, Section, List, SettingsRow } from '../../ui';
import { ErrorState, LoadingState } from '../../ui/recipes/states';
import { User, SlidersHorizontal, Accessibility, Shield, Info, Sparkles, Wrench } from '@tamagui/lucide-icons';

type Props = {
  navigation: any;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
};

const baseRows = [
  { label: 'Account', target: 'SettingsAccount', icon: User },
  { label: 'Preferences', target: 'SettingsPreferences', icon: SlidersHorizontal },
  { label: 'Accessibility', target: 'SettingsAccessibility', icon: Accessibility },
  { label: 'Privacy & Safety', target: 'SettingsPrivacy', icon: Shield },
  { label: 'Trust & Transparency', target: 'SettingsTrust', icon: Sparkles },
  { label: 'About', target: 'SettingsAbout', icon: Info },
];

export default function SettingsHome({ navigation, loading, error, onRetry }: Props) {
  if (loading) {
    return (
      <Screen>
        <Section title="Settings">
          <LoadingState lines={3} />
        </Section>
      </Screen>
    );
  }

  if (error) {
    return (
      <Screen>
        <Section title="Settings">
          <ErrorState body={error} actionLabel="Retry" onAction={onRetry} />
        </Section>
      </Screen>
    );
  }

  const rows = __DEV__ ? [...baseRows, { label: 'Developer', target: 'DevTools', icon: Wrench }] : baseRows;

  return (
    <Screen scroll={false}>
      <List
        style={{ flex: 1 }}
        data={rows}
        keyExtractor={(r) => r.target}
        contentContainerStyle={{ paddingHorizontal: 14, paddingTop: 10 }}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        ListHeaderComponent={<Section title="Settings" subtitle="Account, preferences, accessibility, privacy." />}
        renderItem={({ item }) => (
          <SettingsRow title={item.label} icon={item.icon} onPress={() => navigation?.navigate?.(item.target)} />
        )}
      />
    </Screen>
  );
}

