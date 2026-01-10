import React, { useState } from 'react';
import { Screen, Section, AppText, AppButton, Card, FormField } from '../../ui';
import { apiClient } from '../../api/client';
import { useNavigation } from '@react-navigation/native';

export default function DevToolsScreen({ token }: { token: string }) {
  const nav = useNavigation<any>();
  const [minutes, setMinutes] = useState('5');
  const [startsIn, setStartsIn] = useState('10');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const start = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const m = Math.max(1, Math.min(180, Number(minutes || 30)));
      await apiClient.devGatheringStart(token, m);
      setMsg(`Forced Gathering for ${m} minutes.`);
      nav.goBack();
    } catch (e: any) {
      setMsg(e?.message ?? 'Failed to start Gathering');
    } finally {
      setBusy(false);
    }
  };

  const schedule = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const m = Math.max(1, Math.min(180, Number(minutes || 5)));
      const s = Math.max(0, Math.min(3600, Number(startsIn || 10)));
      await apiClient.devGatheringSchedule(token, m, s);
      setMsg(`Scheduled Gathering in ${s}s for ${m} minutes.`);
    } catch (e: any) {
      setMsg(e?.message ?? 'Failed to schedule Gathering');
    } finally {
      setBusy(false);
    }
  };

  const end = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await apiClient.devGatheringEnd(token);
      setMsg('Ended Gathering (reset).');
    } catch (e: any) {
      setMsg(e?.message ?? 'Failed to end Gathering');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Section title="Dev Tools" subtitle="Hidden QA controls.">
        <Card bordered>
          <AppText variant="body" fontWeight="800">
            Gathering controls
          </AppText>
          <FormField label="Duration (minutes)" value={minutes} onChangeText={setMinutes} placeholder="5" keyboardType="number-pad" />
          <FormField label="Starts in (seconds)" value={startsIn} onChangeText={setStartsIn} placeholder="10" keyboardType="number-pad" />
          <AppButton tone="primary" onPress={schedule} loading={busy} disabled={busy}>
            Schedule Gathering (countdown test)
          </AppButton>
          <AppButton tone="secondary" onPress={start} loading={busy} disabled={busy}>
            Start now
          </AppButton>
          <AppButton tone="ghost" onPress={end} loading={busy} disabled={busy}>
            End now (reset)
          </AppButton>
          <AppButton tone="ghost" onPress={() => nav.goBack()} disabled={busy}>
            Done
          </AppButton>
          {msg ? (
            <AppText variant="caption" color="$gray10">
              {msg}
            </AppText>
          ) : null}
        </Card>
      </Section>
    </Screen>
  );
}


