import React, { useEffect, useMemo, useState } from 'react';
import { Screen, Section, List, AppText, Card, FormField, AppButton } from '../../ui';
import { listsStore, type SavedList } from '../../storage/lists';
import { useNavigation } from '@react-navigation/native';
import { apiClient } from '../../api/client';
import { Sheet } from '../../ui';
import { useWorld } from '../../providers/world';

export default function ListsHomeScreen({ token }: { token: string }) {
  const navigation = useNavigation<any>();
  const [lists, setLists] = useState<Array<SavedList | { id: string; name: string; description?: string; itemCount?: number }>>([]);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [dissolvedOpen, setDissolvedOpen] = useState(false);

  const load = async () => {
    if (token && token !== 'dev-session') {
      const resp: any = await apiClient.listsList(token);
      const l = (resp?.lists ?? []) as any[];
      setLists(l.map((it: any) => ({ id: it.id, name: it.name, description: it.description, itemCount: it.itemCount ?? 0 })));
    } else {
      const l = await listsStore.getLists();
      setLists(l);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const header = useMemo(
    () => (
      <>
        <Section title="Lists" subtitle="Curate timelines for focus and context." />
        <Card bordered>
          <AppText variant="caption">Create a list</AppText>
          <FormField value={name} onChangeText={setName} placeholder="List name" />
          <FormField value={desc} onChangeText={setDesc} placeholder="Description (optional)" />
          <AppButton
            tone="primary"
            disabled={!name.trim()}
            onPress={async () => {
              if (token && token !== 'dev-session') {
                try {
                  await apiClient.listsCreate(token, { name: name.trim(), description: desc.trim() || undefined });
                } catch (e: any) {
                  if (e?.message === 'gathering_ended') {
                    setDissolvedOpen(true);
                    return;
                  }
                }
              } else {
                await listsStore.createList(name.trim(), desc.trim() || undefined);
              }
              setName('');
              setDesc('');
              await load();
            }}
          >
            Create list
          </AppButton>
        </Card>
      </>
    ),
    [desc, name, token],
  );

  return (
    <Screen scroll={false}>
      <List
        style={{ flex: 1 }}
        data={lists}
        keyExtractor={(l) => l.id}
        ListHeaderComponent={header}
        renderItem={({ item }) => (
          <Card
            bordered
            onPress={() => navigation.navigate('ListTimeline' as never, { id: item.id } as never)}
          >
            <AppText variant="body" fontWeight="700">
              {item.name}
            </AppText>
            {item.description ? <AppText variant="caption">{item.description}</AppText> : null}
            <AppText variant="caption">
              {'itemCount' in item ? item.itemCount : (item as SavedList).itemIds.length} items
            </AppText>
          </Card>
        )}
      />
      <Sheet isOpen={dissolvedOpen} onClose={() => setDissolvedOpen(false)}>
        <Section title="The Gathering dissolved">
          <AppText variant="body">Lists can’t be changed right now. Try again when The Gathering opens next.</AppText>
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



