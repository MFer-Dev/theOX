import React from 'react';
import { Screen, Section, AppText, Card } from '../../ui';

export default function LicensesScreen() {
  return (
    <Screen>
      <Section title="Licenses">
        <Card bordered>
          <AppText variant="body">
            Third‑party licenses will appear here in production builds.
          </AppText>
        </Card>
      </Section>
    </Screen>
  );
}


