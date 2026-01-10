import React, { useEffect, useState } from 'react';
import { Screen, Section, AppText, AppButton } from '../../ui';
import { EVENT_NAME } from '../../config/lexicon';
import { getOrCreatePushToken, getPushEnabled, setPushEnabled } from '../../storage/push';
import { apiClient } from '../../api/client';
import { Platform } from 'react-native';

const OnbNotifications = ({ navigation, onDone, token }: any) => {
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    getPushEnabled().then(setEnabled).catch(() => {});
  }, []);

  const enable = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await setPushEnabled(true);
      setEnabled(true);
      const t = await getOrCreatePushToken();
      const plat: 'ios' | 'android' = Platform.OS === 'android' ? 'android' : 'ios';
      if (token) await apiClient.pushRegister(token, plat, t);
      setMsg('Enabled (stub).');
    } catch (e: any) {
      setMsg(e?.message ?? 'Enable failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Section title="Notifications" subtitle="Optional. You can change this later in Settings.">
        <AppText variant="body">Enable alerts for replies, endorsements, and {EVENT_NAME} start/end.</AppText>
        <AppButton tone="secondary" onPress={enable} loading={busy} disabled={busy || enabled}>
          {enabled ? 'Enabled' : 'Enable notifications'}
        </AppButton>
        {msg ? <AppText variant="caption">{msg}</AppText> : null}
        <AppButton
          tone="primary"
          onPress={() => {
            if (onDone) onDone();
            else navigation.navigate('Home');
          }}
        >
          Finish
        </AppButton>
      </Section>
    </Screen>
  );
};

export default OnbNotifications;

