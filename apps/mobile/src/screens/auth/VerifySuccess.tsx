import React from 'react';
import { Screen, Section, AppText, AppButton, Card } from '../../ui';

type Props = {
  navigation: any;
};

export default function VerifySuccess({ navigation }: Props) {
  return (
    <Screen>
      <Section title="Verified" subtitle="Verification disappears after this.">
        <Card>
          <AppText variant="body">You’re verified as a unique human of a real age.</AppText>
          <AppText variant="caption">
            We don’t sell personal data. We study patterns, not people.
          </AppText>
        </Card>
        <AppButton tone="primary" onPress={() => navigation.navigate('Login')}>
          Continue
        </AppButton>
      </Section>
    </Screen>
  );
}


