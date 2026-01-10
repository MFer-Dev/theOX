import React from 'react';
import { Screen, Section, AppText, AppButton } from '../../ui';

type Props = {
  navigation: any;
};

export default function ReportConfirmScreen({ navigation }: Props) {
  return (
    <Screen>
      <Section title="Report received">
        <AppText variant="body">Thanks for letting us know. We’ll review this content.</AppText>
        <AppText variant="caption">You may not receive updates about this report.</AppText>
        <AppButton tone="primary" onPress={() => navigation?.goBack?.()}>
          Done
        </AppButton>
      </Section>
    </Screen>
  );
}

