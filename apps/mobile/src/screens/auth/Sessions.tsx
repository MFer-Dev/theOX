import React, { useEffect, useState } from 'react';
import { Screen, Section, AppText, AppButton, List, Card } from '../../ui';
import { apiClient } from '../../api/client';

type Session = {
  id: string;
  device?: string;
  created_at?: string;
  last_active?: string;
  current?: boolean;
};

type Props = {
  token: string;
  onLogout: () => void;
};

const AuthSessions = ({ token, onLogout }: Props) => {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    try {
      const resp = await apiClient.sessions?.(token);
      setSessions(resp?.sessions ?? []);
    } catch (err) {
      setError('Failed to load sessions.');
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Screen scroll={false}>
      <List
        style={{ flex: 1 }}
        data={sessions}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={
          <Section
            title="Sessions"
            subtitle="These are the places your account is signed in. Revoke any you don’t recognize."
          >
            {error ? (
              <AppText variant="caption" color="$red10">
                {error}
              </AppText>
            ) : null}
            <AppButton tone="secondary" onPress={load}>
              Refresh
            </AppButton>
            <AppButton tone="destructive" onPress={onLogout}>
              Logout everywhere
            </AppButton>
          </Section>
        }
        renderItem={({ item }) => (
          <Card>
            <AppText variant="body" fontWeight="700">
              {item.device ?? 'Session'} {item.current ? '· Current' : ''}
            </AppText>
            <AppText variant="caption">
              {item.last_active ? `Last active ${item.last_active}` : ''}
              {item.created_at ? `${item.last_active ? ' · ' : ''}Created ${item.created_at}` : ''}
            </AppText>
            {!item.current ? (
              <AppButton
                tone="ghost"
                loading={revoking === item.id}
                onPress={async () => {
                  try {
                    setRevoking(item.id);
                    await apiClient.revokeSession?.(token, item.id);
                    await load();
                  } catch {
                    setError('Failed to revoke session.');
                  } finally {
                    setRevoking(null);
                  }
                }}
              >
                Revoke
              </AppButton>
            ) : null}
          </Card>
        )}
        ListEmptyComponent={<AppText variant="body">No active sessions</AppText>}
      />
    </Screen>
  );
};

export default AuthSessions;

