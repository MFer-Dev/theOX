import React from 'react';
import { Screen, Section, AppText, AppButton } from '../../ui';

type Props = {
  onRetry: () => void;
};

export default function OfflineDegraded({ onRetry }: Props) {
  return (
    <Screen>
      <Section title="Offline">
        <AppText variant="body">You are offline. Some features are unavailable.</AppText>
        <AppText variant="caption">Reconnect to continue.</AppText>
      </Section>
      <Section>
        <AppButton tone="primary" onPress={onRetry}>
          Retry Connection
        </AppButton>
      </Section>
    </Screen>
  );
}

