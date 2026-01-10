import React from 'react';
import { Screen, Section, AppText, AppButton } from '../../ui';

type Props = {
  navigation: any;
};

// Plain-language verification explainer (mandatory, free, before feed access).
export default function VerifyIntro({ navigation }: Props) {
  return (
    <Screen>
      <Section
        title="Verification required"
        subtitle="Trybl is free for life. The only requirement is verification."
      >
        <AppText variant="body">
          We verify once to make sure you’re a real human of a real age.
        </AppText>
        <AppText variant="body">We don’t keep your documents. We don’t sell your data.</AppText>
        <AppText variant="body">After this, verification disappears.</AppText>
        <AppButton tone="primary" onPress={() => navigation.navigate('VerifyMethod')}>
          Verify now
        </AppButton>
      </Section>
    </Screen>
  );
}

