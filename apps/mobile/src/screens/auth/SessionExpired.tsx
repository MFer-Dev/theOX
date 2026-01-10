import React from 'react';
import { Screen, Section, AppText, AppButton } from '../../ui';

type Props = {
  onLogin: () => void;
};

export default function SessionExpiredScreen({ onLogin }: Props) {
  return (
    <Screen>
      <Section title="Session expired">
        <AppText variant="body">Your session ended. Please log in again.</AppText>
        <AppButton tone="primary" onPress={onLogin}>
          Log in again
        </AppButton>
      </Section>
    </Screen>
  );
}

