import React, { useEffect, useState } from 'react';
import { Screen, Section, AppText, LoadingState, ErrorState } from '../../ui';
import { apiClient } from '../../api/client';

type Props = {
  onReady: () => void;
  onMaintenance: (message?: string) => void;
  onFatal: () => void;
};

export default function SystemCheck({ onReady, onMaintenance, onFatal }: Props) {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const run = async () => {
      try {
        const health: any = await apiClient.health?.();
        if (health?.maintenance) {
          onMaintenance(health?.message);
          return;
        }
        onReady();
      } catch (_e) {
        setError('Unable to start. Check connection.');
        onFatal();
      }
    };
    run();
  }, [onReady, onMaintenance, onFatal]);

  return (
    <Screen>
      <Section title="System Check">
        {error ? (
          <ErrorState body={error} />
        ) : (
          <>
            <AppText variant="body">Checking connection…</AppText>
            <LoadingState lines={2} />
          </>
        )}
      </Section>
    </Screen>
  );
}

