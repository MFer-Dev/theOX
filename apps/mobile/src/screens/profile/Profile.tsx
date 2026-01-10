import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigation } from '@react-navigation/native';
import { Screen, Section, AppText, AppButton, List, Avatar, PostRow, Pill, PillRow, Card, CredBadge } from '../../ui';
import { EmptyState, ErrorState, LoadingState, BlockedState } from '../../ui/recipes/states';
import { apiClient } from '../../api/client';
import { XStack, YStack } from 'tamagui';
import { Share } from 'react-native';
import { postsStore } from '../../storage/posts';
import { ScsExplainerSheet } from '../cred/ScsExplainerSheet';
import { GenerationExplainerSheet } from '../cred/GenerationExplainerSheet';
import { postUrl } from '../../config/links';
import { useWorld } from '../../providers/world';
import { WhyThisSheet } from '../ranking/WhyThisSheet';

const Profile = ({ token }: any) => {
  const navigation = useNavigation<any>();
  const world = useWorld();
  const [profile, setProfile] = useState<any>(null);
  const [posts, setPosts] = useState<any[]>([]);
  const [tab, setTab] = useState<'posts' | 'replies' | 'media' | 'bookmarks'>('posts');
  const [bookmarks, setBookmarks] = useState<any[]>([]);
  const [replies, setReplies] = useState<any[]>([]);
  const [media, setMedia] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [restricted, setRestricted] = useState(false);
  const [scsOpen, setScsOpen] = useState(false);
  const [genOpen, setGenOpen] = useState(false);
  const [whyOpen, setWhyOpen] = useState(false);
  const [whyItems, setWhyItems] = useState<any[] | null>(null);
  const [whyAlgo, setWhyAlgo] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const defaultAvatar = require('../../../../public/profile_avatar.png');
      const me = await apiClient.me?.(token);
      const user = me?.user ?? null;
      setProfile(user ? { ...user, avatar_url: (user as any)?.avatar_url ?? defaultAvatar } : null);
      if (token === 'dev-session') {
        const local = await postsStore.list({ handle: user?.handle });
        const deleted = new Set(await postsStore.getDeletedIds());
        const merged: any[] = [];
        const seen = new Set<string>();
        for (const it of local) {
          if (!it?.id || deleted.has(it.id) || seen.has(it.id)) continue;
          merged.push(it);
          seen.add(it.id);
        }
        setPosts(merged);
        setRestricted(false);
      } else {
        const feed = await apiClient.userFeed?.(token);
        setPosts((feed?.feed ?? []) as any[]);
        setRestricted(Boolean(feed?.restricted));
      }
    } catch {
      setError('Failed to load profile.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (tab === 'bookmarks') {
      apiClient
        .discourseBookmarks(token)
        .then((resp: any) => setBookmarks((resp?.feed ?? []) as any[]))
        .catch(() => setBookmarks([]));
    }
    if (tab === 'media') {
      apiClient
        .discourseMyMedia(token)
        .then((resp: any) => setMedia((resp?.feed ?? []) as any[]))
        .catch(() => setMedia([]));
    }
    if (tab === 'replies') {
      apiClient
        .discourseMyReplies(token)
        .then((resp: any) => setReplies((resp?.feed ?? []) as any[]))
        .catch(() => setReplies([]));
    }
  }, [tab, token]);

  const header = useMemo(
    () => (
      <>
        <Section title="Profile">
          {loading && !profile ? (
            <LoadingState lines={2} />
          ) : profile ? (
            <Card bordered padding="$4">
              <YStack gap="$2" alignItems="center">
                <XStack alignItems="center" gap="$2">
                  <Avatar
                    name={profile.display_name ?? profile.handle}
                    uri={profile.avatar_url ?? null}
                    generation={profile.generation ?? null}
                    size={72}
                    onPress={() => setGenOpen(true)}
                  />
                  {typeof profile.scs === 'number' ? (
                    <CredBadge scs={profile.scs} onPress={() => setScsOpen(true)} showText />
                  ) : null}
                </XStack>
                <YStack gap="$1" alignItems="center">
                  <AppText variant="title">{profile.display_name ?? profile.handle}</AppText>
                  <AppText variant="meta">
                    @{profile.handle} · {profile.generation ?? 'unknown'}
                  </AppText>
                  {typeof profile.scs === 'number' ? (
                    <AppText variant="caption" onPress={() => setScsOpen(true)}>
                      SCS {profile.scs} · What’s this?
                    </AppText>
                  ) : null}
                </YStack>
              </YStack>
              {profile.bio ? (
                <AppText marginTop="$2" variant="body">
                  {profile.bio}
                </AppText>
              ) : null}
              <YStack gap="$2" marginTop="$3">
                <AppButton tone="primary" fullWidth onPress={() => navigation.navigate('EditProfile' as never)}>
                  Edit profile
                </AppButton>
                <AppButton tone="secondary" fullWidth onPress={() => navigation.navigate('SettingsHome' as never)}>
                  Settings
                </AppButton>
              </YStack>
            </Card>
          ) : error ? (
            <ErrorState body={error} actionLabel="Retry" onAction={load} />
          ) : (
            <EmptyState title="No profile" body="Unable to load profile." />
          )}
        </Section>

        <Section title="Profile">
          <PillRow>
            {(
              [
                { key: 'posts', label: 'Posts' },
                { key: 'replies', label: 'Replies' },
                { key: 'media', label: 'Media' },
                { key: 'bookmarks', label: 'Bookmarks' },
              ] as const
            ).map((t) => (
              <Pill
                key={t.key}
                label={t.label}
                active={tab === t.key}
                onPress={() => setTab(t.key)}
              />
            ))}
          </PillRow>
        </Section>
      </>
    ),
    [Avatar, AppButton, AppText, Card, ErrorState, LoadingState, YStack, error, load, loading, navigation, profile, tab],
  );

  const data = tab === 'posts' ? posts : tab === 'bookmarks' ? bookmarks : tab === 'replies' ? replies : tab === 'media' ? media : [];

  return (
    <Screen scroll={false}>
      {loading ? (
        <LoadingState lines={4} />
      ) : error ? (
        <ErrorState body={error} actionLabel="Retry" onAction={load} />
      ) : restricted ? (
        <>
          {header}
          <BlockedState title="Profile restricted" body="Content is not available." />
        </>
      ) : tab === 'posts' && !posts.length ? (
        <>
          {header}
          <EmptyState title="No posts yet" body="Create your first entry." actionLabel="Create" onAction={() => navigation.navigate('Compose' as never)} />
        </>
      ) : tab === 'bookmarks' && !bookmarks.length ? (
        <>
          {header}
          <EmptyState title="No bookmarks yet" body="Save posts for later." />
        </>
      ) : tab === 'replies' && !replies.length ? (
        <>
          {header}
          <EmptyState title="No replies yet" body="Reply to a post to start a thread." />
        </>
      ) : tab === 'media' && !media.length ? (
        <>
          {header}
          <EmptyState title="No media yet" body="Posts with media will show up here." />
        </>
      ) : (
        <List
          style={{ flex: 1 }}
          data={data}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={header}
          renderItem={({ item }) => (
            <PostRow
              id={item.id}
              displayName={
                tab === 'bookmarks' || tab === 'media'
                  ? item.author?.display_name ?? item.author?.handle
                  : profile?.display_name ?? profile?.handle
              }
              handle={tab === 'bookmarks' || tab === 'media' ? item.author?.handle : profile?.handle}
              avatarUrl={tab === 'bookmarks' || tab === 'media' ? item.author?.avatar_url ?? null : profile?.avatar_url ?? null}
              generation={
                tab === 'bookmarks' || tab === 'media'
                  ? item.generation ?? item.author?.generation ?? null
                  : profile?.generation ?? null
              }
              body={item.body}
              topic={item.topic ?? null}
              scs={typeof item.ics === 'number' ? item.ics : typeof item.scs === 'number' ? item.scs : null}
              why={item?.rank?.why ?? null}
              onWhyPress={() => {
                setWhyItems(item?.rank?.why ?? null);
                setWhyAlgo(item?.rank?.algo ?? null);
                setWhyOpen(true);
              }}
              aiAssisted={Boolean(item.ai_assisted)}
              media={item.media}
              quote={tab === 'replies' ? item.quote ?? null : item.quote ?? null}
              ts={''}
              onScsPress={() => setScsOpen(true)}
              onGenerationPress={(g) => {
                setGenOpen(true);
              }}
              onPress={() =>
                tab === 'replies'
                  ? navigation.navigate('ThreadDetail' as never, { id: item.entry_id } as never)
                  : navigation.navigate('ContentDetail' as never, { id: item.id } as never)
              }
              onReply={() =>
                tab === 'replies'
                  ? navigation.navigate('ThreadDetail' as never, { id: item.entry_id, focusReply: true } as never)
                  : navigation.navigate('ThreadDetail' as never, { id: item.id, focusReply: true } as never)
              }
              onTopicPress={(t) => navigation.navigate('TopicTimeline' as never, { topic: t, world: 'tribal', token } as never)}
              onMentionPress={(h) => navigation.navigate('ProfileOther' as never, { userId: h } as never)}
              liked={Boolean(item?.viewer?.liked)}
              reposted={Boolean(item?.viewer?.reposted)}
              bookmarked={Boolean(item?.viewer?.bookmarked)}
              likeCount={item?.like_count}
              repostCount={item?.repost_count}
              replyCount={item?.reply_count}
              onLike={async () => {
                try {
                  if (tab === 'replies') {
                    const res: any = await apiClient.discourseToggleReplyInteraction(token, item.id, 'like', world);
                    setReplies((p) =>
                      p.map((x: any) =>
                        x.id === item.id
                          ? { ...x, like_count: res?.counts?.like_count, viewer: { ...(x.viewer ?? {}), liked: res?.active } }
                          : x,
                      ),
                    );
                  } else {
                    const res: any = await apiClient.discourseToggleInteraction(token, item.id, 'like', world);
                    const update = (x: any) =>
                      x.id === item.id
                        ? { ...x, like_count: res?.counts?.like_count, viewer: { ...(x.viewer ?? {}), liked: res?.active } }
                        : x;
                    if (tab === 'bookmarks') setBookmarks((p) => p.map(update));
                    else if (tab === 'media') setMedia((p) => p.map(update));
                    else setPosts((p) => p.map(update));
                  }
                } catch {
                  // ignore
                }
              }}
              onRepost={async () => {
                try {
                  if (tab === 'replies') {
                    const res: any = await apiClient.discourseToggleReplyInteraction(token, item.id, 'repost', world);
                    setReplies((p) =>
                      p.map((x: any) =>
                        x.id === item.id
                          ? { ...x, repost_count: res?.counts?.repost_count, viewer: { ...(x.viewer ?? {}), reposted: res?.active } }
                          : x,
                      ),
                    );
                  } else {
                    // Quote repost UX lives in Home feed; here we keep repost as a toggle.
                    const res: any = await apiClient.discourseToggleInteraction(token, item.id, 'repost', world);
                    const update = (x: any) =>
                      x.id === item.id
                        ? { ...x, repost_count: res?.counts?.repost_count, viewer: { ...(x.viewer ?? {}), reposted: res?.active } }
                        : x;
                    if (tab === 'bookmarks') setBookmarks((p) => p.map(update));
                    else if (tab === 'media') setMedia((p) => p.map(update));
                    else setPosts((p) => p.map(update));
                  }
                } catch {
                  // ignore
                }
              }}
              onBookmark={async () => {
                try {
                  if (tab === 'replies') {
                    const res: any = await apiClient.discourseToggleReplyInteraction(token, item.id, 'bookmark', world);
                    setReplies((p) =>
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
                  } else {
                    const res: any = await apiClient.discourseToggleInteraction(token, item.id, 'bookmark', world);
                    if (tab === 'bookmarks' && !res?.active) {
                      setBookmarks((p) => p.filter((x: any) => x.id !== item.id));
                      return;
                    }
                    const update = (x: any) =>
                      x.id === item.id
                        ? {
                            ...x,
                            bookmark_count: res?.counts?.bookmark_count,
                            viewer: { ...(x.viewer ?? {}), bookmarked: res?.active },
                          }
                        : x;
                    if (tab === 'bookmarks') setBookmarks((p) => p.map(update));
                    else if (tab === 'media') setMedia((p) => p.map(update));
                    else setPosts((p) => p.map(update));
                  }
                } catch {
                  // ignore
                }
              }}
              onShare={async () => {
                try {
                  await Share.share({ message: postUrl(tab === 'replies' ? item.entry_id : item.id) });
                } catch {
                  // ignore
                }
              }}
            />
          )}
        />
      )}
      <WhyThisSheet open={whyOpen} onClose={() => setWhyOpen(false)} why={whyItems} algo={whyAlgo} />
      <ScsExplainerSheet open={scsOpen} onClose={() => setScsOpen(false)} scs={profile?.scs ?? null} />
      <GenerationExplainerSheet open={genOpen} onClose={() => setGenOpen(false)} generation={profile?.generation ?? null} />
    </Screen>
  );
};

export default Profile;

