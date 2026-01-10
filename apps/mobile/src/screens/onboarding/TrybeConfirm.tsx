import React from 'react';
import { Screen, Section, AppText, AppButton, Card } from '../../ui';
import { EVENT_NAME, GROUP_SINGULAR, formatTrybeLabel } from '../../config/lexicon';

export default function TrybeConfirm({ navigation, token }: any) {
  return (
    <Screen>
      <Section
        title={`Your ${GROUP_SINGULAR}`}
        subtitle="This is your default world. The Gathering temporarily opens cross-Trybe visibility."
      >
        <Card>
          <AppText variant="title">{formatTrybeLabel('genz')}</AppText>
          <AppText variant="caption">
            You mostly see your Trybe. During {EVENT_NAME}, the app switches worlds automatically—no toggle, no tab.
          </AppText>
        </Card>
        <AppText variant="caption">
          One human, one account, one Trybe. This keeps discourse legible and trustable.
        </AppText>
        <AppButton tone="primary" onPress={() => navigation.navigate('Tour')}>
          Continue
        </AppButton>
      </Section>
    </Screen>
  );
}


