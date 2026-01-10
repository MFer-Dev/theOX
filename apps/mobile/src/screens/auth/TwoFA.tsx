import React, { useState } from 'react';
import { AppButton, AppText, FormField, Screen, Section } from '../../ui';
import { apiClient } from '../../api/client';

const AuthTwoFA = ({ navigation }: any) => {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const verify = async () => {
    setError(null);
    setLoading(true);
    try {
      await apiClient.verify2fa?.(code);
      navigation.navigate('Login');
    } catch (err) {
      setError('2FA verification failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen>
      <Section title="2FA" subtitle="Enter the code from your authenticator.">
        {error ? (
          <AppText variant="caption" color="$red10">
            {error}
          </AppText>
        ) : null}
        <FormField label="Code" value={code} onChangeText={setCode} placeholder="123456" keyboardType="number-pad" />
        <AppButton tone="primary" onPress={verify} loading={loading} disabled={!code || loading}>
          Verify
        </AppButton>
        <AppButton tone="ghost" onPress={() => navigation?.goBack?.()}>
          Back
        </AppButton>
      </Section>
    </Screen>
  );
};

export default AuthTwoFA;

