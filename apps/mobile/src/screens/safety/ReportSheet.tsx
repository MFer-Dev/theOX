import React, { useState } from 'react';
import { Sheet, AppText, AppButton, FormField } from '../../ui';
import { apiClient } from '../../api/client';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  token: string;
  contentId: string;
};

const reasons = ['spam', 'harassment', 'misinformation context', 'other'] as const;

export default function ReportSheet({ isOpen, onClose, token, contentId }: Props) {
  const [reason, setReason] = useState<(typeof reasons)[number]>('spam');
  const [other, setOther] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setError(null);
    setOk(false);
    setLoading(true);
    try {
      const r = reason === 'other' ? other.trim() : reason;
      if (!r) {
        setError('Please provide a reason.');
        return;
      }
      await apiClient.safetyFlag(token, { content_id: contentId, reason: r });
      setOk(true);
    } catch {
      setError('Report failed. Try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Sheet isOpen={isOpen} onClose={onClose}>
      <AppText variant="title">Report</AppText>
      <AppText variant="caption" color="$gray10">
        Reports help keep discourse constructive. Do not include personal info.
      </AppText>
      {error ? (
        <AppText variant="caption" color="$red10">
          {error}
        </AppText>
      ) : null}
      {ok ? (
        <AppText variant="caption" color="$gray10">
          Report submitted.
        </AppText>
      ) : null}

      {reasons.map((r) => (
        <AppButton
          key={r}
          tone={reason === r ? 'primary' : 'secondary'}
          onPress={() => {
            setReason(r);
            setOk(false);
          }}
        >
          {r}
        </AppButton>
      ))}

      {reason === 'other' ? (
        <FormField label="Reason" value={other} onChangeText={setOther} placeholder="Describe briefly" />
      ) : null}

      <AppButton tone="primary" onPress={submit} disabled={loading}>
        Submit
      </AppButton>
      <AppButton tone="ghost" onPress={onClose} disabled={loading}>
        Close
      </AppButton>
    </Sheet>
  );
}


