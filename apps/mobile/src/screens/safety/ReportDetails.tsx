import React, { useState } from 'react';
import { Screen, Section, AppText, AppButton, FormField } from '../../ui';
import { ErrorState } from '../../ui/recipes/states';

type Props = {
  route: any;
  navigation: any;
  onSubmit?: (payload: { reason: string; notes?: string }) => Promise<{ success: boolean }> | Promise<void> | void;
};

export default function ReportDetailsScreen({ route, navigation, onSubmit }: Props) {
  const reason = route?.params?.reason;
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    setLoading(true);
    try {
      await onSubmit?.({ reason: reason ?? 'unknown', notes });
      navigation?.navigate?.('ReportConfirm');
    } catch (e: any) {
      setError(e?.message ?? 'Submission failed. Retry.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen>
      <Section title="Report details">
        <AppText variant="body">Reason: {reason ?? 'Not set'}</AppText>
        <AppText variant="caption">Add context (optional). Do not include personal info.</AppText>
        <FormField
          label="Notes"
          value={notes}
          onChangeText={setNotes}
          multiline
          numberOfLines={4}
          placeholder="Brief context"
        />
        {error ? <ErrorState body={error} /> : null}
        <AppButton tone="primary" onPress={submit} loading={loading} disabled={loading}>
          Submit Report
        </AppButton>
        <AppButton tone="ghost" onPress={() => navigation?.goBack?.()} disabled={loading}>
          Cancel
        </AppButton>
      </Section>
    </Screen>
  );
}

