import React, { useEffect, useMemo, useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Screen, AppText, AppButton, FormField, Select, Sheet, Toggle, Card } from '../../ui';
import { AssumptionType } from '@platform/shared';
import { apiClient } from '../../api/client';
import { postsStore } from '../../storage/posts';
import { useWorld } from '../../providers/world';
import { XStack, YStack, useThemeName } from 'tamagui';
import { launchImageLibrary } from 'react-native-image-picker';
import RNFS from 'react-native-fs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const MAX_LEN = 500;
const MAX_MEDIA = 4;

const ComposeEntry = ({ token, route }: any) => {
  const navigation = useNavigation<any>();
  const world = useWorld();
  const insets = useSafeAreaInsets();
  const themeName = useThemeName();
  const isDark = String(themeName).includes('dark');
  const quoteId = route?.params?.quoteId as string | undefined;
  const [assumption, setAssumption] = useState<AssumptionType>(AssumptionType.LivedExperience);
  const [content, setContent] = useState('');
  const [topic, setTopic] = useState('');
  const [aiAssisted, setAiAssisted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [showDiscard, setShowDiscard] = useState(false);
  const [showDissolved, setShowDissolved] = useState(false);
  const [lastSubmitAt, setLastSubmitAt] = useState<number | null>(null);
  const [media, setMedia] = useState<any[]>([]);
  const [mediaPickerOpen, setMediaPickerOpen] = useState(false);
  const [mediaUrlDraft, setMediaUrlDraft] = useState('');
  const [uploadingMedia, setUploadingMedia] = useState(false);

  const mediaItems = useMemo(() => {
    return (media ?? [])
      .map((m: any) => (typeof m === 'string' ? { url: m, type: 'image' } : { url: m?.url ?? '', type: m?.type ?? 'image' }))
      .filter((m: any) => Boolean(m.url));
  }, [media]);

  useEffect(() => {
    if (content || topic) {
      const t = setTimeout(() => setSavedAt(new Date()), 500);
      return () => clearTimeout(t);
    }
    return;
  }, [content, topic]);

  const valid = content.trim().length > 0 && content.length <= MAX_LEN;

  const submit = async () => {
    if (!valid) {
      setError('Content required and must be within limit.');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const resp = await apiClient.submitEntry(
        token,
        assumption,
        content,
        topic || undefined,
        aiAssisted,
        mediaItems,
        quoteId,
        world,
      );
      setContent('');
      setTopic('');
      setAiAssisted(false);
      setMedia([]);
      setLastSubmitAt(Date.now());
      const id = resp?.id ?? resp?.entry?.id ?? `local_${Date.now()}`;
      if (token === 'dev-session') {
        // Store locally so parity features like delete/media show up even offline.
        await postsStore.add({
          id,
          body: content,
          topic: topic || null,
          created_at: new Date().toISOString(),
          author: { handle: 'matt', display_name: 'Matt (Dev)', avatar_url: require('../../../../public/profile_avatar.png') },
          ai_assisted: aiAssisted,
          media,
          updatedAt: Date.now(),
        });
      }
      navigation.navigate('ContentDetail' as never, { id } as never);
    } catch (e: any) {
      const msg = e?.message ?? 'Submission failed. Retry.';
      if (msg === 'gathering_ended') {
        // The world dissolved while you were composing; discard and return.
        setShowDissolved(true);
        setError(null);
        return;
      }
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const cancel = () => {
    if (content || topic) {
      setShowDiscard(true);
    } else {
      navigation.goBack();
    }
  };

  const confirmDiscard = () => {
    setContent('');
    setTopic('');
    setError(null);
    setShowDiscard(false);
    navigation.goBack();
  };

  return (
    <Screen scroll={false} safeTop>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            {
              paddingBottom: 88 + Math.max(0, insets.bottom),
            },
          ]}
          keyboardShouldPersistTaps="handled"
        >
          <YStack gap="$3">
            <Card bordered>
              <YStack gap="$3">
                <Select
                  label="Assumption"
                  value={assumption}
                  onChange={(val) => setAssumption(val as AssumptionType)}
                  options={(Object.values(AssumptionType) as unknown as string[]).map((type) => ({ label: String(type), value: type }))}
                />
                <FormField value={topic} onChangeText={setTopic} placeholder="Topic (optional)" accessibilityLabel="Topic" />
                <FormField
                  value={content}
                  onChangeText={(txt: string) => {
                    setContent(txt);
                    if (txt.length > MAX_LEN) setError('Over character limit.');
                    else setError(null);
                  }}
                  placeholder="What’s your take?"
                  multiline
                  numberOfLines={6}
                  accessibilityLabel="Entry"
                />
                <XStack alignItems="center" justifyContent="space-between">
                  <AppText variant="caption" color="$gray10">
                    {content.length}/{MAX_LEN} {content.length > MAX_LEN ? '(over limit)' : ''}
                  </AppText>
                  {savedAt ? (
                    <AppText variant="caption" color="$gray10">
                      Saved {savedAt.toLocaleTimeString()}
                    </AppText>
                  ) : null}
                </XStack>
              </YStack>
            </Card>

            <Card bordered>
              <YStack gap="$3">
                <XStack alignItems="center" justifyContent="space-between">
                  <AppText variant="body" fontWeight="800">
                    Media
                  </AppText>
                  <AppButton tone="secondary" onPress={() => setMediaPickerOpen(true)}>
                    Add
                  </AppButton>
                </XStack>
                {mediaItems.length ? (
                  <XStack gap="$2" flexWrap="wrap">
                    {mediaItems.map((m: any, idx: number) => (
                      <YStack key={`${m.url}-${idx}`} gap="$1" alignItems="center">
                        <Image
                          source={{ uri: m.url }}
                          style={{ width: 84, height: 84, borderRadius: 14, backgroundColor: '#F3F4F6' }}
                        />
                        <AppButton
                          tone="ghost"
                          onPress={() => {
                            setMedia((prev) => prev.filter((_: any, i: number) => i !== idx));
                          }}
                        >
                          Remove
                        </AppButton>
                      </YStack>
                    ))}
                  </XStack>
                ) : (
                  <AppText variant="caption" color="$gray10">
                    No media attached
                  </AppText>
                )}
              </YStack>
            </Card>

            <Card bordered>
              <YStack gap="$2">
                <Toggle label="Assisted by AI" value={aiAssisted} onValueChange={setAiAssisted} />
                <AppText variant="caption" color="$gray10">
                  If enabled, your post is labeled as AI-assisted. If disabled and AI use is detected, credibility is reduced.
                </AppText>
              </YStack>
            </Card>

            {lastSubmitAt && Date.now() - lastSubmitAt < 30000 ? (
              <AppText variant="caption" color="$gray10">
                Take a moment. Thoughtful posts earn more Social Credit over time.
              </AppText>
            ) : null}

            {error ? (
              <AppText variant="caption" color="$red10">
                {error}
              </AppText>
            ) : null}
          </YStack>
        </ScrollView>

        {/* Fixed bottom actions (no more “hanging” button) */}
        <View
          style={[
            styles.bottomBar,
            {
              paddingBottom: Math.max(10, insets.bottom),
              backgroundColor: isDark ? '#0B0B0F' : '#F6F7F9',
              borderTopColor: isDark ? 'rgba(229,231,235,0.14)' : '#E5E7EB',
            },
          ]}
        >
          <YStack gap="$2">
            <AppButton tone="primary" onPress={submit} loading={submitting} disabled={!valid || submitting}>
              Post
            </AppButton>
            <AppButton tone="ghost" onPress={cancel} disabled={submitting}>
              Cancel
            </AppButton>
          </YStack>
        </View>
      </KeyboardAvoidingView>
      <Sheet isOpen={showDiscard} onClose={() => setShowDiscard(false)}>
        <AppText variant="title">Discard draft?</AppText>
        <AppText variant="body">You will lose your changes.</AppText>
        <AppButton tone="destructive" onPress={confirmDiscard}>
          Discard
        </AppButton>
        <AppButton tone="ghost" onPress={() => setShowDiscard(false)}>
          Keep editing
        </AppButton>
      </Sheet>
      <Sheet isOpen={mediaPickerOpen} onClose={() => setMediaPickerOpen(false)}>
        <AppText variant="title">Add media</AppText>
        <AppText variant="caption">
          App Store-ready device picking is next; for QA today we generate upload URLs from the backend and attach the returned public URLs.
        </AppText>
        <AppButton
          tone="primary"
          disabled={uploadingMedia || mediaItems.length >= MAX_MEDIA}
          loading={uploadingMedia}
          onPress={async () => {
            if (!token || token === 'dev-session') {
              // dev-session: just attach a placeholder image
              const seed = Date.now();
              setMedia((p) => [...p, { url: `https://picsum.photos/seed/${seed}/800/800`, type: 'image' }]);
              setMediaPickerOpen(false);
              return;
            }
            try {
              setUploadingMedia(true);
              const plan: any = await apiClient.mediaUploadUrl(token, 'image');
              const uploadId = plan?.upload?.id as string | undefined;
              const picked = await launchImageLibrary({
                mediaType: 'photo',
                selectionLimit: 1,
                includeBase64: true,
                quality: 0.9,
              });
              if (picked.didCancel) return;
              const asset = picked.assets?.[0];
              if (!asset) return;
              const base64 =
                asset.base64 ??
                (asset.uri ? await RNFS.readFile(asset.uri.replace('file://', ''), 'base64') : null);
              if (!base64) throw new Error('no_image_data');
              const contentType = asset.type ?? 'image/jpeg';
              const filename = asset.fileName ?? `image_${Date.now()}.jpg`;
              const resp: any = await apiClient.mediaUpload(token, {
                id: uploadId,
                filename,
                content_type: contentType,
                data_base64: base64,
              });
              try {
                if (uploadId) await apiClient.mediaFinalize(token, uploadId);
              } catch {
                // finalize is best-effort; local provider is effectively immediate
              }
              const url = resp?.media?.public_url as string | undefined;
              if (url) setMedia((p) => [...p, { url, type: 'image' }]);
            } catch (e: any) {
              setError(e?.message === 'gathering_ended' ? 'The Gathering dissolved.' : 'Failed to attach media.');
            } finally {
              setUploadingMedia(false);
              setMediaPickerOpen(false);
            }
          }}
        >
          Pick from library
        </AppButton>
        <FormField
          label="Attach by URL"
          value={mediaUrlDraft}
          onChangeText={setMediaUrlDraft}
          placeholder="https://…"
          autoCapitalize="none"
        />
        <AppButton
          tone="primary"
          onPress={async () => {
            try {
              if (mediaItems.length >= MAX_MEDIA) return;
              if (token && token !== 'dev-session') {
                const resp: any = await apiClient.mediaUploadUrl(token, 'image');
                const url = resp?.upload?.public_url;
                if (url) setMedia((p) => [...p, { url, type: 'image' }]);
              } else {
                const seed = Date.now();
                setMedia((p) => [...p, { url: `https://picsum.photos/seed/${seed}/800/800`, type: 'image' }]);
              }
            } finally {
              setMediaPickerOpen(false);
            }
          }}
          disabled={mediaItems.length >= MAX_MEDIA}
        >
          Add image (backend upload-url)
        </AppButton>
        <AppButton
          tone="secondary"
          disabled={!mediaUrlDraft.trim() || mediaItems.length >= MAX_MEDIA}
          onPress={() => {
            const u = mediaUrlDraft.trim();
            if (!u) return;
            setMedia((p) => [...p, { url: u, type: 'image' }]);
            setMediaUrlDraft('');
            setMediaPickerOpen(false);
          }}
        >
          Attach URL
        </AppButton>
        <AppButton
          tone="ghost"
          onPress={() => {
            setMedia([]);
            setMediaUrlDraft('');
            setMediaPickerOpen(false);
          }}
        >
          Remove media
        </AppButton>
      </Sheet>
      <Sheet
        isOpen={showDissolved}
        onClose={() => {
          setShowDissolved(false);
        }}
      >
        <AppText variant="title">The Gathering dissolved</AppText>
        <AppText variant="body">
          Your draft can’t be posted now. This world doesn’t archive—try again when The Gathering opens next.
        </AppText>
        <AppButton
          tone="primary"
          onPress={() => {
            setShowDissolved(false);
            setContent('');
            setTopic('');
            setMedia([]);
            navigation.goBack();
          }}
        >
          Return
        </AppButton>
      </Sheet>
    </Screen>
  );
};

export default ComposeEntry;

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: 14,
    paddingTop: 12,
  },
  bottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 14,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});

