import React, { useEffect, useMemo, useState } from 'react';
import { Screen, Section, List, EmptyState, Card, PostRow, AppButton, Sheet, AppText } from '../../ui';
import { interactionsStore } from '../../storage/interactions';
import { listsStore } from '../../storage/lists';
import { useNavigation } from '@react-navigation/native';
import { apiClient } from '../../api/client';

export default function ListAddItemsScreen({ route, token }: any) {
  const navigation = useNavigation<any>();
  const listId = route?.params?.id as string;
  const [list, setList] = useState<any>(null);
  const [bookmarks, setBookmarks] = useState<any[]>([]);
  const [dissolvedOpen, setDissolvedOpen] = useState(false);

  const load = async () => {
    if (token && token !== 'dev-session') {
      const l = await apiClient.listsGet(token, listId);
      setList(l?.list ?? null);
      const items = await apiClient.discourseBookmarks(token);
      setBookmarks((items?.feed ?? []) as any[]);
    } else {
      const l = await listsStore.getList(listId);
      setList(l);
      const items = await interactionsStore.listBookmarks();
      const rows = items
        .map((s) => s.snapshot)
        .filter(Boolean)
        .map((s: any) => ({ id: s.id, body: s.body, author: s.author, created_at: s.created_at }));
      setBookmarks(rows);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listId]);

  const header = useMemo(
    () => <Section title="Add items" subtitle={list ? `List: ${list.name}` : undefined} />,
    [list],
  );

  if (!bookmarks.length) {
    return (
      <Screen>
        {header}
        <EmptyState title="No bookmarks" body="Bookmark posts first, then add them to lists." />
      </Screen>
    );
  }

  const set = new Set(list?.itemIds ?? []);

  return (
    <Screen scroll={false}>
      <List
        style={{ flex: 1 }}
        data={bookmarks}
        keyExtractor={(i) => i.id}
        ListHeaderComponent={header}
        renderItem={({ item }) => {
          const inList = set.has(item.id);
          return (
            <Card bordered>
              <PostRow
                id={item.id}
                displayName={item.author?.display_name}
                handle={item.author?.handle}
                avatarUrl={item.author?.avatar_url ?? null}
                body={item.body}
                topic={item.topic ?? null}
                media={item.media}
                aiAssisted={Boolean(item.ai_assisted)}
                quote={item.quote ?? null}
              />
              <AppButton
                tone={inList ? 'secondary' : 'primary'}
                onPress={async () => {
                  if (token && token !== 'dev-session') {
                    try {
                      if (inList) await apiClient.listsRemoveItem(token, listId, item.id);
                      else await apiClient.listsAddItem(token, listId, item.id);
                    } catch (e: any) {
                      if (e?.message === 'gathering_ended') {
                        setDissolvedOpen(true);
                        return;
                      }
                    }
                  } else {
                    if (inList) await listsStore.removeItem(listId, item.id);
                    else await listsStore.addItem(listId, item.id);
                  }
                  await load();
                }}
              >
                {inList ? 'Remove' : 'Add'}
              </AppButton>
            </Card>
          );
        }}
      />
      <AppButton tone="ghost" onPress={() => navigation.goBack()}>
        Done
      </AppButton>
      <Sheet isOpen={dissolvedOpen} onClose={() => setDissolvedOpen(false)}>
        <Section title="The Gathering dissolved">
          <AppText variant="body">This list can’t be modified right now. Try again when The Gathering opens next.</AppText>
          <AppButton
            tone="primary"
            onPress={() => {
              setDissolvedOpen(false);
              navigation.goBack();
            }}
          >
            Return
          </AppButton>
        </Section>
      </Sheet>
    </Screen>
  );
}



