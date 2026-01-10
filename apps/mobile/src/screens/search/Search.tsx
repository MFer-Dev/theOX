import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Screen, FormField, List, AppText, PostRow, Pill, PillRow, Card } from '../../ui';
import { SettingsRow } from '../../ui/recipes/rows';
import { Hash, Users, FileText } from '@tamagui/lucide-icons';
import { apiClient } from '../../api/client';
import { useNavigation } from '@react-navigation/native';
import { relationshipsStore } from '../../storage/relationships';
import { ScsExplainerSheet } from '../cred/ScsExplainerSheet';
import { GenerationExplainerSheet } from '../cred/GenerationExplainerSheet';
import { YStack } from 'tamagui';
import { WhyThisSheet } from '../ranking/WhyThisSheet';

type Props = {
  token: string;
  world: 'tribal' | 'gathering';
};

type Mode = 'posts' | 'people' | 'topics';

export default function SearchScreen({ token, world }: Props) {
  const navigation = useNavigation<any>();
  const [q, setQ] = useState('');
  const [mode, setMode] = useState<Mode>('posts');
  const [trybe, setTrybe] = useState<string>('');
  const [posts, setPosts] = useState<any[]>([]);
  const [people, setPeople] = useState<any[]>([]);
  const [topics, setTopics] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [muted, setMuted] = useState<Set<string>>(new Set());
  const [scsOpen, setScsOpen] = useState(false);
  const [genOpen, setGenOpen] = useState(false);
  const [genTarget, setGenTarget] = useState<string | null>(null);
  const [whyOpen, setWhyOpen] = useState(false);
  const [whyItems, setWhyItems] = useState<any[] | null>(null);
  const [whyAlgo, setWhyAlgo] = useState<string | null>(null);
  const debounce = useRef<any>(null);

  useEffect(() => {
    // Debounced backend search.
    if (debounce.current) clearTimeout(debounce.current);
    const term = q.trim();
    if (!term) {
      setPosts([]);
      setPeople([]);
      setTopics([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounce.current = setTimeout(async () => {
      try {
        const resp: any = await apiClient.search(token, term, {
          type: mode === 'posts' ? 'posts' : mode === 'people' ? 'users' : 'topics',
          trybe: world === 'gathering' && trybe.trim() ? trybe.trim() : undefined,
        });
        const results = resp?.results ?? resp;
        setPeople((results?.users ?? []) as any[]);
        setPosts((results?.posts ?? []) as any[]);
        setTopics((results?.topics ?? []) as any[]);
      } catch {
        setPeople([]);
        setPosts([]);
        setTopics([]);
      } finally {
        setLoading(false);
      }
    }, 220);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [mode, q, token, trybe, world]);

  useEffect(() => {
    let alive = true;
    relationshipsStore
      .listMutedSubjects()
      .then((ids) => {
        if (!alive) return;
        setMuted(new Set(ids.map((s) => s.toLowerCase())));
      })
      .catch(() => setMuted(new Set()));
    return () => {
      alive = false;
    };
  }, []);

  const postsNoMuted = useMemo(() => {
    return (posts ?? []).filter((p: any) => {
      const h = String(p?.author?.handle ?? '').toLowerCase();
      return !(h && muted.has(h));
    });
  }, [muted, posts]);

  const header = useMemo(
    () => (
      <>
        <YStack paddingHorizontal="$3" paddingTop="$2" paddingBottom="$2">
          <Card bordered>
            <YStack gap="$3">
              <FormField value={q} onChangeText={setQ} placeholder="Search" accessibilityLabel="Search" />
              <PillRow>
                {(['posts', 'people', 'topics'] as const).map((m) => (
                  <Pill
                    key={m}
                    label={m === 'posts' ? 'Posts' : m === 'people' ? 'People' : 'Topics'}
                    active={mode === m}
                    onPress={() => setMode(m)}
                  />
                ))}
              </PillRow>
              {world === 'gathering' ? (
                <FormField value={trybe} onChangeText={setTrybe} placeholder="Trybe (optional)" label="Trybe" />
              ) : null}
            </YStack>
          </Card>
        </YStack>
        {loading ? <AppText variant="caption" color="$gray10">Searching…</AppText> : null}
      </>
    ),
    [loading, mode, q, trybe, world],
  );

  return (
    <Screen scroll={false} pad={false}>
      <List
        style={{ flex: 1 }}
        data={mode === 'posts' ? postsNoMuted : mode === 'people' ? (people as any) : (topics as any)}
        keyExtractor={(r: any) => (mode === 'posts' ? r.id : mode === 'people' ? r.handle ?? r.id : r.topic ?? String(r.topic))}
        ListHeaderComponent={header}
        renderItem={({ item }: any) => {
          if (mode === 'posts') {
            return (
              <PostRow
                id={item.id}
                displayName={item.author?.display_name}
                handle={item.author?.handle}
                avatarUrl={item.author?.avatar_url ?? null}
                generation={item.generation ?? item.author?.generation ?? null}
                body={item.body}
                topic={item.topic ?? null}
                scs={typeof (item as any).ics === 'number' ? (item as any).ics : null}
                why={item?.rank?.why ?? null}
                onWhyPress={() => {
                  setWhyItems(item?.rank?.why ?? null);
                  setWhyAlgo(item?.rank?.algo ?? null);
                  setWhyOpen(true);
                }}
                onScsPress={() => setScsOpen(true)}
                onGenerationPress={(g) => {
                  setGenTarget(g ?? null);
                  setGenOpen(true);
                }}
                onPress={() => navigation.navigate('ThreadDetail' as never, { id: item.id } as never)}
                onTopicPress={(t) => navigation.navigate('TopicTimeline' as never, { topic: t, world, token } as never)}
                onMentionPress={(h) => navigation.navigate('ProfileOther' as never, { userId: h } as never)}
              />
            );
          }
          if (mode === 'people') {
            return (
              <SettingsRow
                icon={Users}
                title={`@${item.handle}`}
                subtitle={`${item.display_name ?? 'User'} · ${item.generation ?? 'unknown'}`}
                onPress={() => navigation.navigate('ProfileOther' as never, { userId: item.handle } as never)}
              />
            );
          }
          return (
            <SettingsRow
              icon={Hash}
              title={`#${item.topic}`}
              subtitle={`${item.count} posts`}
              onPress={() => {
                navigation.navigate('TopicTimeline' as never, { topic: item.topic, world, token } as never);
              }}
            />
          );
        }}
      />
      <ScsExplainerSheet open={scsOpen} onClose={() => setScsOpen(false)} />
      <GenerationExplainerSheet open={genOpen} onClose={() => setGenOpen(false)} generation={genTarget} />
      <WhyThisSheet open={whyOpen} onClose={() => setWhyOpen(false)} why={whyItems} algo={whyAlgo} />
    </Screen>
  );
}


