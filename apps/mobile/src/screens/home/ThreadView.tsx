import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import { Screen, Section, AppText, AppButton, FormField, List, Card, PostRow, Sheet } from '../../ui';
import { EmptyState, ErrorState, LoadingState, BlockedState } from '../../ui/recipes/states';
import { EndorseIntent } from '@platform/shared';
import { apiClient } from '../../api/client';
import BlockedActionSheet from '../../components/BlockedActionSheet';
import NotesDrawer from '../notes/NotesDrawer';
import ReportSheet from '../safety/ReportSheet';
import { EVENT_NAME, GROUP_SINGULAR, formatTrybeLabel } from '../../config/lexicon';
import { Share } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { postUrl } from '../../config/links';
import { XStack, useThemeName } from 'tamagui';
import { useWorld } from '../../providers/world';
import { ScsExplainerSheet } from '../cred/ScsExplainerSheet';
import { GenerationExplainerSheet } from '../cred/GenerationExplainerSheet';
import { WhyThisSheet } from '../ranking/WhyThisSheet';

const ThreadView = ({ route, navigation, token, userGen, purgeActive }: any) => {
  const world = useWorld();
  const themeName = useThemeName();
  const isDark = String(themeName).includes('dark');
  const entryId = route?.params?.id;
  const focusReply = Boolean(route?.params?.focusReply);
  const [thread, setThread] = useState<any>(null);
  const [replies, setReplies] = useState<any[]>([]);
  const [replyBody, setReplyBody] = useState('');
  const [endorseIntent, setEndorseIntent] = useState<EndorseIntent>(EndorseIntent.Clear);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [blockedOpen, setBlockedOpen] = useState(false);
  const [blockedReason, setBlockedReason] = useState('');
  const [showNotes, setShowNotes] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [showEndorse, setShowEndorse] = useState(false);
  const [frictionDetail, setFrictionDetail] = useState<string | null>(null);
  const [locked, setLocked] = useState<string | null>(null);
  const [scsOpen, setScsOpen] = useState(false);
  const [genOpen, setGenOpen] = useState(false);
  const [genTarget, setGenTarget] = useState<string | null>(null);
  const [whyOpen, setWhyOpen] = useState(false);
  const [whyItems, setWhyItems] = useState<any[] | null>(null);
  const [whyAlgo, setWhyAlgo] = useState<string | null>(null);
  const replyRef = useRef<any>(null);
  const insets = useSafeAreaInsets();

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const resp = await apiClient.thread?.(token, entryId);
      setThread(resp?.entry ?? null);
      setReplies(resp?.replies ?? []);
      setLocked(resp?.locked ? 'Thread is locked' : null);
      setError(null);
    } catch (err) {
      setError('Failed to load thread.');
    }
    setLoading(false);
  }, [entryId, token]);

  const refresh = async () => {
    try {
      setRefreshing(true);
      const resp = await apiClient.thread?.(token, entryId);
      setThread(resp?.entry ?? null);
      setReplies(resp?.replies ?? []);
      setLocked(resp?.locked ? 'Thread is locked' : null);
      setError(null);
    } catch (err) {
      setError('Failed to load thread.');
    }
    setRefreshing(false);
  };

  useEffect(() => {
    if (entryId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryId]);

  useEffect(() => {
    if (!focusReply) return;
    const t = setTimeout(() => replyRef.current?.focus?.(), 350);
    return () => clearTimeout(t);
  }, [focusReply]);

  const submitReply = async () => {
    if (locked) return;
    if (thread && userGen && thread.generation !== userGen && !purgeActive) {
      setBlockedReason(`Cross-${GROUP_SINGULAR.toLowerCase()} replies are blocked while ${EVENT_NAME} is inactive.`);
      try {
        const s = await apiClient.safetyStatus(token);
        setFrictionDetail(JSON.stringify(s?.frictions ?? s?.restrictions ?? {}));
      } catch (e) {
        setFrictionDetail(null);
      }
      setBlockedOpen(true);
      return;
    }
    try {
      const tempId = `temp-${Date.now()}`;
      const optimistic = { id: tempId, body: replyBody, generation: userGen, status: 'pending' };
      setReplies((r) => [optimistic, ...r]);
      setReplyBody('');
      await apiClient.replies(token, entryId, replyBody, world);
      setReplies((r) => r.map((it) => (it.id === tempId ? { ...it, status: 'confirmed' } : it)));
      await load();
    } catch (err: any) {
      setReplies((r) => r.map((it) => (it.status === 'pending' ? { ...it, status: 'failed' } : it)));
      if (err?.message === 'gathering_ended') {
        setBlockedReason('The Gathering dissolved while you were replying. Your draft was discarded.');
        setBlockedOpen(true);
        return;
      }
      setError('Reply blocked (gen gating or rate limit).');
    }
  };

  const endorse = async () => {
    if (thread && userGen && thread.generation !== userGen && !purgeActive) {
      setBlockedReason(`Cross-${GROUP_SINGULAR.toLowerCase()} endorsements are blocked while ${EVENT_NAME} is inactive.`);
      try {
        const s = await apiClient.safetyStatus(token);
        setFrictionDetail(JSON.stringify(s?.frictions ?? s?.restrictions ?? {}));
      } catch (e) {
        setFrictionDetail(null);
      }
      setBlockedOpen(true);
      return;
    }
    try {
      await apiClient.endorse(token, entryId, endorseIntent);
      load();
    } catch (err) {
      setError('Endorse failed.');
    }
  };

  const upvote = async () => {
    try {
      await apiClient.upvote(token, entryId);
      load();
    } catch (err) {
      setError('Upvote failed.');
    }
  };

  const header = useMemo(() => {
    if (loading) return <LoadingState lines={3} />;
    if (error) return <ErrorState body={error} onAction={load} actionLabel="Retry" />;
    if (locked) return <BlockedState title="Thread locked" body={locked} />;
    // When missing, rely on the native stack back affordance (avoid duplicate in-screen “Back”).
    if (!thread) return <EmptyState title="Thread missing" body="Entry not found or removed." />;
    return (
      <>
        <Card padding="$0" bordered>
          <PostRow
            id={thread.id ?? entryId}
            displayName={thread.author?.display_name ?? 'Unknown'}
            handle={thread.author?.handle}
            avatarUrl={thread.author?.avatar_url ?? null}
	            generation={thread.generation ?? thread.author?.generation ?? null}
            body={thread.body}
            topic={thread.topic ?? null}
            scs={typeof thread.ics === 'number' ? thread.ics : null}
            aiAssisted={Boolean(thread.ai_assisted)}
            quote={thread.quote ?? null}
            why={thread?.rank?.why ?? null}
            onWhyPress={() => {
              setWhyItems(thread?.rank?.why ?? null);
              setWhyAlgo(thread?.rank?.algo ?? null);
              setWhyOpen(true);
            }}
	            onScsPress={() => setScsOpen(true)}
	            onGenerationPress={(g) => {
	              setGenTarget(g ?? null);
	              setGenOpen(true);
	            }}
            onReply={() => replyRef.current?.focus?.()}
            onTopicPress={(t) => navigation.navigate('TopicTimeline' as never, { topic: t, world: purgeActive ? 'gathering' : 'tribal', token } as never)}
            onMentionPress={(h) => navigation.navigate('ProfileOther' as never, { userId: h } as never)}
            liked={Boolean(thread?.viewer?.liked)}
            reposted={Boolean(thread?.viewer?.reposted)}
            bookmarked={Boolean(thread?.viewer?.bookmarked)}
            likeCount={thread?.like_count}
            repostCount={thread?.repost_count}
            replyCount={thread?.reply_count}
            onLike={async () => {
              const id = thread.id ?? entryId;
              try {
                const res: any = await apiClient.discourseToggleInteraction(token, id, 'like', world);
                setThread((p: any) =>
                  p ? { ...p, like_count: res?.counts?.like_count, viewer: { ...(p.viewer ?? {}), liked: res?.active } } : p,
                );
              } catch {
                // ignore
              }
            }}
            onRepost={async () => {
              const id = thread.id ?? entryId;
              // Quote is first-class; repost is a toggle.
              try {
                const res: any = await apiClient.discourseToggleInteraction(token, id, 'repost', world);
                setThread((p: any) =>
                  p ? { ...p, repost_count: res?.counts?.repost_count, viewer: { ...(p.viewer ?? {}), reposted: res?.active } } : p,
                );
              } catch {
                // ignore
              }
            }}
            onBookmark={async () => {
              const id = thread.id ?? entryId;
              try {
                const res: any = await apiClient.discourseToggleInteraction(token, id, 'bookmark', world);
                setThread((p: any) =>
                  p ? { ...p, bookmark_count: res?.counts?.bookmark_count, viewer: { ...(p.viewer ?? {}), bookmarked: res?.active } } : p,
                );
              } catch {
                // ignore
              }
            }}
            onShare={async () => {
              try {
                await Share.share({ message: postUrl(thread.id ?? entryId) });
              } catch {
                // ignore
              }
            }}
          />
          <AppText padding="$3" variant="caption">
            Trybe: {formatTrybeLabel(thread.generation)} • Assumption: {thread.assumption_type}
          </AppText>
        </Card>
        <XStack gap="$2">
          <AppButton tone="ghost" onPress={upvote}>
            Upvote
          </AppButton>
          <AppButton tone="ghost" onPress={() => setShowNotes(true)}>
            Notes
          </AppButton>
          <AppButton tone="ghost" onPress={() => setShowEndorse(true)}>
            Endorse
          </AppButton>
          <AppButton tone="ghost" onPress={() => setShowReport(true)}>
            Report
          </AppButton>
        </XStack>
        <AppText variant="caption">Replies</AppText>
      </>
    );
  }, [entryId, error, load, loading, locked, navigation, thread, upvote]);

  const composerHeight = 86 + Math.max(0, insets.bottom - 4);
  const canReply = Boolean(thread) && !locked && !loading && !error;

  return (
    <Screen scroll={false}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <List
          style={{ flex: 1 }}
          data={replies}
          keyExtractor={(item) => item.id}
          onRefresh={refresh}
          refreshing={refreshing}
          ListHeaderComponent={header}
          contentContainerStyle={{ paddingBottom: canReply ? composerHeight + 12 : 24 }}
          renderItem={({ item }) => {
            const trimmed = (item.body ?? '').trim();
            const isLowSignal = trimmed.length > 0 && trimmed.length <= 4;
            return (
              <Card padding="$0" bordered opacity={isLowSignal ? 0.72 : 1}>
                <XStack>
                  <XStack width={18} alignItems="stretch" justifyContent="center">
                    <XStack width={2} marginLeft={8} backgroundColor={isDark ? 'rgba(229,231,235,0.10)' : 'rgba(17, 24, 39, 0.08)'} />
                  </XStack>
                  <XStack flex={1}>
                    <PostRow
                      id={item.id}
                      displayName={item.author?.display_name ?? 'Reply'}
                      handle={item.author?.handle}
                      avatarUrl={item.author?.avatar_url ?? null}
                      body={item.body}
                      topic={item.topic ?? null}
                      scs={typeof item.ics === 'number' ? item.ics : null}
                      aiAssisted={Boolean(item.ai_assisted)}
                      why={item?.rank?.why ?? null}
                      onWhyPress={() => {
                        setWhyItems(item?.rank?.why ?? null);
                        setWhyAlgo(item?.rank?.algo ?? null);
                        setWhyOpen(true);
                      }}
                      ts={''}
                      onReply={() => replyRef.current?.focus?.()}
                      liked={Boolean(item?.viewer?.liked)}
                      reposted={Boolean(item?.viewer?.reposted)}
                      bookmarked={Boolean(item?.viewer?.bookmarked)}
                      likeCount={item?.like_count}
                      repostCount={item?.repost_count}
                      onLike={async () => {
                        try {
                          const res: any = await apiClient.discourseToggleReplyInteraction(token, item.id, 'like', world);
                          setReplies((p) =>
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
                        try {
                          const res: any = await apiClient.discourseToggleReplyInteraction(token, item.id, 'repost', world);
                          setReplies((p) =>
                            p.map((x: any) =>
                              x.id === item.id
                                ? { ...x, repost_count: res?.counts?.repost_count, viewer: { ...(x.viewer ?? {}), reposted: res?.active } }
                                : x,
                            ),
                          );
                        } catch {
                          // ignore
                        }
                      }}
                      onBookmark={async () => {
                        try {
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
                        } catch {
                          // ignore
                        }
                      }}
                      onShare={async () => {
                        try {
                          await Share.share({ message: postUrl(item.entry_id ?? item.id) });
                        } catch {
                          // ignore
                        }
                      }}
                    />
                  </XStack>
                </XStack>
	              <AppText padding="$3" variant="caption" color="$gray10">
                  Trybe: {formatTrybeLabel(item.generation)}
                  {item.status === 'pending' ? ' · Sending…' : ''}
                  {item.status === 'failed' ? ' · Send failed' : ''}
                </AppText>
              </Card>
            );
          }}
        />

	      {canReply ? (
	        <View
	          style={[
	            styles.composer,
	            {
	              paddingBottom: Math.max(8, insets.bottom),
	              backgroundColor: isDark ? '#0B0B0F' : '#F6F7F9',
	              borderTopColor: isDark ? 'rgba(229,231,235,0.14)' : '#E5E7EB',
	            },
	          ]}
	        >
	          <Card bordered>
	            <FormField inputRef={replyRef} value={replyBody} onChangeText={setReplyBody} placeholder="Reply…" />
	            <AppButton tone="primary" onPress={submitReply} disabled={!replyBody.trim()}>
	              Reply
	            </AppButton>
	          </Card>
	        </View>
	      ) : null}
      </KeyboardAvoidingView>

      <BlockedActionSheet
        isOpen={blockedOpen}
        onClose={() => setBlockedOpen(false)}
        reason={frictionDetail ? `${blockedReason}\n${frictionDetail}` : blockedReason}
        purgeActive={purgeActive}
      />
      <NotesDrawer isOpen={showNotes} onClose={() => setShowNotes(false)} token={token} contentId={entryId} />
      <ReportSheet isOpen={showReport} onClose={() => setShowReport(false)} token={token} contentId={entryId} />
      <Sheet isOpen={showEndorse} onClose={() => setShowEndorse(false)}>
        <Section title="Endorse" subtitle="Signal intent without gamification.">
          <List
            data={Object.values(EndorseIntent)}
            keyExtractor={(item) => item}
            renderItem={({ item }) => (
              <AppButton
                tone={endorseIntent === item ? 'primary' : 'ghost'}
                onPress={() => setEndorseIntent(item as EndorseIntent)}
              >
                {item}
              </AppButton>
            )}
          />
          <AppButton tone="secondary" onPress={endorse}>
            Endorse with intent
          </AppButton>
        </Section>
      </Sheet>
      <WhyThisSheet open={whyOpen} onClose={() => setWhyOpen(false)} why={whyItems} algo={whyAlgo} />
	      <ScsExplainerSheet open={scsOpen} onClose={() => setScsOpen(false)} scs={typeof thread?.ics === 'number' ? thread.ics : null} />
	      <GenerationExplainerSheet open={genOpen} onClose={() => setGenOpen(false)} generation={genTarget} />
    </Screen>
  );
};

export default ThreadView;

const styles = StyleSheet.create({
  composer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 12,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});

