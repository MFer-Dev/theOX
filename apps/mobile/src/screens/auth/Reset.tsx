import React, { useState } from 'react';
import { AppButton, AppText, FormField, Screen, Section } from '../../ui';
import { apiClient } from '../../api/client';

const AuthReset = ({ navigation }: any) => {
  const [resetToken, setResetToken] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const reset = async () => {
    setError(null);
    setLoading(true);
    try {
      await apiClient.resetPassword?.(resetToken, password);
      setSuccess(true);
    } catch (err) {
      setError('Failed to reset password.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen>
      <Section title="Set new password" subtitle="Enter the reset token and a new password.">
        {error ? (
          <AppText variant="caption" color="$red10">
            {error}
          </AppText>
        ) : null}
        {success ? (
          <AppText variant="caption" color="$gray10">
            Password updated. You can log in now.
          </AppText>
        ) : null}
        <FormField label="Reset token" value={resetToken} onChangeText={setResetToken} placeholder="123456" autoCapitalize="none" />
        <FormField
          label="New password"
          value={password}
          onChangeText={setPassword}
          placeholder="••••••••"
          secureTextEntry
          autoCapitalize="none"
        />
        <AppButton tone="primary" onPress={reset} loading={loading} disabled={!resetToken || !password || loading}>
          Update password
        </AppButton>
        <AppButton tone="ghost" onPress={() => navigation?.navigate?.('Login')}>
          Back to login
        </AppButton>
      </Section>
    </Screen>
  );
};

export default AuthReset;

