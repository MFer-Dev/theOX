import React, { useEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useReducedMotion } from 'react-native-reanimated';
import { AppText, BrandMark } from '../../ui';

const OFFRAMP_WINDOW_MS = 5 * 60_000; // start warning 5 min before end
const DISSOLVE_WINDOW_MS = 15_000; // last 15s: full-screen dissolve

const fmt = (ms: number) => {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

type Props = {
  gatheringActive: boolean;
  remainingMs: number | null;
};

export function GatheringOfframpOverlay({ gatheringActive, remainingMs }: Props) {
  const reducedMotion = useReducedMotion();
  const show = gatheringActive && typeof remainingMs === 'number' && remainingMs <= OFFRAMP_WINDOW_MS;
  const dissolve = show && typeof remainingMs === 'number' && remainingMs <= DISSOLVE_WINDOW_MS;

  const opacity = useSharedValue(0);

  useEffect(() => {
    if (!show) {
      opacity.value = withTiming(0, { duration: 180, easing: Easing.out(Easing.cubic) });
      return;
    }
    if (reducedMotion) {
      opacity.value = 1;
      return;
    }
    opacity.value = withTiming(1, { duration: 220, easing: Easing.out(Easing.cubic) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show]);

  useEffect(() => {
    if (!dissolve) return;
    if (reducedMotion) return;
    // When dissolving, push opacity to full quickly.
    opacity.value = withTiming(1, { duration: 120, easing: Easing.out(Easing.cubic) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dissolve]);

  const overlayStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  const copy = useMemo(() => {
    if (!show || typeof remainingMs !== 'number') return null;
    if (remainingMs <= 0) return { headline: 'Dissolving…', sub: 'Everything in The Gathering is ending now.' };
    if (remainingMs <= DISSOLVE_WINDOW_MS) {
      return { headline: `Dissolves in ${fmt(remainingMs)}`, sub: 'Anything you’re doing is lost until the next opening.' };
    }
    return { headline: `Ends in ${fmt(remainingMs)}`, sub: 'This world dissolves. No archive.' };
  }, [remainingMs, show]);

  if (!show || !copy) return null;

  if (dissolve) {
    return (
      <Animated.View pointerEvents="auto" style={[styles.fullOverlay, overlayStyle]}>
        <View style={styles.fullContent}>
          <BrandMark size={72} color="#E5E7EB" />
          <AppText variant="title" color="#F9FAFB" textAlign="center">
            {copy.headline}
          </AppText>
          <AppText variant="caption" color="#9CA3AF" textAlign="center">
            {copy.sub}
          </AppText>
        </View>
      </Animated.View>
    );
  }

  return (
    <Animated.View pointerEvents="none" style={[styles.bannerWrap, overlayStyle]}>
      <View style={styles.banner}>
        <AppText variant="caption" color="#E5E7EB">
          {copy.headline} · {copy.sub}
        </AppText>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bannerWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  banner: {
    marginTop: 10,
    marginHorizontal: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(17,24,39,0.72)',
    borderWidth: 1,
    borderColor: 'rgba(229,231,235,0.10)',
  },
  fullOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#070A12',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullContent: {
    paddingHorizontal: 24,
    alignItems: 'center',
    gap: 10,
  },
});


