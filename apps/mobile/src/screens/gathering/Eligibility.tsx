import React, { useEffect, useState } from 'react';
import { Screen, Section, AppText, AppButton, List, Card } from '../../ui';
import { ErrorState, LoadingState } from '../../ui/recipes/states';
import { apiClient } from '../../api/client';
import { EVENT_NAME, GROUP_SINGULAR } from '../../config/lexicon';

type Eligibility = { eligible: boolean; reasons?: string[]; completed?: string[] };

type Props = {
  navigation: any;
  token: string;
  initialEligibility?: Eligibility;
};

const checklist = [
  { id: 'post', label: 'Create a post in your Trybe' },
  { id: 'reply', label: 'Reply to someone in your Trybe' },
  { id: 'react', label: 'React/endorse meaningfully' },
  { id: 'read', label: 'Spend active reading time' },
];

export default function GatheringEligibilityScreen({ navigation, token, initialEligibility }: Props) {
  const [eligibility, setEligibility] = useState<Eligibility | null>(initialEligibility ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [icsDelta, setIcsDelta] = useState<number | null>(null);
  const [icsRequired, setIcsRequired] = useState<number | null>(null);

  const load = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await apiClient.gatheringEligibility(token);
      setEligibility(res ?? { eligible: false });
      setIcsDelta(res?.ics_delta ?? null);
      setIcsRequired(res?.required_ics_delta ?? null);
    } catch {
      setError('Unable to load eligibility.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!eligibility) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const renderChecklist = () => (
    <List
      data={checklist}
      keyExtractor={(i) => i.id}
      renderItem={({ item }) => {
        const completed = eligibility?.completed?.includes(item.id);
        return (
          <Card padding="$3" bordered>
            <AppText variant="body">
              {completed ? '✅ ' : '⬜️ '}
              {item.label}
            </AppText>
          </Card>
        );
      }}
    />
  );

  const statusBlock = () => {
    if (loading) return <LoadingState lines={2} />;
    if (error) return <ErrorState body={error} actionLabel="Retry" onAction={load} />;
    if (!eligibility) return null;

    if (eligibility.eligible) {
      return (
        <>
          <AppText variant="title">You’ve earned access to {EVENT_NAME}.</AppText>
          <AppText variant="body">You can enter the global timeline during the next Gathering window.</AppText>
          {icsDelta !== null ? (
            <AppText variant="caption">
              Social Credit earned this cycle: {icsDelta} {icsRequired ? `(min ${icsRequired})` : ''}
            </AppText>
          ) : null}
          <AppButton tone="primary" onPress={() => navigation.navigate('GatheringTimeline' as never)}>
            View The Gathering
          </AppButton>
        </>
      );
    }

    return (
      <>
        <AppText variant="title">Not eligible yet</AppText>
        <AppText variant="body">Participation in your {GROUP_SINGULAR} unlocks {EVENT_NAME}.</AppText>
        {icsRequired !== null ? (
          <AppText variant="caption">
            Social Credit this cycle: {icsDelta ?? 0} / {icsRequired} (earn access through {GROUP_SINGULAR} participation)
          </AppText>
        ) : null}
        {renderChecklist()}
        {eligibility.reasons?.length ? (
          <Section title="Details">
            {eligibility.reasons.map((r, idx) => (
              <AppText key={idx} variant="body">
                • {r}
              </AppText>
            ))}
          </Section>
        ) : null}
        <AppButton tone="secondary" onPress={() => navigation.navigate('Home' as never)}>
          Go to my Trybe
        </AppButton>
      </>
    );
  };

  return (
    <Screen>
      <Section title={EVENT_NAME} subtitle="Eligibility and how to join">
        {statusBlock()}
      </Section>
    </Screen>
  );
}

