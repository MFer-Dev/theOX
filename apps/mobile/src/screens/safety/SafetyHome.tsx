import React, { useEffect, useState } from 'react';
import { Screen, Section, AppText, AppButton, FormField, Divider, Card } from '../../ui';
import { ErrorState, LoadingState } from '../../ui/recipes/states';
import { apiClient } from '../../api/client';

type Props = {
  token: string;
};

const SafetyHome = ({ token }: Props) => {
  const [status, setStatus] = useState<any>(null);
  const [appealMessage, setAppealMessage] = useState('');
  const [appealId, setAppealId] = useState('');
  const [appealStatus, setAppealStatus] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const loadStatus = async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await apiClient.safetyStatus(token);
      setStatus(res);
    } catch (err) {
      setError('Unable to load safety status.');
    } finally {
      setLoading(false);
    }
  };

  const submitAppeal = async () => {
    setError(null);
    try {
      const res = await apiClient.safetyAppealSubmit(token, { message: appealMessage || 'Appeal request' });
      setAppealId(res?.appeal_id ?? '');
      setAppealMessage('');
      await loadStatus();
    } catch (err) {
      setError('Appeal submit failed.');
    }
  };

  const fetchAppeal = async () => {
    setError(null);
    try {
      const res = await apiClient.safetyAppealStatus(token, appealId);
      setAppealStatus(res);
    } catch (err) {
      setError('Appeal status failed.');
    }
  };

  useEffect(() => {
    loadStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Screen>
      <Section title="Safety" subtitle="Restrictions, frictions, reports, and appeals.">
        {loading ? <LoadingState lines={2} /> : null}
        {error ? <ErrorState body={error} actionLabel="Retry" onAction={loadStatus} /> : null}
        {!loading && !error ? (
          <>
            <AppText variant="meta">My status</AppText>
            <Card>
              <AppText variant="caption" color="$gray10">
                Restrictions
              </AppText>
              <AppText variant="body">
                {Array.isArray(status?.restrictions) && status.restrictions.length
                  ? status.restrictions.map((r: any) => `${r.reason ?? 'restriction'} (until ${r.expires_at ?? 'unknown'})`).join('\n')
                  : 'None'}
              </AppText>
              <Divider />
              <AppText variant="caption" color="$gray10">
                Frictions
              </AppText>
              <AppText variant="body">
                {Array.isArray(status?.frictions) && status.frictions.length
                  ? status.frictions.map((f: any) => `${f.friction_type ?? 'friction'} (until ${f.expires_at ?? 'unknown'})`).join('\n')
                  : 'None'}
              </AppText>
            </Card>
            <AppButton tone="secondary" onPress={loadStatus}>
              Refresh status
            </AppButton>
          </>
        ) : null}
      </Section>

      <Section title="Submit appeal" subtitle="Free text. Humans review.">
        <FormField
          label="Message"
          value={appealMessage}
          onChangeText={setAppealMessage}
          placeholder="Explain your appeal (free text)"
          multiline
          numberOfLines={4}
        />
        <AppButton tone="primary" onPress={submitAppeal} disabled={!appealMessage.trim()}>
          Submit appeal
        </AppButton>
      </Section>

      <Section title="Report content" subtitle="Report a post or profile for review.">
        <AppText variant="caption" color="$gray10">
          Reporting is for safety issues (spam, harassment, impersonation). It is not a dislike button.
        </AppText>
      </Section>

      <Section title="Appeal status">
        <FormField label="Appeal ID" value={appealId} onChangeText={setAppealId} placeholder="Appeal ID" />
        <AppButton tone="secondary" onPress={fetchAppeal} disabled={!appealId.trim()}>
          Fetch status
        </AppButton>
        {appealStatus ? (
          <>
            <Divider />
            <AppText variant="body">ID: {appealStatus.appeal?.id ?? ''}</AppText>
            <AppText variant="body">Status: {appealStatus.appeal?.status ?? ''}</AppText>
            <AppText variant="caption">History: {JSON.stringify(appealStatus.history ?? [])}</AppText>
          </>
        ) : null}
      </Section>

      <Section title="Transparency">
        <AppText variant="caption">
          Safety frictions explain why actions are limited; appeals are reviewed by humans; flags alone do not equal verdict.
        </AppText>
      </Section>
    </Screen>
  );
};

export default SafetyHome;

