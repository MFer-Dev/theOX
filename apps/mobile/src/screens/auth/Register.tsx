import React, { useState } from 'react';
import { AppButton, AppText, FormField, Screen, Section } from '../../ui';
import { apiClient } from '../../api/client';

type Props = {
  navigation: any;
  onRegistered?: () => void;
};

const AuthRegister = ({ navigation, onRegistered }: Props) => {
  const [email, setEmail] = useState('');
  const [handle, setHandle] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const doRegister = async () => {
    setError(null);
    try {
      await apiClient.register?.(email, handle, password);
      if (onRegistered) onRegistered();
      navigation.navigate('OTP', { contact: email || handle });
    } catch (err) {
      setError('Registration failed. Ensure gateway /identity/register is reachable.');
    }
  };

  return (
    <Screen>
      <AppButton tone="ghost" onPress={() => navigation.goBack()}>
        Back
      </AppButton>
      <Section title="Create Account" subtitle="Set up your Trybl account.">
        {error ? <AppText variant="body" color="$red10">{error}</AppText> : null}
        <FormField label="Email (or phone)" value={email} onChangeText={setEmail} placeholder="you@example.com" />
        <FormField label="Handle" value={handle} onChangeText={setHandle} placeholder="yourhandle" />
        <FormField label="Password" value={password} onChangeText={setPassword} placeholder="••••••••" secureTextEntry />
        <AppButton tone="primary" onPress={doRegister}>
          Register
        </AppButton>
      </Section>
    </Screen>
  );
};

export default AuthRegister;

