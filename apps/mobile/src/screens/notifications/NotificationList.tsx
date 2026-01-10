import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Screen, AppText, List, Card } from '../../ui';
import { EmptyState, ErrorState, LoadingState } from '../../ui/recipes/states';

type NotificationItem = {
  id: string;
  title: string;
  body: string;
  ts: string;
  unread?: boolean;
  target?: { route: string; params?: any };
};

type Props = {
  navigation?: any;
  fetchNotifications?: () => Promise<NotificationItem[]>;
  markRead?: (id: string) => Promise<void> | void;
  embedded?: boolean; // when used inside another Screen (e.g., Inbox tab)
};

export default function NotificationList({ navigation, fetchNotifications, markRead, embedded }: Props) {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = (await fetchNotifications?.()) ?? [];
      if (!data.length) {
        setItems([
          { id: 'n1', title: 'Gathering soon', body: 'Countdown is visible in the header when live.', ts: 'Soon', unread: true },
          { id: 'n2', title: 'Eligibility updated', body: 'Your status affects access and rate limits.', ts: 'Today' },
          { id: 'n3', title: 'Gathering live', body: 'Switch is automatic. Late writes are rejected.', ts: 'Now', unread: true },
        ]);
      } else {
        setItems(data);
      }
    } catch {
      setError('Failed to load notifications.');
    } finally {
      setLoading(false);
    }
  };

  const refresh = async () => {
    try {
      setRefreshing(true);
      const data = (await fetchNotifications?.()) ?? [];
      setItems(data);
    } catch {
      setError('Failed to load notifications.');
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onOpen = async (item: NotificationItem) => {
    if (item.unread) await markRead?.(item.id);
    if (item.target?.route) {
      navigation?.navigate?.(item.target.route as never, item.target.params);
    }
  };

  const renderList = () => {
    if (loading) return <LoadingState lines={4} />;
    if (error) return <ErrorState body={error} actionLabel="Retry" onAction={load} />;
    if (!items.length) return <EmptyState title="You’re all caught up" body="No notifications right now." actionLabel="Back to Home" onAction={() => navigation?.navigate?.('Home')} />;
    return (
      <List
        style={{ flex: 1 }}
        data={items}
        keyExtractor={(i) => i.id}
        refreshing={refreshing}
        onRefresh={refresh}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        renderItem={({ item }) => (
          <Card bordered onPress={() => onOpen(item)}>
            <AppText variant="body" fontWeight="800">
              {item.title}
            </AppText>
            <AppText variant="body" numberOfLines={2}>
              {item.body}
            </AppText>
            <AppText variant="caption" color="$gray10">
              {item.ts}
              {item.unread ? ' · Unread' : ''}
            </AppText>
          </Card>
        )}
      />
    );
  };

  const content = renderList();
  // When embedded, parent screen is responsible for safe area / background.
  if (embedded) return content as any;
  return <Screen scroll={items.length > 0 ? false : true}>{content}</Screen>;
}

