import React, { useState } from 'react';
import { Screen, Section, AppText, FormField, AppButton, ErrorState } from '../../ui';

type Props = {
  onLogin: () => void;
  onCreated: (email: string) => void;
};

export default function CreateAccountScreen({ onLogin, onCreated }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (!email || !password) {
      setError('Email and password required.');
      return;
    }
    setLoading(true);
    try {
      // call identity create endpoint here
      onCreated(email);
    } catch (e: any) {
      setError(e?.message ?? 'Unable to create account.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen>
      <Section title="Create account">
        <AppText variant="caption">Start your account to access the app.</AppText>
        <FormField label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" />
        <FormField label="Password" value={password} onChangeText={setPassword} secureTextEntry />
        <FormField label="Name (optional)" value={name} onChangeText={setName} />
        {error ? <ErrorState body={error} /> : null}
        <AppButton tone="primary" onPress={submit} loading={loading} disabled={loading}>
          Create account
        </AppButton>
        <AppButton tone="ghost" onPress={onLogin} disabled={loading}>
          Log in instead
        </AppButton>
      </Section>
    </Screen>
  );
}

