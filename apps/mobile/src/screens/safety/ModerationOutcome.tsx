import React from 'react';
import { Screen, Section, AppText, AppButton } from '../../ui';

type Props = {
  navigation: any;
  route?: { params?: { reason?: string } };
};

export default function ModerationOutcomeScreen({ navigation, route }: Props) {
  const reason = route?.params?.reason ?? 'This content has been limited or removed.';
  return (
    <Screen>
      <Section title="Content unavailable">
        <AppText variant="body">{reason}</AppText>
        <AppButton tone="ghost" onPress={() => navigation?.goBack?.()}>
          Back
        </AppButton>
      </Section>
    </Screen>
  );
}

