import React, { useEffect, useState } from 'react';
import { Screen, Section, AppText, Toggle } from '../../ui';
import { ErrorState, LoadingState } from '../../ui/recipes/states';
import { AccessibilityInfo } from 'react-native';

type Prefs = {
  reduceMotion: boolean;
  highContrast?: boolean;
  largerText?: boolean;
};

type Props = {
  fetchPrefs?: () => Promise<Prefs>;
  savePref?: (key: keyof Prefs, value: boolean) => Promise<void>;
};

export default function AccessibilityScreen({ fetchPrefs, savePref }: Props) {
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      setLoading(true);
      setError(null);
      const osReduce = await AccessibilityInfo.isReduceMotionEnabled();
      const p = await fetchPrefs?.();
      setPrefs({ reduceMotion: p?.reduceMotion ?? osReduce, highContrast: p?.highContrast ?? false, largerText: p?.largerText ?? false });
    } catch {
      setError('Failed to load accessibility prefs.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = async (key: keyof Prefs, value: boolean) => {
    if (!prefs) return;
    setPrefs({ ...prefs, [key]: value });
    try {
      await savePref?.(key, value);
    } catch {
      setError('Save failed. Reverting.');
      setPrefs({ ...prefs, [key]: !value });
    }
  };

  return (
    <Screen>
      <Section title="Accessibility">
        {loading ? (
          <LoadingState lines={3} />
        ) : error ? (
          <ErrorState body={error} actionLabel="Retry" onAction={load} />
        ) : prefs ? (
          <>
            <Toggle label="Reduce motion" value={prefs.reduceMotion} onValueChange={(v) => toggle('reduceMotion', v)} />
            <Toggle label="High contrast" value={prefs.highContrast ?? false} onValueChange={(v) => toggle('highContrast', v)} />
            <Toggle label="Larger text" value={prefs.largerText ?? false} onValueChange={(v) => toggle('largerText', v)} />
            <AppText variant="caption">OS reduce-motion setting is respected; toggling here persists preference.</AppText>
          </>
        ) : null}
      </Section>
    </Screen>
  );
}

