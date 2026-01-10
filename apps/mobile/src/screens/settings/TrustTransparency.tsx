import React from 'react';
import { Screen, Section, AppText, Card, AppButton } from '../../ui';
import { useNavigation } from '@react-navigation/native';

export default function TrustTransparency() {
  const navigation = useNavigation<any>();
  return (
    <Screen>
      <Section title="Trust & Transparency" subtitle="Clear rules, calm enforcement, and explainable systems.">
        <Card>
          <AppText variant="body" fontWeight="700">
            Data Covenant
          </AppText>
          <AppText variant="body">
            We don’t sell personal data. We minimize collection, and we build intelligence from aggregated signals—not from exporting identities.
          </AppText>
          <AppText variant="caption">
            Generation insights are derived and protected with minimum thresholds to prevent re-identification.
          </AppText>
        </Card>

        <Card>
          <AppText variant="body" fontWeight="700">
            Ranking transparency
          </AppText>
          <AppText variant="body">
            When ranking is active, posts may show “Why you saw this” so you can understand the system instead of guessing.
          </AppText>
          <AppText variant="caption">
            Reasons can include recency, engagement, topic affinity, exploration picks, and credibility signals.
          </AppText>
        </Card>

        <Card>
          <AppText variant="body" fontWeight="700">
            The Gathering rules
          </AppText>
          <AppText variant="body">
            The Gathering is time-bound. When it dissolves, writes are rejected and anything in-progress is lost by design.
          </AppText>
          <AppText variant="caption">
            This is enforced by the server (world clock) and reflected in the UI as a calm dissolved state.
          </AppText>
        </Card>

        <AppButton tone="secondary" onPress={() => navigation.navigate('SettingsAbout' as never)}>
          About
        </AppButton>
      </Section>
    </Screen>
  );
}


