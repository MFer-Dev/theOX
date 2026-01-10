import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useReducedMotion } from 'react-native-reanimated';
import { AppText, BrandMark } from '../../ui';

type Props = {
  visible: boolean;
  onDone: () => void;
};

export function GatheringEnterOverlay({ visible, onDone }: Props) {
  const reducedMotion = useReducedMotion();
  const opacity = useSharedValue(0);
  const scale = useSharedValue(0.985);

  useEffect(() => {
    if (!visible) return;
    if (reducedMotion) {
      onDone();
      return;
    }
    opacity.value = 0;
    scale.value = 0.985;
    opacity.value = withTiming(1, { duration: 240, easing: Easing.out(Easing.cubic) });
    scale.value = withTiming(1, { duration: 700, easing: Easing.out(Easing.cubic) });
    const id = setTimeout(() => {
      opacity.value = withTiming(0, { duration: 260, easing: Easing.in(Easing.cubic) }, (finished) => {
        if (finished) runOnJS(onDone)();
      });
    }, 900);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const overlayStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  const contentStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  if (!visible) return null;

  return (
    <Animated.View pointerEvents="auto" style={[styles.overlay, overlayStyle]}>
      <Animated.View style={[styles.content, contentStyle]}>
        <BrandMark size={72} color="#E5E7EB" />
        <AppText variant="title" color="#F9FAFB" textAlign="center">
          The Gathering is live.
        </AppText>
        <AppText variant="caption" color="#9CA3AF" textAlign="center">
          One parallel day. All Trybes. No boundaries.
        </AppText>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#0B0B0F',
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    paddingHorizontal: 24,
    alignItems: 'center',
    gap: 10,
  },
});


