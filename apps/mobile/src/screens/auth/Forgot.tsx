import React, { useState } from 'react';
import { AppButton, AppText, FormField, Screen, Section } from '../../ui';
import { apiClient } from '../../api/client';

const AuthForgot = ({ navigation }: any) => {
  const [contact, setContact] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const send = async () => {
    setError(null);
    setLoading(true);
    try {
      await apiClient.forgotPassword?.(contact);
      setSent(true);
    } catch (err) {
      setError('Failed to send reset link/code.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen>
      <Section title="Reset password" subtitle="We’ll send a reset code.">
        {error ? (
          <AppText variant="caption" color="$red10">
            {error}
          </AppText>
        ) : null}
        {sent ? (
          <AppText variant="caption" color="$gray10">
            Check your email/phone for reset instructions.
          </AppText>
        ) : null}
        <FormField label="Email or phone" value={contact} onChangeText={setContact} placeholder="you@example.com" />
        <AppButton tone="primary" onPress={send} loading={loading} disabled={!contact || loading}>
          Send reset
        </AppButton>
        <AppButton tone="ghost" onPress={() => navigation?.goBack?.()}>
          Back
        </AppButton>
      </Section>
    </Screen>
  );
};

export default AuthForgot;

