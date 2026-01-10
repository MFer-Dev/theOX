import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useReducedMotion } from 'react-native-reanimated';
import { AppText, BrandMark } from '../../ui';

type Props = {
  visible: boolean;
  onDone: () => void;
};

export function GatheringCollapseOverlay({ visible, onDone }: Props) {
  const reducedMotion = useReducedMotion();
  const opacity = useSharedValue(0);
  const scale = useSharedValue(1);
  const lift = useSharedValue(0);

  useEffect(() => {
    if (!visible) return;
    if (reducedMotion) {
      onDone();
      return;
    }
    opacity.value = withTiming(1, { duration: 220, easing: Easing.out(Easing.cubic) });
    lift.value = withTiming(-12, { duration: 420, easing: Easing.out(Easing.cubic) });
    scale.value = withTiming(
      0.12,
      { duration: 900, easing: Easing.out(Easing.cubic) },
      (finished) => {
        if (finished) runOnJS(onDone)();
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const overlayStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  const markStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: lift.value }, { scale: scale.value }],
  }));

  if (!visible) return null;

  return (
    <Animated.View pointerEvents="auto" style={[styles.overlay, overlayStyle]}>
      <View style={styles.content}>
        <Animated.View style={markStyle}>
          <BrandMark size={96} color="#E5E7EB" />
        </Animated.View>
        <AppText variant="title" color="#fff" textAlign="center">
          The Gathering has ended.
        </AppText>
        <AppText variant="caption" color="#E5E7EB" textAlign="center">
          This moment collapses and cannot be replayed.
        </AppText>
      </View>
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


