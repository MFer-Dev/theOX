import React, { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Screen, Section, AppText, Toggle, AppButton, Card } from '../../ui';

const KEY = 'dev:featureFlags';

type Flags = {
  gatheringThemePreview: boolean;
  showKitchenTab: boolean;
};

const defaults: Flags = {
  gatheringThemePreview: false,
  showKitchenTab: true,
};

export default function FeatureFlags() {
  const [flags, setFlags] = useState<Flags>(defaults);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const boot = async () => {
      try {
        const raw = await AsyncStorage.getItem(KEY);
        if (raw) setFlags({ ...defaults, ...(JSON.parse(raw) as Partial<Flags>) });
      } catch {
        // ignore
      } finally {
        setLoaded(true);
      }
    };
    boot();
  }, []);

  const save = async (next: Flags) => {
    setFlags(next);
    try {
      await AsyncStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  };

  return (
    <Screen>
      <Section title="Feature flags" subtitle="Dev-only switches to test UX without backend.">
        <Card>
          <Toggle
            label="Gathering theme preview"
            value={flags.gatheringThemePreview}
            onValueChange={(v) => save({ ...flags, gatheringThemePreview: Boolean(v) })}
          />
          <AppText variant="caption">Forces the event theme so you can validate contrast/tones.</AppText>
        </Card>

        <Card>
          <Toggle
            label="Show Kitchen tab"
            value={flags.showKitchenTab}
            onValueChange={(v) => save({ ...flags, showKitchenTab: Boolean(v) })}
          />
          <AppText variant="caption">Hide dev-only surfaces when doing a clean UX pass.</AppText>
        </Card>

        {!loaded ? <AppText variant="caption">Loading flags…</AppText> : null}
        <AppButton tone="secondary" onPress={async () => save(defaults)}>
          Reset to defaults
        </AppButton>
      </Section>
    </Screen>
  );
}


