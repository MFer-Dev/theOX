import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigation } from '@react-navigation/native';
import { Screen, AppText, AppButton, List, PostRow, Pill, PillRow, Sheet } from '../../ui';
import { EmptyState, ErrorState, LoadingState } from '../../ui/recipes/states';
import { apiClient } from '../../api/client';
import { Share } from 'react-native';
import { postsStore } from '../../storage/posts';
import { relationshipsStore } from '../../storage/relationships';
import { postUrl } from '../../config/links';
import { useWorld } from '../../providers/world';
import { ScsExplainerSheet } from '../cred/ScsExplainerSheet';
import { GenerationExplainerSheet } from '../cred/GenerationExplainerSheet';
import { YStack, useThemeName } from 'tamagui';
import { WhyThisSheet } from '../ranking/WhyThisSheet';

type Props = {
  token: string;
  world: 'tribal' | 'gathering';
  gatheringStartsAt?: string | null;
  gatheringEligible?: boolean;
};

const HomeFeed = ({ token, world, gatheringStartsAt, gatheringEligible }: Props) => {
  const navigation = useNavigation<any>();
  const worldHdr = useWorld();
  const themeName = useThemeName();
  const isDark = String(themeName).includes('dark');
  const [feed, setFeed] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [repostSheetOpen, setRepostSheetOpen] = useState(false);
  const [repostTarget, setRepostTarget] = useState<any | null>(null);
  const [scsOpen, setScsOpen] = useState(false);
  const [genOpen, setGenOpen] = useState(false);
  const [genTarget, setGenTarget] = useState<string | null>(null);
  const [whyOpen, setWhyOpen] = useState(false);
  const [whyItems, setWhyItems] = useState<any[] | null>(null);
  const [whyAlgo, setWhyAlgo] = useState<string | null>(null);
  const [genFilter, setGenFilter] = useState<'all' | 'genz' | 'millennial' | 'genx' | 'boomer'>('all');

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const resp =
        world === 'gathering'
          ? await apiClient.gatheringTimeline?.(token, {})
          : await apiClient.feed?.(token, undefined);
      const remote = (resp?.feed ?? []) as any[];
      if (token === 'dev-session') {
        const local = await postsStore.list({});
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
        setFeed(merged);
      } else {
        // Backend-driven; local parity stores are only for dev-session.
        const muted = new Set((await relationshipsStore.listMutedSubjects()).map((s) => s.toLowerCase()));
        setFeed(
          remote.filter((it) => {
            const h = (it?.author?.handle ?? '').toLowerCase();
            return !(h && muted.has(h));
          }),
        );
      }
    } catch (err) {
      setFeed([]);
      setError('Unable to load feed');
    }
    setLoading(false);
  }, [token, world]);

  const refresh = async () => {
    try {
      setRefreshing(true);
      setError(null);
      const resp =
        world === 'gathering'
          ? await apiClient.gatheringTimeline?.(token, {})
          : await apiClient.feed?.(token, undefined);
      const remote = (resp?.feed ?? []) as any[];
      if (token === 'dev-session') {
        const local = await postsStore.list({});
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
        setFeed(merged);
      } else {
        const muted = new Set((await relationshipsStore.listMutedSubjects()).map((s) => s.toLowerCase()));
        setFeed(
          remote.filter((it) => {
            const h = (it?.author?.handle ?? '').toLowerCase();
            return !(h && muted.has(h));
          }),
        );
      }
    } catch (err) {
      setError('Unable to load feed');
    }
    setRefreshing(false);
  };

  const trends = useMemo(() => {
    const counts = new Map<string, number>();
    for (const it of feed) {
      const t = (it?.topic ?? '').trim();
      if (!t) continue;
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([t]) => t);
  }, [feed]);

  const filteredFeed = useMemo(() => {
    if (world !== 'gathering' || genFilter === 'all') return feed;
    const want = genFilter;
    return feed.filter((it: any) => {
      const g = String(it?.generation ?? it?.author?.generation ?? '').trim().toLowerCase();
      return g === want;
    });
  }, [feed, genFilter, world]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Interactions are backend-driven (viewer flags + counts), so no local hydration here.

  const genPills = useMemo(
    () =>
      ([
        { key: 'all', label: 'All' },
        { key: 'genz', label: 'Gen Z' },
        { key: 'millennial', label: 'Millennial' },
        { key: 'genx', label: 'Gen X' },
        { key: 'boomer', label: 'Boomer' },
      ] as const),
    [],
  );

  const trendingPills = useMemo(() => {
    if (!trends.length) return null;
    return (
      <YStack
        backgroundColor="$background"
        paddingHorizontal="$3"
        paddingTop="$2"
        paddingBottom="$2"
        borderBottomWidth={1}
        borderColor={isDark ? 'rgba(229,231,235,0.12)' : 'rgba(17,24,39,0.10)'}
      >
        <PillRow>
          {trends.map((t) => (
            <Pill
              key={t}
              label={`#${t}`}
              onPress={() => navigation.navigate('TopicTimeline' as never, { topic: t, world, token } as never)}
            />
          ))}
        </PillRow>
      </YStack>
    );
  }, [navigation, token, trends, world]);

  const gatheringSticky = useMemo(() => {
    return (
      <YStack
        backgroundColor="$background"
        paddingHorizontal="$3"
        paddingTop="$2"
        paddingBottom="$2"
        borderBottomWidth={1}
        borderColor={isDark ? 'rgba(229,231,235,0.12)' : 'rgba(17,24,39,0.10)'}
      >
        <PillRow>
          {genPills.map((p) => (
            <Pill key={p.key} label={p.label} active={genFilter === (p.key as any)} onPress={() => setGenFilter(p.key as any)} />
          ))}
        </PillRow>
        {trendingPills}
      </YStack>
    );
  }, [genFilter, genPills, isDark, trendingPills]);

  return (
    <Screen scroll={false} pad={false}>
      {loading ? (
        <LoadingState lines={4} />
      ) : error ? (
        <ErrorState body={error} onAction={load} />
      ) : filteredFeed.length === 0 ? (
        <EmptyState title="No entries yet" body="Be the first to post." actionLabel="Refresh" onAction={load} />
      ) : (
        <List
          style={{ flex: 1 }}
          data={
            world === 'gathering'
              ? ([{ __type: 'sticky' }] as any[]).concat(filteredFeed as any[])
              : (filteredFeed as any[])
          }
          keyExtractor={(item: any) => (item?.__type ? String(item.__type) : item.id)}
          stickyHeaderIndices={world === 'gathering' ? [0] : undefined}
          ListHeaderComponent={world === 'tribal' ? trendingPills : null}
          renderItem={({ item }: any) => {
            if (item?.__type === 'sticky') return gatheringSticky;
            return (
              <PostRow
                id={item.id}
                displayName={item.author?.display_name}
                handle={item.author?.handle}
                avatarUrl={item.author?.avatar_url ?? null}
                generation={item.generation ?? item.author?.generation ?? null}
                body={item.body}
                topic={item.topic ?? null}
                scs={typeof item.ics === 'number' ? item.ics : null}
                aiAssisted={Boolean(item.ai_assisted)}
                media={item.media}
                quote={item.quote ?? null}
                why={item?.rank?.why ?? null}
                onWhyPress={() => {
                  setWhyItems(item?.rank?.why ?? null);
                  setWhyAlgo(item?.rank?.algo ?? null);
                  setWhyOpen(true);
                }}
                ts={''}
                onScsPress={() => setScsOpen(true)}
                onGenerationPress={(g) => {
                  setGenTarget(g ?? null);
                  setGenOpen(true);
                }}
                onPress={() => navigation.navigate('ThreadDetail' as never, { id: item.id } as never)}
                onReply={() => navigation.navigate('ThreadDetail' as never, { id: item.id, focusReply: true } as never)}
                onTopicPress={(t) => navigation.navigate('TopicTimeline' as never, { topic: t, world, token } as never)}
                onMentionPress={(h) => navigation.navigate('ProfileOther' as never, { userId: h } as never)}
                liked={Boolean(item?.viewer?.liked)}
                reposted={Boolean(item?.viewer?.reposted)}
                bookmarked={Boolean(item?.viewer?.bookmarked)}
                likeCount={item?.like_count}
                repostCount={item?.repost_count}
                replyCount={item?.reply_count}
                onLike={async () => {
                  try {
                    const res: any = await apiClient.discourseToggleInteraction(token, item.id, 'like', worldHdr);
                    setFeed((p) =>
                      p.map((x: any) =>
                        x.id === item.id
                          ? { ...x, like_count: res?.counts?.like_count, viewer: { ...(x.viewer ?? {}), liked: res?.active } }
                          : x,
                      ),
                    );
                  } catch {
                    // ignore
                  }
                }}
                onRepost={async () => {
                  setRepostTarget(item);
                  setRepostSheetOpen(true);
                }}
                onBookmark={async () => {
                  try {
                    const res: any = await apiClient.discourseToggleInteraction(token, item.id, 'bookmark', worldHdr);
                    setFeed((p) =>
                      p.map((x: any) =>
                        x.id === item.id
                          ? {
                              ...x,
                              bookmark_count: res?.counts?.bookmark_count,
                              viewer: { ...(x.viewer ?? {}), bookmarked: res?.active },
                            }
                          : x,
                      ),
                    );
                  } catch {
                    // ignore
                  }
                }}
                onShare={async () => {
                  try {
                    await Share.share({ message: postUrl(item.id) });
                  } catch {
                    // ignore
                  }
                }}
              />
            );
          }}
          refreshing={refreshing}
          onRefresh={refresh}
          contentContainerStyle={{ paddingTop: 12, paddingBottom: 28 }}
        />
      )}
      <Sheet isOpen={repostSheetOpen} onClose={() => setRepostSheetOpen(false)}>
        <AppText variant="title">Repost</AppText>
        <AppButton
          tone="primary"
          onPress={async () => {
            if (!repostTarget?.id) return;
            try {
              const res: any = await apiClient.discourseToggleInteraction(token, repostTarget.id, 'repost', worldHdr);
              setFeed((p) =>
                p.map((x: any) =>
                  x.id === repostTarget.id
                    ? { ...x, repost_count: res?.counts?.repost_count, viewer: { ...(x.viewer ?? {}), reposted: res?.active } }
                    : x,
                ),
              );
            } catch {
              // ignore
            }
            setRepostSheetOpen(false);
          }}
        >
          Repost
        </AppButton>
        <AppButton
          tone="secondary"
          onPress={() => {
            if (!repostTarget?.id) return;
            setRepostSheetOpen(false);
            navigation.navigate('Compose' as never, { quoteId: repostTarget.id } as never);
          }}
        >
          Quote
        </AppButton>
        <AppButton tone="ghost" onPress={() => setRepostSheetOpen(false)}>
          Cancel
        </AppButton>
      </Sheet>
      <ScsExplainerSheet open={scsOpen} onClose={() => setScsOpen(false)} />
      <GenerationExplainerSheet open={genOpen} onClose={() => setGenOpen(false)} generation={genTarget} />
      <WhyThisSheet open={whyOpen} onClose={() => setWhyOpen(false)} why={whyItems} algo={whyAlgo} />
    </Screen>
  );
};

export default HomeFeed;

