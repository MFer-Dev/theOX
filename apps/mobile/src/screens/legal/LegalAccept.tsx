import React, { useEffect, useState } from 'react';
import { Screen, Section, AppText, AppButton, Card } from '../../ui';
import { apiClient } from '../../api/client';

type Props = {
  token: string;
  onAccepted: () => void;
  navigation: any;
};

export default function LegalAccept({ token, onAccepted, navigation }: Props) {
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState<{ terms?: string; privacy?: string } | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    apiClient
      .policyStatus(token)
      .then((s: any) => {
        if (!alive) return;
        setCurrent({ terms: s?.current?.terms, privacy: s?.current?.privacy });
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [token]);

  const accept = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await apiClient.policyAccept(token);
      onAccepted();
    } catch (e: any) {
      setError(e?.message ?? 'Unable to accept. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen>
      <Section title="Terms & Privacy" subtitle="Transparent by design.">
        <Card bordered>
          <AppText variant="body">
            By continuing, you agree to our Terms of Service and Privacy Policy. We don’t sell personal data; we build intelligence from aggregated signals.
          </AppText>
          {current?.terms || current?.privacy ? (
            <AppText variant="caption" color="$gray10">
              Current versions: {current?.terms ?? 'terms'} · {current?.privacy ?? 'privacy'}
            </AppText>
          ) : null}
        </Card>

        <AppButton tone="secondary" onPress={() => navigation.navigate('Terms')}>
          Read Terms
        </AppButton>
        <AppButton tone="secondary" onPress={() => navigation.navigate('Privacy')}>
          Read Privacy
        </AppButton>
        <AppButton tone="ghost" onPress={() => navigation.navigate('Licenses')}>
          Licenses
        </AppButton>

        {error ? (
          <AppText variant="caption" color="$red10">
            {error}
          </AppText>
        ) : null}

        <AppButton tone="primary" onPress={accept} disabled={loading || submitting} loading={submitting}>
          I agree & continue
        </AppButton>
      </Section>
    </Screen>
  );
}


