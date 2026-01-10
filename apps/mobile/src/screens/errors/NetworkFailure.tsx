import React from 'react';
import { Screen, Section, AppText, AppButton } from '../../ui';

type Props = {
  onRetry: () => void;
};

export default function NetworkFailureScreen({ onRetry }: Props) {
  return (
    <Screen>
      <Section title="Offline">
        <AppText variant="body">You appear to be offline. Check your connection and try again.</AppText>
        <AppButton tone="primary" onPress={onRetry}>
          Retry
        </AppButton>
      </Section>
    </Screen>
  );
}

