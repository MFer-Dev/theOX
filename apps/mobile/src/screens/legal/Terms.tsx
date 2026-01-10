import React from 'react';
import { Screen, Section, AppText, Card } from '../../ui';

export default function TermsScreen() {
  return (
    <Screen>
      <Section title="Terms of Service">
        <Card bordered>
          <AppText variant="body" fontWeight="700">
            Summary
          </AppText>
          <AppText variant="body">
            Use Trybl respectfully. No harassment, no threats, no spam. The Gathering is time-bound; content created there may be ephemeral.
          </AppText>
          <AppText variant="caption" color="$gray10">
            This is a product stub. Replace with your finalized Terms text and versioning before release.
          </AppText>
        </Card>
      </Section>
    </Screen>
  );
}


