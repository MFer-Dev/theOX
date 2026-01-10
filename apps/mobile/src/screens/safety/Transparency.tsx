import React from 'react';
import { Screen, Section, AppText } from '../../ui';
import { EVENT_NAME, GROUP_SINGULAR } from '../../config/lexicon';

const SafetyTransparency = () => (
  <Screen>
    <Section title="Safety Transparency">
      <AppText variant="body">
        Flags add context and trigger review; friction slows actions when risk is elevated; appeals are always available.
      </AppText>
      <AppText variant="body">
        Cross-{GROUP_SINGULAR.toLowerCase()} actions may be limited outside {EVENT_NAME}. Enforcement avoids public shaming and focuses on
        harm reduction.
      </AppText>
      <AppText variant="caption" color="$gray10">
        Read more in docs. Policies evolve; app behavior updates accordingly.
      </AppText>
    </Section>
  </Screen>
);

export default SafetyTransparency;

