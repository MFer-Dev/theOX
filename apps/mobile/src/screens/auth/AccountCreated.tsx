import React from 'react';
import { Screen, Section, AppText, AppButton } from '../../ui';

type Props = {
  onContinue: () => void;
};

export default function AccountCreatedScreen({ onContinue }: Props) {
  return (
    <Screen>
      <Section title="Account created">
        <AppText variant="body">Your account is ready. Continue to start using the app.</AppText>
        <AppButton tone="primary" onPress={onContinue}>
          Continue
        </AppButton>
      </Section>
    </Screen>
  );
}

