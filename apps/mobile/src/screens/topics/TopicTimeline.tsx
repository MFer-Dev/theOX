import React, { useEffect, useMemo, useState } from 'react';
import { Screen, Section, List, EmptyState, PostRow } from '../../ui';
import { apiClient } from '../../api/client';
import { postsStore } from '../../storage/posts';
import { useNavigation } from '@react-navigation/native';
import { relationshipsStore } from '../../storage/relationships';
import { ScsExplainerSheet } from '../cred/ScsExplainerSheet';
import { GenerationExplainerSheet } from '../cred/GenerationExplainerSheet';
import { WhyThisSheet } from '../ranking/WhyThisSheet';

type Props = {
  route: any;
};

export default function TopicTimelineScreen({ route }: Props) {
  const navigation = useNavigation<any>();
  const topic = route?.params?.topic ?? '';
  const token = route?.params?.token ?? 'dev-session';
  const world = (route?.params?.world ?? 'tribal') as 'tribal' | 'gathering';

  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [scsOpen, setScsOpen] = useState(false);
  const [genOpen, setGenOpen] = useState(false);
  const [genTarget, setGenTarget] = useState<string | null>(null);
  const [whyOpen, setWhyOpen] = useState(false);
  const [whyItems, setWhyItems] = useState<any[] | null>(null);
  const [whyAlgo, setWhyAlgo] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const resp =
      world === 'gathering'
        ? await apiClient.gatheringTimeline(token, { topic })
        : await apiClient.feed(token, topic);
    const remote = (resp?.feed ?? []) as any[];
    const local = await postsStore.list({ topic });
    const deleted = new Set(await postsStore.getDeletedIds());
    const muted = new Set((await relationshipsStore.listMutedSubjects()).map((s) => s.toLowerCase()));
    const merged: any[] = [];
    const seen = new Set<string>();
    for (const it of local) {
      const h = (it?.author?.handle ?? '').toLowerCase();
      if (!it?.id || deleted.has(it.id) || seen.has(it.id) || (h && muted.has(h))) continue;
      merged.push(it);
      seen.add(it.id);
    }
    for (const it of remote) {
      const h = (it?.author?.handle ?? '').toLowerCase();
      if (!it?.id || deleted.has(it.id) || seen.has(it.id) || (h && muted.has(h))) continue;
      merged.push(it);
      seen.add(it.id);
    }
    setItems(merged);
    setLoading(false);
  };

  useEffect(() => {
    if (topic) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topic, world, token]);

  const header = useMemo(
    () => <Section title={`#${topic}`} subtitle={world === 'gathering' ? 'Gathering world' : 'Tribal world'} />,
    [topic, world],
  );

  if (!topic) return <Screen><EmptyState title="Missing topic" body="No topic provided." /></Screen>;
  if (!items.length && !loading) return <Screen>{header}<EmptyState title="No posts yet" body="Be the first to post on this topic." /></Screen>;

  return (
    <Screen scroll={false}>
      <List
        style={{ flex: 1 }}
        data={items}
        keyExtractor={(i) => i.id}
        ListHeaderComponent={header}
        renderItem={({ item }) => (
          <PostRow
            id={item.id}
            displayName={item.author?.display_name}
            handle={item.author?.handle}
            avatarUrl={item.author?.avatar_url ?? null}
            generation={item.generation ?? item.author?.generation ?? null}
            body={item.body}
            topic={item.topic ?? null}
            scs={typeof item.ics === 'number' ? item.ics : null}
            why={item?.rank?.why ?? null}
            onWhyPress={() => {
              setWhyItems(item?.rank?.why ?? null);
              setWhyAlgo(item?.rank?.algo ?? null);
              setWhyOpen(true);
            }}
            aiAssisted={Boolean(item.ai_assisted)}
            media={item.media}
            onScsPress={() => setScsOpen(true)}
            onGenerationPress={(g) => {
              setGenTarget(g ?? null);
              setGenOpen(true);
            }}
            onPress={() => navigation.navigate('ThreadDetail' as never, { id: item.id } as never)}
            onMentionPress={(h) => navigation.navigate('ProfileOther' as never, { userId: h } as never)}
          />
        )}
      />
      <WhyThisSheet open={whyOpen} onClose={() => setWhyOpen(false)} why={whyItems} algo={whyAlgo} />
      <ScsExplainerSheet open={scsOpen} onClose={() => setScsOpen(false)} />
      <GenerationExplainerSheet open={genOpen} onClose={() => setGenOpen(false)} generation={genTarget} />
    </Screen>
  );
}



