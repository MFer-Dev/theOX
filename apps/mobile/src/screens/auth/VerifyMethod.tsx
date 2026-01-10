import React, { useState } from 'react';
import { Screen, Section, AppText, AppButton, FormField, Pill, PillRow } from '../../ui';
import { apiClient } from '../../api/client';

type Props = {
  navigation: any;
};

type Method = 'sms' | 'email';

export default function VerifyMethod({ navigation }: Props) {
  const [method, setMethod] = useState<Method>('sms');
  const [contact, setContact] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const label = method === 'sms' ? 'Phone number' : 'Email';
  const placeholder = method === 'sms' ? '+1 555 555 5555' : 'name@example.com';

  return (
    <Screen>
      <Section title="Verify your account" subtitle="One human. One account. Free for life.">
        <PillRow>
          <Pill label="SMS" active={method === 'sms'} onPress={() => setMethod('sms')} />
          <Pill label="Email" active={method === 'email'} onPress={() => setMethod('email')} />
        </PillRow>
        <FormField label={label} value={contact} onChangeText={setContact} placeholder={placeholder} accessibilityLabel={label} />
        <AppText variant="caption">
          We verify once to make sure you’re a real human of a real age. We don’t keep your documents. We don’t sell your data.
        </AppText>
        {error ? (
          <AppText variant="caption" color="$red10">
            {error}
          </AppText>
        ) : null}
        <AppButton
          tone="primary"
          onPress={async () => {
            setError(null);
            setLoading(true);
            try {
              await apiClient.otpSend(contact.trim(), 'verify');
              navigation.navigate('OTP', { contact });
            } catch {
              setError('Unable to send code. Please try again.');
            } finally {
              setLoading(false);
            }
          }}
          loading={loading}
          disabled={!contact.trim() || loading}
        >
          Send code
        </AppButton>
      </Section>
    </Screen>
  );
}


