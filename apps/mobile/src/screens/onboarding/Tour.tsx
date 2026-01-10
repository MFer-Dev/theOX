import React, { useMemo, useRef, useState } from 'react';
import { Dimensions, Pressable, ScrollView } from 'react-native';
import { Screen, AppText, AppButton, Card } from '../../ui';
import { GROUP_SINGULAR, EVENT_NAME } from '../../config/lexicon';
import { XStack, YStack } from 'tamagui';
import { X } from '@tamagui/lucide-icons';

const OnbTour = ({ navigation }: any) => {
  const w = Dimensions.get('window').width;
  const scrollRef = useRef<ScrollView>(null);
  const [idx, setIdx] = useState(0);
  const slides = useMemo(
    () => [
      {
        title: 'Tribal World',
        body: `Your ${GROUP_SINGULAR.toLowerCase()} is your default context: calm, stable, scoped.`,
      },
      {
        title: EVENT_NAME,
        body: 'A time‑bound parallel world where perspectives collide across Trybes.',
      },
      {
        title: 'Credibility',
        body: 'Signals reward thoughtful contribution. Status is legible, not addictive.',
      },
      {
        title: 'No archives in The Gathering',
        body: 'When it dissolves, drafts are discarded and late writes are rejected.',
      },
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
          onPress={() => navigation.navigate('Notif')}
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
        {slides.map((s, i) => (
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
        <AppButton tone="primary" onPress={() => (idx === slides.length - 1 ? navigation.navigate('Notif') : go(idx + 1))}>
          {idx === slides.length - 1 ? 'Finish' : 'Next'}
        </AppButton>
      </XStack>
    </Screen>
  );
};

export default OnbTour;

