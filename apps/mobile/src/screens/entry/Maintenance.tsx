import React from 'react';
import { Screen, Section, AppText, AppButton } from '../../ui';
import { BackHandler } from 'react-native';

type Props = {
  message?: string;
  eta?: string | null;
};

export default function MaintenanceScreen({ message, eta }: Props) {
  return (
    <Screen>
      <Section title="Maintenance">
        <AppText variant="body">{message ?? 'We are under maintenance.'}</AppText>
        {eta ? <AppText variant="caption">Expected back: {eta}</AppText> : null}
        <AppButton tone="secondary" onPress={() => BackHandler.exitApp()} accessibilityLabel="Exit app">
          Exit
        </AppButton>
      </Section>
    </Screen>
  );
}

