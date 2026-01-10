import React from 'react';
import { ActivityIndicator } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { Screen, AppText, BrandMark, BrandWordmark } from '../../ui';
import { YStack } from 'tamagui';

// Splash / Boot: minimal, static branding + optional subtle indicator
export default function SplashScreen() {
  const appear = useSharedValue(0);
  const lift = useSharedValue(0);
  const glow = useSharedValue(0);

  React.useEffect(() => {
    // Premium: slower, noticeable sequence.
    appear.value = withTiming(1, { duration: 900, easing: Easing.out(Easing.cubic) });
    lift.value = withDelay(120, withTiming(1, { duration: 1100, easing: Easing.out(Easing.cubic) }));
    glow.value = withDelay(250, withTiming(1, { duration: 700, easing: Easing.out(Easing.quad) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const markStyle = useAnimatedStyle(() => ({
    opacity: appear.value,
    transform: [
      { translateY: (1 - appear.value) * 14 - lift.value * 6 },
      { scale: 0.86 + appear.value * 0.14 },
    ],
  }));

  const wordmarkStyle = useAnimatedStyle(() => ({
    opacity: appear.value,
    transform: [{ translateY: (1 - appear.value) * 10 - lift.value * 4 }],
  }));

  return (
    <Screen scroll={false} pad={false} safeTop>
      <YStack flex={1} backgroundColor="#000" justifyContent="center" alignItems="center" gap="$4" padding="$6">
        <Animated.View style={markStyle}>
          <BrandMark size={112} color="#fff" />
        </Animated.View>
        <Animated.View style={wordmarkStyle}>
          <BrandWordmark width={170} height={22} color="#fff" />
        </Animated.View>
        <AppText variant="caption" accessibilityLabel="App is launching" color="rgba(255,255,255,0.70)">
          Loading…
        </AppText>
        <ActivityIndicator color="rgba(255,255,255,0.7)" />
      </YStack>
    </Screen>
  );
}

