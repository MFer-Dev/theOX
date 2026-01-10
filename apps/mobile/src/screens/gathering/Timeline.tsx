import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { Screen, Section, AppText, AppButton, List, Card, FormField } from '../../ui';
import { FeedRow } from '../../ui/recipes/lists';
import { EmptyState, ErrorState, LoadingState } from '../../ui/recipes/states';
import { apiClient } from '../../api/client';
import { EVENT_NAME, formatGatheringLive, formatNextGathering, formatTrybeLabel } from '../../config/lexicon';
import { sessionStore } from '../../storage/session';
import { useReducedMotion } from 'react-native-reanimated';
import { View, StyleSheet } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

type Props = {
  navigation: any;
  token: string;
  gatheringActive: boolean;
  gatheringStartsAt?: string | null;
  gatheringEndsAt?: string | null;
  eligible: boolean;
};

export default function GatheringTimelineScreen({
  navigation,
  token,
  gatheringActive,
  gatheringStartsAt,
  gatheringEndsAt,
  eligible,
}: Props) {
  const reducedMotion = useReducedMotion();
  const [historyOptions, setHistoryOptions] = useState<{ id: string; label: string; active?: boolean }[]>([]);
  const [historyId, setHistoryId] = useState('current');
  const [trybeFilter, setTrybeFilter] = useState('');
  const [topicFilter, setTopicFilter] = useState('');
  const [feed, setFeed] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transitionVisible, setTransitionVisible] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [hasSeenTransition, setHasSeenTransition] = useState<boolean>(false);
  const [collapsePhase, setCollapsePhase] = useState<'stable' | 'destabilize' | 'collapse' | 'done'>('stable');
  const jitter = useSharedValue(0);

  const loadHistory = useCallback(async () => {
    try {
      const res = await apiClient.gatheringHistory(token);
      setHistoryOptions(res?.histories ?? []);
    } catch {
      setHistoryOptions([{ id: 'current', label: 'Current Gathering', active: gatheringActive }]);
    }
  }, [token, gatheringActive]);

  const loadFeed = useCallback(async () => {
    if (!eligible && historyId === 'current') {
      setFeed([]);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const res = await apiClient.gatheringTimeline(token, { historyId, trybe: trybeFilter || undefined, topic: topicFilter || undefined });
      setFeed(res?.feed ?? []);
    } catch {
      setError('Unable to load Gathering timeline.');
      setFeed([]);
    } finally {
      setLoading(false);
    }
  }, [eligible, historyId, token, topicFilter, trybeFilter]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    loadFeed();
  }, [loadFeed]);

  const endAtMs = useMemo(() => (gatheringEndsAt ? new Date(gatheringEndsAt).getTime() : null), [gatheringEndsAt]);
  const replayWindowEndsMs = useMemo(() => (endAtMs ? endAtMs + 24 * 60 * 60 * 1000 : null), [endAtMs]);

  const markSeen = async () => {
    if (gatheringEndsAt) {
      await sessionStore.setGatheringSeen(gatheringEndsAt);
      setHasSeenTransition(true);
    }
  };

  useEffect(() => {
    const checkSeen = async () => {
      if (gatheringEndsAt) {
        const seen = await sessionStore.getGatheringSeen(gatheringEndsAt);
        setHasSeenTransition(seen);
      }
    };
    checkSeen();
  }, [gatheringEndsAt]);

  useEffect(() => {
    if (!endAtMs) return;
    const now = Date.now();
    if (hasSeenTransition) return;
    // Case 2: return within 24h and not seen → play immediately
    if (!gatheringActive && replayWindowEndsMs && now >= endAtMs && now <= replayWindowEndsMs && !hasSeenTransition) {
      setCountdown(0);
      setTransitionVisible(true);
      setCollapsePhase('collapse');
      markSeen();
      return;
    }
    // Case 3: after 24h, nothing to do
    if (replayWindowEndsMs && now > replayWindowEndsMs) {
      return;
    }
    // Case 1: live countdown leading to end
    if (gatheringActive) {
      const tick = setInterval(() => {
        const nowTick = Date.now();
        const remainingMs = endAtMs - nowTick;
        if (remainingMs <= 0) {
          clearInterval(tick);
          setCountdown(0);
          setTransitionVisible(true);
          setCollapsePhase('collapse');
          markSeen();
        } else if (remainingMs <= 30000) {
          setTransitionVisible(true);
          setCollapsePhase('destabilize');
          setCountdown(Math.ceil(remainingMs / 1000));
        }
      }, 500);
      return () => clearInterval(tick);
    }
  }, [endAtMs, gatheringActive, replayWindowEndsMs, hasSeenTransition]);

  useEffect(() => {
    if (collapsePhase === 'destabilize' && !reducedMotion) {
      jitter.value = withTiming(3, { duration: 2000, easing: Easing.ease });
    }
    if (collapsePhase === 'collapse' && !reducedMotion) {
      jitter.value = withTiming(20, { duration: 600, easing: Easing.out(Easing.cubic) });
      const t = setTimeout(() => setCollapsePhase('done'), 700);
      return () => clearTimeout(t);
    }
    if (collapsePhase === 'collapse' && reducedMotion) {
      setCollapsePhase('done');
    }
  }, [collapsePhase, jitter, reducedMotion]);

  useEffect(() => {
    if (collapsePhase === 'done') {
      navigation.reset({ index: 0, routes: [{ name: 'Home' as never }] });
    }
  }, [collapsePhase, navigation]);

  const contentDisabled = transitionVisible && collapsePhase !== 'stable';
  const animStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateY: -jitter.value,
      },
    ],
  }));

  const renderHeaderState = () => {
    if (gatheringActive) {
      return <AppText variant="body">{formatGatheringLive(gatheringEndsAt ?? '')}</AppText>;
    }
    if (gatheringStartsAt) {
      return <AppText variant="body">{formatNextGathering(gatheringStartsAt)}</AppText>;
    }
    return <AppText variant="caption">The Gathering schedule is not yet set.</AppText>;
  };

  const renderLocked = () => (
    <Section title="Not eligible right now" subtitle="Participate in your Trybe to unlock this Gathering.">
      <AppButton tone="secondary" onPress={() => navigation.navigate('GatheringEligibility' as never)}>
        View eligibility
      </AppButton>
      <AppButton tone="ghost" onPress={() => navigation.navigate('Home' as never)}>
        Return to my Trybe
      </AppButton>
    </Section>
  );

  const renderFilters = () => (
    <Section title="Filters">
      <FormField label="Trybe" placeholder="e.g., genz" value={trybeFilter} onChangeText={setTrybeFilter} />
      <FormField label="Topic" placeholder="Topic or trend" value={topicFilter} onChangeText={setTopicFilter} />
      <AppButton tone="primary" onPress={loadFeed}>
        Apply
      </AppButton>
    </Section>
  );

  const renderHistoryPicker = () => (
    <Section title="Gathering window">
      <List
        data={historyOptions}
        keyExtractor={(i) => i.id}
        renderItem={({ item }) => (
          <Card
            padding="$3"
            bordered
            onPress={() => setHistoryId(item.id)}
            backgroundColor={historyId === item.id ? '$backgroundStrong' : undefined}
          >
            <AppText variant="body">{item.label}</AppText>
            {item.active ? <AppText variant="caption">Live</AppText> : null}
          </Card>
        )}
      />
    </Section>
  );

  const renderFeed = () => {
    if (loading) return <LoadingState lines={4} />;
    if (error) return <ErrorState body={error} actionLabel="Retry" onAction={loadFeed} />;
    if (!feed.length) return <EmptyState title="No posts yet" body="Check back during the window." actionLabel="Refresh" onAction={loadFeed} />;
    return (
      <List
        data={feed}
        keyExtractor={(item) => item.id}
        scrollEnabled={!contentDisabled}
        renderItem={({ item }) => (
          <FeedRow
            body={item.body}
            generation={formatTrybeLabel(item.generation)}
            topic={item.topic}
            assumption={item.assumption_type}
            ics={item.ics ?? item.ics_score ?? null}
            onPress={() => (!contentDisabled ? navigation.navigate('ThreadDetail', { id: item.id }) : null)}
          />
        )}
      />
    );
  };

  const renderTransitionOverlay = () => {
    if (!transitionVisible) return null;
    const message = countdown && countdown > 0 ? `The Gathering ends in ${countdown}…` : 'The Gathering has ended.';
    return (
      <View style={styles.overlay} pointerEvents="auto">
        <Animated.View style={[styles.countdownContainer, reducedMotion ? undefined : animStyle]}>
          <AppText variant="title" style={styles.countdownText}>
            {message}
          </AppText>
        </Animated.View>
      </View>
    );
  };

  return (
    <Screen>
      <Section title={EVENT_NAME} subtitle="Global cross-Trybe timeline">
        {renderHeaderState()}
      </Section>
      {renderHistoryPicker()}
      {renderFilters()}
      {!eligible && historyId === 'current' ? renderLocked() : null}
      <Section title="Timeline">
        <Animated.View style={contentDisabled ? animStyle : undefined}>{renderFeed()}</Animated.View>
      </Section>
      {!gatheringActive && historyId === 'current' ? (
        <Section title="Snapshot">
          <AppText variant="body">The timeline freezes when the window ends. Replies stay open; new posts resume next Gathering.</AppText>
        </Section>
      ) : null}
      {renderTransitionOverlay()}
    </Screen>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  countdownContainer: {
    padding: 16,
    backgroundColor: 'rgba(0,0,0,0.75)',
    borderRadius: 12,
  },
  countdownText: {
    color: 'white',
    textAlign: 'center',
  },
});

