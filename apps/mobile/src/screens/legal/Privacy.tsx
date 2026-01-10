import React from 'react';
import { Screen, Section, AppText, Card } from '../../ui';

export default function PrivacyScreen() {
  return (
    <Screen>
      <Section title="Privacy Policy">
        <Card bordered>
          <AppText variant="body" fontWeight="700">
            Data Covenant
          </AppText>
          <AppText variant="body">
            We don’t sell personal data. We minimize collection, and we build intelligence from aggregated signals—not from exporting identities.
          </AppText>
          <AppText variant="caption" color="$gray10">
            This is a product stub. Replace with your finalized Privacy Policy text and versioning before release.
          </AppText>
        </Card>
      </Section>
    </Screen>
  );
}


