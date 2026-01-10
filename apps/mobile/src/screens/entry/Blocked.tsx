import React from 'react';
import { Screen, Section, AppText, AppButton } from '../../ui';

type Props = {
  reason?: string;
  onSupport?: () => void;
  onLogout: () => void;
};

export default function BlockedAccess({ reason, onSupport, onLogout }: Props) {
  return (
    <Screen>
      <Section title="Access blocked">
        <AppText variant="body">{reason ?? 'Your account cannot access the app right now.'}</AppText>
        <AppText variant="caption">Contact support if you believe this is an error.</AppText>
      </Section>
      <Section>
        {onSupport ? (
          <AppButton tone="secondary" onPress={onSupport}>
            Contact Support
          </AppButton>
        ) : null}
        <AppButton tone="ghost" onPress={onLogout}>
          Log Out
        </AppButton>
      </Section>
    </Screen>
  );
}

