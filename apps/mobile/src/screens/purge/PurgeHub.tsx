import React, { useEffect, useState } from 'react';
import { Screen, Section, AppText, Card } from '../../ui';
import { ErrorState, LoadingState } from '../../ui/recipes/states';
import { apiClient } from '../../api/client';
import { EVENT_NAME, EVENT_SHORT, formatNextGathering, formatGatheringLive } from '../../config/lexicon';

const PurgeHub = () => {
  const [status, setStatus] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setError(null);
    setLoading(true);
    try {
      const s = await apiClient.purgeStatus();
      setStatus(s);
    } catch (err) {
      setError('Failed to load Gathering status.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <Screen>
      <Section title={EVENT_NAME} subtitle={`${EVENT_NAME} opens all Trybes on a schedule. Outside ${EVENT_SHORT}, you’re scoped to your Trybe.`}>
        {loading ? <LoadingState lines={2} /> : null}
        {error ? <ErrorState body={error} actionLabel="Retry" onAction={load} /> : null}
        {status ? (
          <Card>
            <AppText variant="meta">Status</AppText>
            <AppText variant="body">Active: {status.active ? 'Yes' : 'No'}</AppText>
            {status.active && status.ends_at ? <AppText variant="caption">{formatGatheringLive(status.ends_at)}</AppText> : null}
            {!status.active && status.starts_at ? <AppText variant="caption">{formatNextGathering(status.starts_at)}</AppText> : null}
            <AppText variant="caption">Starts: {status.starts_at ?? 'N/A'}</AppText>
            <AppText variant="caption">Ends: {status.ends_at ?? 'N/A'}</AppText>
          </Card>
        ) : null}
      </Section>
    </Screen>
  );
};

export default PurgeHub;

