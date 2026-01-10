import React, { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { Screen, List, AppText, Card, FormField, Pill, PillRow } from '../../ui';
import NotificationList from '../notifications/NotificationList';
import { XStack, YStack } from 'tamagui';
import { messagingStore, type Thread } from '../../storage/messaging';
import { useNavigation } from '@react-navigation/native';
import { Mail, Inbox as InboxIcon } from '@tamagui/lucide-icons';
import { apiClient } from '../../api/client';

type Tab = 'messages' | 'notifications';

type Filter = 'all' | 'unread' | 'requests';

function MessagesList({ token }: { token: string }) {
  const navigation = useNavigation<any>();
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [threads, setThreads] = useState<Thread[]>([]);

  useEffect(() => {
    if (token !== 'dev-session') {
      apiClient
        .dmThreads(token, filter)
        .then((r: any) => setThreads((r?.threads ?? []) as any))
        .catch(() => setThreads([]));
    } else {
      messagingStore.getThreads().then(setThreads).catch(() => setThreads([]));
    }
  }, [token, filter]);

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    let list = threads;
    if (filter === 'unread') list = list.filter((t) => (t.unread ?? 0) > 0 && !t.isRequest);
    if (filter === 'requests') list = list.filter((t) => Boolean(t.isRequest));
    if (filter === 'all') list = list.filter((t) => !t.isRequest);
    if (!term) return list;
    return list.filter((t) => t.name.toLowerCase().includes(term) || t.handle.toLowerCase().includes(term) || t.lastBody.toLowerCase().includes(term));
  }, [filter, q, threads]);

  const header = useMemo(
    () => (
      <YStack marginBottom="$2">
        <Card bordered>
          <YStack gap="$3">
            <FormField value={q} onChangeText={setQ} placeholder="Search messages" accessibilityLabel="Search messages" />
            <PillRow>
              {(['all', 'unread', 'requests'] as const).map((k) => (
                <Pill
                  key={k}
                  label={k === 'all' ? 'All' : k === 'unread' ? 'Unread' : 'Requests'}
                  active={filter === k}
                  onPress={async () => {
                    setFilter(k);
                    if (token !== 'dev-session') {
                      const r = await apiClient.dmThreads(token, k);
                      setThreads((r?.threads ?? []) as any);
                    }
                  }}
                />
              ))}
            </PillRow>
          </YStack>
        </Card>
      </YStack>
    ),
    [filter, q, token],
  );

  return (
    <List
      style={{ flex: 1 }}
      data={rows}
      keyExtractor={(m) => m.id}
      ListHeaderComponent={header}
      ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
      renderItem={({ item }) => (
        <Card bordered onPress={() => navigation.navigate('InboxThread' as never, { id: item.id } as never)}>
          <XStack alignItems="center" justifyContent="space-between">
            <XStack alignItems="center" gap="$2">
              {item.isRequest ? <InboxIcon size="$1" color="$gray10" /> : <Mail size="$1" color="$gray10" />}
              <AppText variant="body" fontWeight="700">
                {item.name}
              </AppText>
            </XStack>
            <AppText variant="caption" color="$gray10">
              {item.lastTs}
              {(item.unread ?? 0) > 0 ? ` · ${item.unread}` : ''}
            </AppText>
          </XStack>
          <AppText variant="meta">@{item.handle}</AppText>
          <AppText variant="body" numberOfLines={1}>
            {item.lastBody}
          </AppText>
          {item.isRequest ? (
            <AppText variant="caption" color="$gray10">
              Request
            </AppText>
          ) : null}
        </Card>
      )}
    />
  );
}

type Props = { token: string };

export default function InboxScreen({ token }: Props) {
  const navigation = useNavigation<any>();
  const [tab, setTab] = useState<Tab>('notifications');

  return (
    <Screen scroll={false} pad={false}>
      <XStack paddingHorizontal="$3" paddingTop="$2" paddingBottom="$2">
        <Card bordered width="100%">
          <PillRow>
            {(['notifications', 'messages'] as Tab[]).map((t) => (
              <Pill
                key={t}
                label={t === 'notifications' ? 'Notifications' : 'Messages'}
                active={tab === t}
                onPress={() => setTab(t)}
              />
            ))}
          </PillRow>
        </Card>
      </XStack>

      <YStack flex={1} paddingHorizontal="$3" paddingTop="$2">
        {tab === 'notifications' ? (
          <NotificationList
            embedded
            navigation={navigation}
            fetchNotifications={async () => {
              try {
                const resp: any = await apiClient.notifications(token);
                return resp?.notifications ?? resp?.items ?? [];
              } catch {
                return [];
              }
            }}
          />
        ) : (
          <MessagesList token={token} />
        )}
      </YStack>
    </Screen>
  );
}


