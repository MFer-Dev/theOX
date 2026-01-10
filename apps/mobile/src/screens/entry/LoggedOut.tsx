import React from 'react';
import { Screen, Section, AppText, AppButton } from '../../ui';

type Props = {
  onGetStarted: () => void;
  onLogin: () => void;
  disabled?: boolean;
};

export default function LoggedOutEntry({ onGetStarted, onLogin, disabled }: Props) {
  return (
    <Screen>
      <Section title="Welcome">
        <AppText variant="body">A safe place to read and contribute across generations.</AppText>
      </Section>
      <Section>
        <AppButton tone="primary" onPress={onGetStarted} disabled={disabled}>
          Get Started
        </AppButton>
        <AppButton tone="secondary" onPress={onLogin} disabled={disabled}>
          Log In
        </AppButton>
      </Section>
    </Screen>
  );
}

