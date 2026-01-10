import React, { useEffect, useState } from 'react';
import { Screen, Section, AppText, List, Card } from '../../ui';
import { ErrorState, LoadingState } from '../../ui/recipes/states';

type Props = {
  navigation: any;
  fetchSummary?: () => Promise<any>;
};

export default function PrivacySafetyScreen({ navigation, fetchSummary }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        await fetchSummary?.();
      } catch {
        setError('Failed to load safety info.');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [fetchSummary]);

  const rows = [
    { label: 'Blocked Users', action: () => navigation?.navigate?.('BlockedUsers') },
    { label: 'Reporting Info', action: () => navigation?.navigate?.('SettingsTrust') },
  ];

  return (
    <Screen scroll={false} pad={false}>
      <List
        data={rows}
        keyExtractor={(r) => r.label}
        ListHeaderComponent={
          <Section title="Privacy & Safety" subtitle="Controls for safety and privacy.">
            {loading ? <LoadingState lines={2} /> : null}
            {error ? <ErrorState body={error} /> : null}
          </Section>
        }
        renderItem={({ item }) => (
          <Card padding="$3" bordered onPress={item.action}>
            <AppText variant="body">{item.label}</AppText>
          </Card>
        )}
        contentContainerStyle={{ paddingHorizontal: 14, paddingTop: 12, paddingBottom: 28 }}
      />
    </Screen>
  );
}

