import React, { useState } from 'react';
import { Screen, Section, AppText, FormField, AppButton, ErrorState } from '../../ui';

type Props = {
  onConfirm: (secret: string) => void;
  onCancel: () => void;
};

export default function ReauthScreen({ onConfirm, onCancel }: Props) {
  const [secret, setSecret] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (!secret) {
      setError('Required.');
      return;
    }
    setLoading(true);
    try {
      onConfirm(secret);
    } catch (e: any) {
      setError(e?.message ?? 'Invalid credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen>
      <Section title="Re-authenticate">
        <AppText variant="body">Confirm your identity to continue.</AppText>
        <FormField label="Password or code" value={secret} onChangeText={setSecret} secureTextEntry />
        {error ? <ErrorState body={error} /> : null}
        <AppButton tone="primary" onPress={submit} loading={loading} disabled={loading}>
          Confirm
        </AppButton>
        <AppButton tone="ghost" onPress={onCancel} disabled={loading}>
          Cancel
        </AppButton>
      </Section>
    </Screen>
  );
}

