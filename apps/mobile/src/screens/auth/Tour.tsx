import React, { useMemo, useRef, useState } from 'react';
import { Dimensions, Pressable, ScrollView } from 'react-native';
import { Screen, AppText, AppButton, Card } from '../../ui';
import { GROUP_SINGULAR, EVENT_NAME } from '../../config/lexicon';
import { XStack, YStack } from 'tamagui';
import { X } from '@tamagui/lucide-icons';

export default function AuthTour({ navigation }: any) {
  const w = Dimensions.get('window').width;
  const scrollRef = useRef<ScrollView>(null);
  const [idx, setIdx] = useState(0);
  const slides = useMemo(
    () => [
      { title: 'Welcome to Trybl', body: 'A premium social app designed for perspective, not performance.' },
      { title: 'Tribal World', body: `Most of your experience is scoped to your ${GROUP_SINGULAR.toLowerCase()} for context and continuity.` },
      { title: EVENT_NAME, body: 'A time‑bound parallel world where all Trybes mix. It’s urgent, temporary, and cross‑Trybe by design.' },
      { title: 'Credibility signals', body: 'Generation ring + status badge are tappable. They help you read context without gamification.' },
    ],
    [],
  );

  const go = (next: number) => {
    const n = Math.max(0, Math.min(slides.length - 1, next));
    setIdx(n);
    scrollRef.current?.scrollTo?.({ x: n * w, animated: true });
  };

  return (
    <Screen safeTop>
      <XStack justifyContent="flex-end">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={() => navigation.goBack()}
          hitSlop={10}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, padding: 8 })}
        >
          <X color="#6B7280" />
        </Pressable>
      </XStack>

      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => {
          const x = e.nativeEvent.contentOffset.x;
          const n = Math.round(x / w);
          setIdx(n);
        }}
      >
        {slides.map((s) => (
          <YStack key={s.title} width={w} paddingHorizontal="$3" paddingTop="$2" paddingBottom="$3">
            <Card bordered>
              <AppText variant="title">{s.title}</AppText>
              <AppText variant="body">{s.body}</AppText>
            </Card>
          </YStack>
        ))}
      </ScrollView>

      <XStack justifyContent="space-between" alignItems="center">
        <AppButton tone="ghost" onPress={() => go(idx - 1)} disabled={idx === 0}>
          Back
        </AppButton>
        <AppText variant="caption" color="$gray10">
          {idx + 1} / {slides.length}
        </AppText>
        <AppButton tone="primary" onPress={() => (idx === slides.length - 1 ? navigation.goBack() : go(idx + 1))}>
          {idx === slides.length - 1 ? 'Done' : 'Next'}
        </AppButton>
      </XStack>
    </Screen>
  );
}


