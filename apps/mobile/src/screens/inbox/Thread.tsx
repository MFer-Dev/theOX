import React, { useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Screen, Section, AppText, FormField, AppButton, List, Card, Sheet } from '../../ui';
import { messagingStore, type Message, type Thread } from '../../storage/messaging';
import { relationshipsStore } from '../../storage/relationships';
import { apiClient } from '../../api/client';
import { useWorld } from '../../providers/world';
import { Input, useTheme, XStack, YStack } from 'tamagui';

export default function InboxThreadScreen({ route, navigation, token }: any) {
  const world = useWorld();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const threadId = route?.params?.id as string;
  const [thread, setThread] = useState<Thread | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [muted, setMuted] = useState(false);
  const [dissolvedOpen, setDissolvedOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    let th: any = null;
    if (token && token !== 'dev-session') {
      const t = await apiClient.dmThread(token, threadId);
      const m = await apiClient.dmMessages(token, threadId);
      th = t?.thread ?? null;
      setThread(th);
      setMessages(m?.messages ?? []);
      await apiClient.dmMarkRead(token, threadId);
    } else {
      const t = await messagingStore.getThread(threadId);
      const m = await messagingStore.getMessages(threadId);
      th = t;
      setThread(th);
      setMessages(m);
      await messagingStore.markRead(threadId);
    }
    if (th?.handle) {
      const r = await relationshipsStore.get(th.handle);
      setMuted(Boolean(r.muted));
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  const header = useMemo(
    () => (
      <Section title={thread ? thread.name : 'Message'} subtitle={thread ? `@${thread.handle}` : undefined}>
        <AppButton tone="ghost" onPress={() => setActionsOpen(true)}>
          Actions
        </AppButton>
      </Section>
    ),
    [thread],
  );

  return (
    <Screen scroll={false}>
      <List
        style={{ flex: 1 }}
        data={messages}
        keyExtractor={(m) => m.id}
        ListHeaderComponent={header}
        // This screen has its own fixed composer; don't reserve tab/FAB room here.
        contentContainerStyle={{ paddingBottom: 16 }}
        renderItem={({ item }) => (
          <Card
            backgroundColor={item.from === 'me' ? '$backgroundStrong' : 'transparent'}
            borderColor="$borderColor"
            alignSelf={item.from === 'me' ? 'flex-end' : 'flex-start'}
            maxWidth="88%"
          >
            <AppText variant="body">{item.body}</AppText>
            <AppText variant="caption">{item.ts}</AppText>
          </Card>
        )}
      />

      {thread?.isRequest ? (
        <Card>
          <AppText variant="caption">Message request</AppText>
          <AppButton
            tone="primary"
            onPress={async () => {
              if (token && token !== 'dev-session') await apiClient.dmAccept(token, threadId);
              else await messagingStore.acceptRequest(threadId);
              await load();
            }}
          >
            Accept
          </AppButton>
          <AppButton
            tone="destructive"
            onPress={async () => {
              if (token && token !== 'dev-session') await apiClient.dmDecline(token, threadId);
              else await messagingStore.declineRequest(threadId);
              navigation.goBack();
            }}
          >
            Decline
          </AppButton>
        </Card>
      ) : null}

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <YStack
          paddingHorizontal="$3"
          paddingTop="$2"
          paddingBottom={Math.max(12, insets.bottom + 10)}
          backgroundColor="$background"
        >
          <Card bordered padding="$3">
            <XStack alignItems="center" gap="$2">
              <Input
                flex={1}
                value={draft}
                onChangeText={setDraft}
                placeholder="New message"
                accessibilityLabel="New message"
                borderWidth={1}
                borderColor="$borderColor"
                borderRadius={14}
                backgroundColor="$backgroundStrong"
                paddingHorizontal="$3"
                height={52}
                color={(theme as any)?.color?.get?.() ?? '#E5E7EB'}
                placeholderTextColor={(theme as any)?.gray10?.get?.() ?? '#9CA3AF'}
                selectionColor={(theme as any)?.accent?.get?.() ?? '#E5E7EB'}
              />
              <AppButton
                tone="primary"
                disabled={!draft.trim() || loading}
                width={96}
                height={52}
                onPress={async () => {
                  const body = draft.trim();
                  setDraft('');
                  if (token && token !== 'dev-session') {
                    try {
                      await apiClient.dmSend(token, threadId, body);
                    } catch (e: any) {
                      if (e?.message === 'gathering_ended') {
                        setDissolvedOpen(true);
                        return;
                      }
                      // ignore
                    }
                  } else await messagingStore.send(threadId, body);
                  await load();
                }}
              >
                Send
              </AppButton>
            </XStack>
          </Card>
        </YStack>
      </KeyboardAvoidingView>

      <Sheet isOpen={actionsOpen} onClose={() => setActionsOpen(false)}>
        <Section title="Conversation actions" subtitle="Safety controls are calm and predictable.">
          <AppButton
            tone="secondary"
            onPress={async () => {
              if (!thread?.handle) return;
              const next = await relationshipsStore.toggleMute(thread.handle);
              setMuted(Boolean(next.muted));
              setActionsOpen(false);
            }}
          >
            {muted ? 'Unmute' : 'Mute'}
          </AppButton>
          <AppButton
            tone="destructive"
            onPress={() => {
              // Route into safety report flow using the handle as subject.
              if (thread?.handle) navigation.navigate('Report', { userId: thread.handle });
              setActionsOpen(false);
            }}
          >
            Report
          </AppButton>
          <AppButton
            tone="ghost"
            onPress={async () => {
              // Local parity: decline removes request thread; for non-requests, remove thread as “block”.
              await messagingStore.declineRequest(threadId);
              setActionsOpen(false);
              navigation.goBack();
            }}
          >
            Block (local)
          </AppButton>
        </Section>
      </Sheet>

      <Sheet isOpen={dissolvedOpen} onClose={() => setDissolvedOpen(false)}>
        <Section title="The Gathering dissolved">
          <AppText variant="body">
            This message can’t be sent now. The Gathering doesn’t archive—try again when it opens next.
          </AppText>
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


