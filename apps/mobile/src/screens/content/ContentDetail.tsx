import React, { useEffect, useState, useCallback } from 'react';
import { Image, ScrollView, Share } from 'react-native';
import { Screen, Section, AppText, AppButton, Sheet, Card } from '../../ui';
import { EmptyState, ErrorState, LoadingState, BlockedState } from '../../ui/recipes/states';
import { apiClient } from '../../api/client';
import { postsStore } from '../../storage/posts';

type Props = {
  route: any;
  navigation: any;
  token: string;
};

export default function ContentDetail({ route, navigation, token }: Props) {
  const contentId = route?.params?.id;
  const [content, setContent] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [removed, setRemoved] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [meId, setMeId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!contentId) return;
    setLoading(true);
    setError(null);
    setBlocked(null);
    setRemoved(false);
    try {
      const local = await postsStore.get(contentId);
      if (local && !local.deleted) {
        setContent({
          id: local.id,
          title: 'Post',
          body: local.body,
          author: local.author?.display_name ?? local.author?.handle ?? 'You',
          timestamp: local.created_at,
          metadata: local.topic ? `Topic: ${local.topic}` : undefined,
          media: local.media ?? [],
          _local: true,
        });
        return;
      }
      const resp = await apiClient.contentDetail?.(token, contentId);
      if (resp?.blocked) {
        setBlocked(resp?.reason ?? 'Blocked content');
        setContent(null);
      } else if (resp?.removed) {
        setRemoved(true);
        setContent(null);
      } else {
        // Normalize to always have media + ai_assisted when present.
        setContent({
          ...resp,
          media: resp?.media ?? resp?.entry?.media ?? [],
          ai_assisted: Boolean(resp?.ai_assisted ?? resp?.entry?.ai_assisted),
          quote: resp?.quote ?? resp?.entry?.quote ?? null,
          entry: resp?.entry,
        });
      }
    } catch (e: any) {
      setError('Unable to load content.');
    } finally {
      setLoading(false);
    }
  }, [contentId, token]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!token || token === 'dev-session') return;
    apiClient
      .me?.(token)
      .then((resp: any) => setMeId(resp?.user?.id ?? null))
      .catch(() => setMeId(null));
  }, [token]);

  const renderBody = () => {
    if (loading) return <LoadingState lines={5} />;
    if (blocked) return <BlockedState title="Content blocked" body={blocked} />;
    if (removed) return <EmptyState title="Content removed" body="This item is no longer available." actionLabel="Back to feed" onAction={() => navigation.goBack()} />;
    if (error) return <ErrorState body={error} actionLabel="Retry" onAction={load} />;
    if (!content) return <EmptyState title="No content" body="Nothing to show." actionLabel="Back" onAction={() => navigation.goBack()} />;

    return (
      <ScrollView>
        <Section title={content.title ?? 'Content'}>
          <AppText variant="body">{content.body}</AppText>
          {content.media?.length ? (
            <Card>
              {content.media.slice(0, 6).map((src: any, idx: number) => (
                <Image
                  key={idx}
                  source={
                    typeof src === 'string'
                      ? { uri: src }
                      : typeof src?.url === 'string'
                        ? { uri: src.url }
                        : src
                  }
                  style={{ width: '100%', height: 220, borderRadius: 12, marginBottom: 12, backgroundColor: '#f3f4f6' }}
                  resizeMode="cover"
                />
              ))}
            </Card>
          ) : null}
          {content.ai_assisted ? (
            <AppText variant="caption" color="$gray10">
              AI-assisted
            </AppText>
          ) : null}
          <AppText variant="caption">
            {content.author ?? 'Unknown'} · {content.timestamp ?? ''}
          </AppText>
          {content.metadata ? <AppText variant="caption">{content.metadata}</AppText> : null}
        </Section>
        <Section title="Actions">
          <AppButton tone="primary" onPress={() => navigation.navigate('ThreadDetail', { id: contentId })}>
            Open thread
          </AppButton>
          <AppButton tone="secondary" onPress={() => setActionsOpen(true)}>
            More
          </AppButton>
        </Section>
      </ScrollView>
    );
  };

  return (
    <Screen>
      {renderBody()}
      <Sheet isOpen={actionsOpen} onClose={() => setActionsOpen(false)}>
        <AppButton tone="secondary" onPress={() => navigation.navigate('Report', { id: contentId })}>
          Report
        </AppButton>
        {content?._local ? (
          <AppButton
            tone="destructive"
            onPress={async () => {
              if (!contentId) return;
              await postsStore.markDeleted(contentId);
              setActionsOpen(false);
              navigation.goBack();
            }}
          >
            Delete
          </AppButton>
        ) : meId && content?.entry?.user_id && content.entry.user_id === meId ? (
          <AppButton
            tone="destructive"
            onPress={async () => {
              if (!contentId) return;
              await apiClient.discourseDeleteEntry(token, contentId);
              setActionsOpen(false);
              navigation.goBack();
            }}
          >
            Delete
          </AppButton>
        ) : null}
        <AppButton
          tone="ghost"
          onPress={async () => {
            try {
              if (!contentId) return;
              const url = `https://trybl.app/p/${encodeURIComponent(contentId)}`;
              await Share.share({ message: url });
            } catch {
              // ignore
            }
          }}
        >
          Copy link
        </AppButton>
        <AppButton
          tone="ghost"
          onPress={async () => {
            try {
              await Share.share({ message: content?.body ?? '' });
            } catch {
              // ignore
            }
          }}
        >
          Share
        </AppButton>
      </Sheet>
    </Screen>
  );
}

