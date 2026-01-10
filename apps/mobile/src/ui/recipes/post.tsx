import React, { useMemo } from 'react';
import { Image, Pressable } from 'react-native';
import { XStack, YStack, useThemeName } from 'tamagui';
import { AppText, Avatar, Pill, CredBadge } from '../primitives';
import { MessageCircle, Repeat2, Heart, Share, Bookmark } from '@tamagui/lucide-icons';
import { HAIRLINE } from '../primitives/style';

type Props = {
  id: string;
  displayName?: string;
  handle?: string;
  avatarUrl?: string | null;
  generation?: string | null;
  body: string;
  topic?: string | null;
  scs?: number | null;
  aiAssisted?: boolean;
  media?: any[];
  quote?: any | null;
  ts?: string;
  onPress?: () => void;
  onReply?: () => void;
  onRepost?: () => void;
  onLike?: () => void;
  onBookmark?: () => void;
  onShare?: () => void;
  onScsPress?: () => void;
  onGenerationPress?: (generation: string | null) => void;
  onTopicPress?: (topic: string) => void;
  onMentionPress?: (handle: string) => void;
  liked?: boolean;
  reposted?: boolean;
  bookmarked?: boolean;
  replyCount?: number;
  repostCount?: number;
  likeCount?: number;
  why?: { label: string }[] | string[] | null;
  onWhyPress?: () => void;
};

type Span =
  | { type: 'text'; text: string }
  | { type: 'mention'; text: string; handle: string }
  | { type: 'topic'; text: string; topic: string };

function parseSpans(input: string): Span[] {
  // Very lightweight parser: detects @handle and #topic tokens separated by whitespace/punctuation.
  const spans: Span[] = [];
  const re = /([@#][a-zA-Z0-9_]{2,32})/g;
  let last = 0;
  for (;;) {
    const m = re.exec(input);
    if (!m) break;
    const start = m.index;
    const tok = m[0];
    if (start > last) spans.push({ type: 'text', text: input.slice(last, start) });
    if (tok.startsWith('@')) spans.push({ type: 'mention', text: tok, handle: tok.slice(1) });
    else spans.push({ type: 'topic', text: tok, topic: tok.slice(1) });
    last = start + tok.length;
  }
  if (last < input.length) spans.push({ type: 'text', text: input.slice(last) });
  return spans;
}

function Action({
  icon,
  label,
  active,
  count,
  onPress,
}: {
  icon: React.ComponentType<any>;
  label: string;
  active?: boolean;
  count?: number;
  onPress?: () => void;
}) {
  const Icon = icon;
  const themeName = useThemeName();
  const isDark = String(themeName).includes('dark');
  const color = active ? (isDark ? '#E5E7EB' : '#0B0B0F') : isDark ? '#9CA3AF' : '#6B7280';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingVertical: 10,
        paddingHorizontal: 10,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Icon size="$1.5" color={color} />
      {typeof count === 'number' ? (
        <AppText variant="caption" color="$gray10">
          {count}
        </AppText>
      ) : null}
    </Pressable>
  );
}

export function PostRow({
  id,
  displayName,
  handle,
  avatarUrl,
  generation,
  body,
  topic,
  scs,
  aiAssisted,
  media,
  quote,
  ts,
  onPress,
  onReply,
  onRepost,
  onLike,
  onBookmark,
  onShare,
  onScsPress,
  onGenerationPress,
  onTopicPress,
  onMentionPress,
  liked,
  reposted,
  bookmarked,
  replyCount,
  repostCount,
  likeCount,
  why,
  onWhyPress,
}: Props) {
  const themeName = useThemeName();
  const isDark = String(themeName).includes('dark');
  const spans = useMemo(() => parseSpans(body ?? ''), [body]);
  const whyText = useMemo(() => {
    if (!why) return null;
    if (Array.isArray(why) && why.length > 0) {
      const first: any = why[0] as any;
      if (typeof first === 'string') return first;
      if (typeof first?.label === 'string') return first.label;
    }
    return null;
  }, [why]);
  return (
    <XStack
      paddingHorizontal="$3"
      paddingVertical="$3"
      gap="$3"
      backgroundColor="$backgroundStrong"
      borderBottomWidth={1}
      borderColor={isDark ? 'rgba(229,231,235,0.10)' : HAIRLINE}
      onPress={onPress}
      pressStyle={onPress ? { opacity: 0.7 } : undefined}
    >
      <Pressable
        accessibilityRole={generation ? 'button' : undefined}
        accessibilityLabel={generation ? `Generation: ${generation}` : undefined}
        accessibilityHint={generation ? 'Opens an explanation' : undefined}
        onPress={generation ? () => onGenerationPress?.(generation ?? null) : undefined}
        style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}
      >
        <Avatar name={displayName ?? handle} uri={avatarUrl ?? null} generation={generation ?? null} size={40} />
      </Pressable>
      <YStack flex={1} gap="$2">
        <XStack alignItems="center" gap="$2" flexWrap="wrap">
          <AppText variant="body" fontWeight="700">
            {displayName ?? 'Unknown'}
          </AppText>
          {handle ? <AppText variant="meta">@{handle}</AppText> : null}
          {typeof scs === 'number' ? (
            <CredBadge scs={scs} onPress={onScsPress} dark={isDark} accessibilityLabel="Credibility status badge" />
          ) : null}
          {ts ? <AppText variant="meta">· {ts}</AppText> : null}
          {generation ? <AppText variant="meta">· {generation}</AppText> : null}
          {typeof scs === 'number' ? (
            <AppText variant="meta" onPress={onScsPress} pressStyle={onScsPress ? { opacity: 0.7 } : undefined}>
              · SCS {scs}
            </AppText>
          ) : null}
        </XStack>
        <AppText variant="body">
          {spans.map((s, idx) => {
            if (s.type === 'text') return <React.Fragment key={idx}>{s.text}</React.Fragment>;
            if (s.type === 'mention') {
              return (
                <AppText
                  // nested text is fine; Tamagui Text renders to RN <Text/>
                  key={idx}
                  variant="body"
                  color={isDark ? '#E5E7EB' : '#0B0B0F'}
                  fontWeight="700"
                  onPress={onMentionPress ? () => onMentionPress(s.handle) : undefined}
                >
                  {s.text}
                </AppText>
              );
            }
            return (
              <AppText
                key={idx}
                variant="body"
                color={isDark ? '#E5E7EB' : '#0B0B0F'}
                fontWeight="700"
                onPress={onTopicPress ? () => onTopicPress(s.topic) : undefined}
              >
                {s.text}
              </AppText>
            );
          })}
        </AppText>
        {aiAssisted ? (
          <AppText variant="caption" color="$gray10">
            AI-assisted
          </AppText>
        ) : null}
        {whyText ? (
          <Pressable
            accessibilityRole={onWhyPress ? 'button' : undefined}
            accessibilityLabel="Why you saw this"
            accessibilityHint={onWhyPress ? 'Opens an explanation' : undefined}
            onPress={onWhyPress}
            style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
          >
            <AppText variant="caption" color="$gray10">
              Why you saw this: {whyText}
            </AppText>
          </Pressable>
        ) : null}
        {topic ? (
          <XStack>
            <Pill label={`#${topic}`} onPress={onTopicPress ? () => onTopicPress(topic) : undefined} />
          </XStack>
        ) : null}
        {media?.length ? (
          <XStack gap="$2" flexWrap="wrap">
            {media.slice(0, 4).map((src, idx) => (
              <Image
                key={idx}
                source={
                  typeof src === 'string'
                    ? { uri: src }
                    : typeof (src as any)?.url === 'string'
                      ? { uri: (src as any).url }
                      : src
                }
                style={{ width: 96, height: 96, borderRadius: 12, backgroundColor: isDark ? 'rgba(229,231,235,0.10)' : '#F3F4F6' }}
              />
            ))}
          </XStack>
        ) : null}
        {quote ? (
          <YStack
            borderWidth={1}
            borderColor={isDark ? 'rgba(229,231,235,0.16)' : '#E5E7EB'}
            borderRadius={14}
            overflow="hidden"
            backgroundColor={isDark ? 'rgba(229,231,235,0.06)' : '#F9FAFB'}
          >
            <PostRow
              id={quote.id}
              displayName={quote.author?.display_name ?? quote.author?.handle ?? 'Unknown'}
              handle={quote.author?.handle}
              avatarUrl={quote.author?.avatar_url ?? null}
              generation={quote.generation ?? quote.author?.generation ?? null}
              body={quote.body ?? ''}
              topic={quote.topic ?? null}
              scs={typeof quote.ics === 'number' ? quote.ics : null}
              aiAssisted={Boolean(quote.ai_assisted)}
              media={quote.media}
              ts={''}
              onPress={onPress ? () => onPress() : undefined}
              onScsPress={onScsPress}
              onTopicPress={onTopicPress}
              onMentionPress={onMentionPress}
            />
          </YStack>
        ) : null}
        <XStack justifyContent="space-between" paddingTop="$1" marginLeft={-10} marginRight={-10}>
          <Action icon={MessageCircle} label="Reply" count={replyCount} onPress={onReply} />
          <Action icon={Repeat2} label="Repost" active={reposted} count={repostCount} onPress={onRepost} />
          <Action icon={Heart} label="Like" active={liked} count={likeCount} onPress={onLike} />
          <Action icon={Bookmark} label="Bookmark" active={bookmarked} onPress={onBookmark} />
          <Action icon={Share} label="Share" onPress={onShare} />
        </XStack>
      </YStack>
    </XStack>
  );
}


