import React, { useEffect, useState } from 'react';
import { Screen, Section, AppText, List, Card, AppButton } from '../../ui';
import { ErrorState, LoadingState, EmptyState } from '../../ui/recipes/states';
import { apiClient } from '../../api/client';

const CredLedger = ({ token }: any) => {
  const [balance, setBalance] = useState<any>(null);
  const [ledger, setLedger] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setError(null);
    setLoading(true);
    try {
      const bal = await apiClient.balance(token);
      setBalance(bal);
      const led = await apiClient.credLedger?.(token);
      setLedger(led?.ledger ?? led?.items ?? []);
    } catch (err) {
      setError('Failed to load cred.');
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
        data={ledger}
        keyExtractor={(item: any) => item.id}
        ListHeaderComponent={
          <>
            <Section title="Cred" subtitle="Balance and ledger.">
              {loading ? <LoadingState lines={2} /> : null}
              {error ? <ErrorState body={error} actionLabel="Retry" onAction={load} /> : null}
              {!loading && !error ? (
                <>
                  <Card bordered>
                    <AppText variant="caption">Balance</AppText>
                    <AppText variant="body">{JSON.stringify(balance?.balance ?? balance ?? {})}</AppText>
                  </Card>
                  <AppButton tone="secondary" onPress={load}>
                    Refresh
                  </AppButton>
                </>
              ) : null}
            </Section>
            <Section title="Ledger" />
            {!loading && !error && !ledger.length ? (
              <EmptyState title="No ledger entries yet" body="Once you participate, changes show up here." />
            ) : null}
          </>
        }
        renderItem={({ item }: any) => (
          <Card bordered>
            <AppText variant="body">{item.description ?? item.reason ?? 'cred event'}</AppText>
            <AppText variant="caption">delta: {item.delta ?? 0}</AppText>
          </Card>
        )}
        contentContainerStyle={{ paddingHorizontal: 14, paddingTop: 12, paddingBottom: 28 }}
      />
    </Screen>
  );
};

export default CredLedger;

