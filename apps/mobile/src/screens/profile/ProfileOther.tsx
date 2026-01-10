import React, { useEffect, useState, useCallback } from 'react';
import { Screen, Section, AppText, AppButton, List, Avatar, PostRow, Card } from '../../ui';
import { EmptyState, ErrorState, LoadingState, BlockedState } from '../../ui/recipes/states';
import { apiClient } from '../../api/client';
import { relationshipsStore } from '../../storage/relationships';
import { XStack, YStack } from 'tamagui';
import { WhyThisSheet } from '../ranking/WhyThisSheet';

type Props = {
  route: any;
  navigation: any;
  token: string;
};

export default function ProfileOther({ route, navigation, token }: Props) {
  const userId = route?.params?.userId;
  const [profile, setProfile] = useState<any>(null);
  const [posts, setPosts] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [rel, setRel] = useState<{ followed?: boolean; muted?: boolean }>({});
  const [whyOpen, setWhyOpen] = useState(false);
  const [whyItems, setWhyItems] = useState<any[] | null>(null);
  const [whyAlgo, setWhyAlgo] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      const resp = await apiClient.publicProfile?.(token, userId);
      setProfile(resp?.user ?? null);
      setBlocked(Boolean(resp?.blocked));
      const feed = await apiClient.userPublicFeed?.(token, userId);
      setPosts(feed?.feed ?? []);
      const r = await relationshipsStore.get(userId);
      setRel({ followed: r.followed, muted: r.muted });
    } catch {
      setError('Failed to load profile.');
    } finally {
      setLoading(false);
    }
  }, [token, userId]);

  useEffect(() => {
    load();
  }, [load]);

  const renderPosts = () => {
    if (loading) return <LoadingState lines={4} />;
    if (error) return <ErrorState body={error} actionLabel="Retry" onAction={load} />;
    if (blocked) return <BlockedState title="User blocked" body="You cannot view this profile." />;
    if (!posts.length) return <EmptyState title="No posts" body="Nothing to show." />;
    return (
      <List
        data={posts}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <PostRow
            id={item.id}
            displayName={profile?.display_name ?? profile?.handle}
            handle={profile?.handle}
            avatarUrl={profile?.avatar_url ?? null}
            body={item.body}
            why={item?.rank?.why ?? null}
            onWhyPress={() => {
              setWhyItems(item?.rank?.why ?? null);
              setWhyAlgo(item?.rank?.algo ?? null);
              setWhyOpen(true);
            }}
            onPress={() => navigation?.navigate?.('ContentDetail', { id: item.id })}
          />
        )}
      />
    );
  };

  return (
    <Screen>
      <Section title="Profile">
        {loading && !profile ? (
          <LoadingState lines={2} />
        ) : profile ? (
          <>
            <XStack gap="$3" alignItems="center">
              <Avatar name={profile.display_name ?? profile.handle} uri={profile.avatar_url ?? null} />
              <YStack gap="$1" flex={1}>
                <AppText variant="title">{profile.display_name ?? profile.handle}</AppText>
                <AppText variant="meta">@{profile.handle}</AppText>
                {profile.bio ? <AppText variant="body">{profile.bio}</AppText> : null}
              </YStack>
            </XStack>
          </>
        ) : error ? (
          <ErrorState body={error} actionLabel="Retry" onAction={load} />
        ) : (
          <EmptyState title="Profile unavailable" body="Unable to load profile." />
        )}
      </Section>
      <Section title="Actions">
        <Card>
          <XStack gap="$2">
            <AppButton
              tone={rel.followed ? 'secondary' : 'primary'}
              onPress={async () => {
                if (!userId) return;
                const next = await relationshipsStore.toggleFollow(userId);
                setRel({ ...rel, followed: next.followed });
              }}
            >
              {rel.followed ? 'Following' : 'Follow'}
            </AppButton>
            <AppButton
              tone="ghost"
              onPress={async () => {
                if (!userId) return;
                const next = await relationshipsStore.toggleMute(userId);
                setRel({ ...rel, muted: next.muted });
              }}
            >
              {rel.muted ? 'Muted' : 'Mute'}
            </AppButton>
          </XStack>
          <AppText variant="caption">Follow and mute are local parity stubs (backend wiring next).</AppText>
        </Card>
        <AppButton tone="destructive" onPress={() => navigation?.navigate?.('BlockUser', { userId })}>
          Block User
        </AppButton>
        <AppButton tone="ghost" onPress={() => navigation?.navigate?.('Report', { userId })}>
          Report User
        </AppButton>
      </Section>
      <Section title="Posts">{renderPosts()}</Section>
      <WhyThisSheet open={whyOpen} onClose={() => setWhyOpen(false)} why={whyItems} algo={whyAlgo} />
    </Screen>
  );
}

