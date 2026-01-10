import React, { useEffect, useMemo, useState } from 'react';
import { Screen, Section, List, EmptyState, Card, AppText, PostRow, AppButton, Sheet } from '../../ui';
import { listsStore } from '../../storage/lists';
import { interactionsStore } from '../../storage/interactions';
import { useNavigation } from '@react-navigation/native';
import { apiClient } from '../../api/client';
import { WhyThisSheet } from '../ranking/WhyThisSheet';

export default function ListTimelineScreen({ route, token }: any) {
  const navigation = useNavigation<any>();
  const listId = route?.params?.id as string;
  const [list, setList] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [dissolvedOpen, setDissolvedOpen] = useState(false);
  const [whyOpen, setWhyOpen] = useState(false);
  const [whyItems, setWhyItems] = useState<any[] | null>(null);
  const [whyAlgo, setWhyAlgo] = useState<string | null>(null);

  const load = async () => {
    if (token && token !== 'dev-session') {
      const resp: any = await apiClient.listsTimeline(token, listId);
      setList(resp?.list ?? null);
      setItems((resp?.feed ?? []) as any[]);
    } else {
      const l = await listsStore.getList(listId);
      setList(l);
      const bookmarks = await interactionsStore.listBookmarks();
      const snapById = new Map(bookmarks.map((b) => [b.snapshot?.id, b.snapshot]));
      const rows = (l?.itemIds ?? [])
        .map((id: string) => snapById.get(id))
        .filter(Boolean)
        .map((s: any) => ({ id: s.id, body: s.body, author: s.author, created_at: s.created_at }));
      setItems(rows);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listId]);

  const header = useMemo(
    () => (
      <Section title={list?.name ?? 'List'} subtitle={list?.description}>
        <AppButton tone="ghost" onPress={() => navigation.navigate('ListEdit' as never, { id: listId } as never)}>
          Edit list
        </AppButton>
        <AppButton tone="secondary" onPress={() => navigation.navigate('ListAddItems' as never, { id: listId } as never)}>
          Add items
        </AppButton>
      </Section>
    ),
    [list, listId, navigation],
  );

  if (!list) {
    return (
      <Screen>
        <EmptyState title="List not found" body="This list is missing." actionLabel="Back" onAction={() => navigation.goBack()} />
      </Screen>
    );
  }

  if (!items.length) {
    return (
      <Screen>
        {header}
        <EmptyState title="No items yet" body="Add items by bookmarking posts, then save them into a list (next step)." />
      </Screen>
    );
  }

  return (
    <Screen scroll={false}>
      <List
        style={{ flex: 1 }}
        data={items}
        keyExtractor={(i) => i.id}
        ListHeaderComponent={header}
        renderItem={({ item }) => (
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
              why={item?.rank?.why ?? null}
              onWhyPress={() => {
                setWhyItems(item?.rank?.why ?? null);
                setWhyAlgo(item?.rank?.algo ?? null);
                setWhyOpen(true);
              }}
              onPress={() => navigation.navigate('ThreadDetail' as never, { id: item.id } as never)}
            />
            <AppButton
              tone="ghost"
              onPress={async () => {
                if (token && token !== 'dev-session') {
                  try {
                    await apiClient.listsRemoveItem(token, listId, item.id);
                  } catch (e: any) {
                    if (e?.message === 'gathering_ended') {
                      setDissolvedOpen(true);
                      return;
                    }
                  }
                }
                else await listsStore.removeItem(listId, item.id);
                await load();
              }}
            >
              Remove from list
            </AppButton>
          </Card>
        )}
      />
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
      <WhyThisSheet open={whyOpen} onClose={() => setWhyOpen(false)} why={whyItems} algo={whyAlgo} />
    </Screen>
  );
}


