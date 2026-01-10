import React, { useEffect, useState } from 'react';
import { Screen, Section, AppText, AppButton, List, Card } from '../../ui';
import { EmptyState, ErrorState, LoadingState } from '../../ui/recipes/states';

type Draft = { id: string; body: string; updated_at: string };

type Props = {
  navigation: any;
  fetchDrafts?: () => Promise<Draft[]>;
  onResume?: (id: string) => void;
  onDiscard?: (id: string) => Promise<void> | void;
};

export default function DraftList({ navigation, fetchDrafts, onResume, onDiscard }: Props) {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = (await fetchDrafts?.()) ?? [];
      setDrafts(data);
    } catch (e: any) {
      setError('Failed to load drafts.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Screen scroll={false} pad={false}>
      <List
        data={drafts}
        keyExtractor={(d) => d.id}
        ListHeaderComponent={
          <Section title="Drafts" subtitle="Drafts are local and may be discarded in The Gathering.">
            {loading ? <LoadingState lines={2} /> : null}
            {error ? <ErrorState body={error} actionLabel="Retry" onAction={load} /> : null}
            {!loading && !error && drafts.length === 0 ? (
              <EmptyState title="No drafts" body="Start writing and drafts will appear here." />
            ) : null}
          </Section>
        }
        renderItem={({ item }) => (
          <Card bordered>
            <AppText variant="body" numberOfLines={2}>
              {item.body}
            </AppText>
            <AppText variant="caption">Edited: {item.updated_at}</AppText>
            <AppButton tone="primary" onPress={() => onResume?.(item.id)}>
              Resume
            </AppButton>
            <AppButton tone="ghost" onPress={() => onDiscard?.(item.id)}>
              Discard
            </AppButton>
          </Card>
        )}
        contentContainerStyle={{ paddingHorizontal: 14, paddingTop: 12, paddingBottom: 28 }}
      />
    </Screen>
  );
}

