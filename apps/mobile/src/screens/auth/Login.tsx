import React, { useState } from 'react';
import { AppButton, AppText, FormField, Screen, Section } from '../../ui';
import { apiClient } from '../../api/client';
import { sessionStore } from '../../storage/session';

type Props = {
  onAuth: (token: string) => void;
};

const AuthLogin = ({ onAuth }: Props) => {
  const [handle, setHandle] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const doLogin = async () => {
    setError(null);
    setLoading(true);
    try {
      const tokens = await apiClient.login(handle, password);
      onAuth(tokens.access_token);
      await sessionStore.saveToken(tokens.access_token, tokens.refresh_token);
    } catch (err: any) {
      setError('Login failed. Check API_BASE_URL and credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen>
      <Section title="Login" subtitle="Welcome back.">
        {error ? (
          <AppText variant="caption" color="$red10">
            {error}
          </AppText>
        ) : null}
        <FormField label="Handle" value={handle} onChangeText={setHandle} placeholder="yourhandle" autoCapitalize="none" />
        <FormField
          label="Password"
          value={password}
          onChangeText={setPassword}
          placeholder="••••••••"
          secureTextEntry
          autoCapitalize="none"
        />
        <AppButton tone="primary" onPress={doLogin} loading={loading} disabled={!handle || !password || loading}>
          Continue
        </AppButton>
      </Section>
    </Screen>
  );
};

export default AuthLogin;

