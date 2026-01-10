import React, { useEffect, useState } from 'react';
import { Screen, Section, AppText, Toggle, Card } from '../../ui';
import { ErrorState, LoadingState } from '../../ui/recipes/states';
import { appearanceStore, type AppearanceMode } from '../../storage/appearance';
import { XStack } from 'tamagui';
import { Check } from '@tamagui/lucide-icons';
import { getOrCreatePushToken, getPushEnabled, setPushEnabled } from '../../storage/push';
import { apiClient } from '../../api/client';
import { Platform } from 'react-native';

type Prefs = {
  notifyReplies: boolean;
  notifyMentions: boolean;
};

type Props = {
  token?: string;
  fetchPrefs?: () => Promise<Prefs>;
  savePref?: (key: keyof Prefs, value: boolean) => Promise<void>;
};

export default function PreferencesScreen({ token, fetchPrefs, savePref }: Props) {
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [appearance, setAppearance] = useState<AppearanceMode>('light');
  const [pushEnabled, setPushEnabledState] = useState(false);

  const load = async () => {
    try {
      setLoading(true);
      setError(null);
      const p = await fetchPrefs?.();
      setPrefs(p ?? { notifyReplies: true, notifyMentions: true });
    } catch {
      setError('Failed to load preferences.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    appearanceStore.getMode().then(setAppearance).catch(() => {});
  }, []);

  useEffect(() => {
    getPushEnabled().then(setPushEnabledState).catch(() => {});
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
      <Section title="Appearance" subtitle="Choose Light, Dark, or follow your device settings.">
        <Card>
          {(['light', 'dark', 'system'] as const).map((mode) => (
            <XStack
              key={mode}
              alignItems="center"
              justifyContent="space-between"
              paddingVertical="$2"
              onPress={async () => {
                setAppearance(mode);
                await appearanceStore.setMode(mode);
              }}
              pressStyle={{ opacity: 0.7 }}
            >
              <AppText variant="body" fontWeight={mode === appearance ? '700' : '500'}>
                {mode === 'light' ? 'Light' : mode === 'dark' ? 'Dark' : 'Use device settings'}
              </AppText>
              {mode === appearance ? <Check size="$1" color="$gray10" /> : null}
            </XStack>
          ))}
        </Card>
      </Section>

      <Section title="Preferences">
        {loading ? (
          <LoadingState lines={3} />
        ) : error ? (
          <ErrorState body={error} actionLabel="Retry" onAction={load} />
        ) : prefs ? (
          <>
            <Toggle label="Notify replies" value={prefs.notifyReplies} onValueChange={(v) => toggle('notifyReplies', v)} />
            <Toggle label="Notify mentions" value={prefs.notifyMentions} onValueChange={(v) => toggle('notifyMentions', v)} />
            <Toggle
              label="Push notifications (stub)"
              value={pushEnabled}
              onValueChange={async (v) => {
                setPushEnabledState(v);
                await setPushEnabled(v);
                if (!token) return;
                const plat: 'ios' | 'android' = Platform.OS === 'android' ? 'android' : 'ios';
                const t = await getOrCreatePushToken();
                if (v) await apiClient.pushRegister(token, plat, t);
                else await apiClient.pushUnregister(token, plat, t);
              }}
            />
          </>
        ) : null}
      </Section>
    </Screen>
  );
}

