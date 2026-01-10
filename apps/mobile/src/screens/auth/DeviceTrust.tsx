import React from 'react';
import { Screen, Section, AppText, AppButton } from '../../ui';

type Props = {
  deviceLabel: string;
  location?: string;
  onTrust: () => void;
  onDeny: () => void;
  loading?: boolean;
};

export default function DeviceTrustScreen({ deviceLabel, location, onTrust, onDeny, loading }: Props) {
  return (
    <Screen>
      <Section title="New device">
        <AppText variant="body">{deviceLabel}</AppText>
        {location ? <AppText variant="caption">Location: {location}</AppText> : null}
        <AppText variant="caption">Approve or deny this device.</AppText>
        <AppButton tone="primary" onPress={onTrust} disabled={loading} loading={Boolean(loading)}>
          Trust device
        </AppButton>
        <AppButton tone="destructive" onPress={onDeny} disabled={loading}>
          Deny access
        </AppButton>
      </Section>
    </Screen>
  );
}

