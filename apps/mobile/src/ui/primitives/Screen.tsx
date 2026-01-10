import React from 'react';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScrollView, StyleSheet } from 'react-native';
import { YStack, useTheme } from 'tamagui';
import { useWorld } from '../../providers/world';

type Props = {
  scroll?: boolean;
  pad?: boolean;
  safeTop?: boolean;
  children: React.ReactNode;
};

export const Screen = ({ scroll = true, pad = true, safeTop = false, children }: Props) => {
  const world = useWorld();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const bg = (theme as any)?.background?.get?.() ?? '#000';
  const gap: any = world === 'gathering' ? '$2' : '$3';
  const scrollPadH = pad ? (world === 'gathering' ? 10 : 14) : 0;
  const scrollPadTop = pad ? (world === 'gathering' ? 10 : 12) : 0;
  // Avoid double-padding at bottom (tab bar + List padding already handle it for list screens).
  // For scroll screens, include safe-area insets in content padding instead of SafeAreaView edges.
  const scrollPadBottom = (pad ? (world === 'gathering' ? 26 : 22) : 0) + Math.max(0, insets.bottom);
  const edges: any = safeTop ? ['top', 'left', 'right'] : ['left', 'right'];
  if (scroll) {
    return (
      <SafeAreaView style={[styles.root, { backgroundColor: bg }]} edges={edges}>
        <YStack flex={1} backgroundColor="$background">
          <ScrollView
            contentContainerStyle={[
              styles.scrollContent,
              { paddingHorizontal: scrollPadH, paddingTop: scrollPadTop, paddingBottom: scrollPadBottom },
            ]}
            showsVerticalScrollIndicator
          >
            <YStack gap={gap}>{children}</YStack>
          </ScrollView>
        </YStack>
      </SafeAreaView>
    );
  }
  return (
    <SafeAreaView style={[styles.root, { backgroundColor: bg }]} edges={edges}>
      <YStack flex={1} gap={gap} padding={pad ? '$3' : 0} backgroundColor="$background">
        {children}
      </YStack>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  // Set an explicit background so we never render as a "black screen" if a child doesn't paint.
  root: { flex: 1 },
  scrollContent: { paddingHorizontal: 14, paddingTop: 12, paddingBottom: 28 },
});

