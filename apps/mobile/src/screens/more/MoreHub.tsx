import React from 'react';
import { Screen, Section, List, SettingsRow } from '../../ui';
import { Bell, Settings, FileText, Shield, BadgePercent, Activity, Beaker, SlidersHorizontal } from '@tamagui/lucide-icons';

type Row = { label: string; subtitle?: string; target: string; params?: any };

type Props = {
  navigation: any;
};

const rows: Array<Row & { icon: any }> = [
  { label: 'Notifications', subtitle: 'Updates, eligibility, moderation outcomes', target: 'Notifications', icon: Bell },
  { label: 'Settings', subtitle: 'Account, preferences, accessibility, privacy', target: 'SettingsHome', icon: Settings },
  { label: 'Drafts', subtitle: 'Saved drafts and recovery', target: 'Drafts', icon: FileText },
  { label: 'Safety', subtitle: 'Status, restrictions, appeals', target: 'Safety', icon: Shield },
  { label: 'Cred', subtitle: 'Balance and ledger', target: 'Cred', icon: BadgePercent },
  { label: 'System Status', subtitle: 'App + event state', target: 'Status', icon: Activity },
  { label: 'Kitchen Sink', subtitle: 'QA harness (dev)', target: 'Kitchen', icon: Beaker },
  { label: 'Feature flags', subtitle: 'Dev toggles (theme, surfaces)', target: 'FeatureFlags', icon: SlidersHorizontal },
];

export default function MoreHub({ navigation }: Props) {
  return (
    <Screen scroll={false}>
      <List
        style={{ flex: 1 }}
        data={rows}
        keyExtractor={(r) => r.target}
        ListHeaderComponent={<Section title="More" subtitle="Everything else, in one place — no dead ends." />}
        renderItem={({ item }) => (
          <SettingsRow
            title={item.label}
            subtitle={item.subtitle}
            icon={item.icon}
            onPress={() => navigation.navigate(item.target as never, item.params)}
          />
        )}
      />
    </Screen>
  );
}


