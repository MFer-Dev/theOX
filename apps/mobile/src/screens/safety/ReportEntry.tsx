import React, { useState } from 'react';
import { Screen, Section, AppText, AppButton, List, Card } from '../../ui';
import { ErrorState, LoadingState } from '../../ui/recipes/states';

const reasons = [
  { code: 'harassment', label: 'Harassment' },
  { code: 'misinfo', label: 'Misinformation' },
  { code: 'harm', label: 'Harm or danger' },
  { code: 'spam', label: 'Spam' },
];

type Props = {
  navigation: any;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
};

export default function ReportEntryScreen({ navigation, loading, error, onRetry }: Props) {
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <Screen scroll={false} pad={false}>
      <List
        data={loading || error ? [] : reasons}
        keyExtractor={(r) => r.code}
        ListHeaderComponent={
          <Section title="Report content" subtitle="Select a reason so we can route this correctly.">
            {loading ? <LoadingState lines={2} /> : null}
            {error ? <ErrorState body={error} actionLabel="Retry" onAction={onRetry} /> : null}
          </Section>
        }
        renderItem={({ item }) => (
          <Card padding="$3" bordered>
            <AppButton tone={selected === item.code ? 'primary' : 'ghost'} onPress={() => setSelected(item.code)}>
              {item.label}
            </AppButton>
          </Card>
        )}
        ListFooterComponent={
          <AppButton
            tone="primary"
            onPress={() => navigation?.navigate?.('ReportDetails', { reason: selected })}
            disabled={!selected}
          >
            Continue
          </AppButton>
        }
        contentContainerStyle={{ paddingHorizontal: 14, paddingTop: 12, paddingBottom: 28 }}
      />
    </Screen>
  );
}

