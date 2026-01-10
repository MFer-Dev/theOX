import React, { useState } from 'react';
import { Screen, Section, AppText, AppButton, FormField } from '../../ui';
import { apiClient } from '../../api/client';

type Props = {
  route: any;
  navigation: any;
};

const AuthOTP = ({ route, navigation }: Props) => {
  const contact = route?.params?.contact ?? '';
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  const verify = async () => {
    setError(null);
    try {
      await apiClient.verifyOtp?.(contact, code);
      navigation.navigate('VerifySuccess');
    } catch (err) {
      setError('OTP verification failed.');
    }
  };

  return (
    <Screen>
      <Section title="Enter code" subtitle={contact ? `Sent to ${contact}` : 'Enter the verification code.'}>
        <FormField value={code} onChangeText={setCode} placeholder="123456" accessibilityLabel="Verification code" />
        {error ? (
          <AppText variant="caption" color="$red10">
            {error}
          </AppText>
        ) : null}
        <AppButton tone="primary" onPress={verify} disabled={!code.trim()}>
          Verify
        </AppButton>
        <AppButton tone="ghost" onPress={() => navigation.goBack()}>
          Back
        </AppButton>
      </Section>
    </Screen>
  );
};

export default AuthOTP;

