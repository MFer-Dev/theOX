import React from 'react';
import { Screen, Section, AppText, AppButton } from '../../ui';

type Props = {
  message?: string;
  onHome?: () => void;
  onRestart?: () => void;
  onSupport?: () => void;
};

export default function TerminalErrorScreen({ message, onHome, onRestart, onSupport }: Props) {
  return (
    <Screen>
      <Section title="Cannot continue">
        <AppText variant="body">{message ?? 'This action cannot continue.'}</AppText>
        <AppButton tone="primary" onPress={onHome}>
          Return Home
        </AppButton>
        {onRestart ? (
          <AppButton tone="secondary" onPress={onRestart}>
            Restart App
          </AppButton>
        ) : null}
        {onSupport ? (
          <AppButton tone="ghost" onPress={onSupport}>
            Contact Support
          </AppButton>
        ) : null}
      </Section>
    </Screen>
  );
}

