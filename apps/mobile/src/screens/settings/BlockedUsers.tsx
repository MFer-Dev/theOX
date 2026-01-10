import React, { useEffect, useState } from 'react';
import { Screen, Section, AppText, AppButton, List, Card } from '../../ui';
import { EmptyState, ErrorState, LoadingState } from '../../ui/recipes/states';

type BlockedUser = { id: string; handle: string };

type Props = {
  fetchBlocked?: () => Promise<BlockedUser[]>;
  onUnblock?: (id: string) => Promise<void> | void;
};

export default function BlockedUsersScreen({ fetchBlocked, onUnblock }: Props) {
  const [data, setData] = useState<BlockedUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = (await fetchBlocked?.()) ?? [];
      setData(res);
    } catch (e: any) {
      setError('Failed to load blocked users.');
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
        data={data}
        keyExtractor={(u) => u.id}
        ListHeaderComponent={
          <Section title="Blocked users" subtitle="Your block list.">
            {loading ? <LoadingState lines={2} /> : null}
            {error ? <ErrorState body={error} actionLabel="Retry" onAction={load} /> : null}
            {!loading && !error && data.length === 0 ? (
              <EmptyState title="No blocked users" body="Your block list is empty." />
            ) : null}
          </Section>
        }
        renderItem={({ item }) => (
          <Card padding="$3" bordered>
            <AppText variant="body">@{item.handle}</AppText>
            <AppButton tone="secondary" onPress={() => onUnblock?.(item.id)}>
              Unblock
            </AppButton>
          </Card>
        )}
        contentContainerStyle={{ paddingHorizontal: 14, paddingTop: 12, paddingBottom: 28 }}
      />
    </Screen>
  );
}

