import React, { useState } from 'react';
import { Screen, Section, AppText, AppButton, FormField } from '../../ui';
import { apiClient } from '../../api/client';

const OnbVerifyGen = ({ navigation, token }: any) => {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  const verify = async () => {
    setError(null);
    try {
      await apiClient.verifyGeneration?.(code, token);
      navigation.navigate('TrybeConfirm');
    } catch (err) {
      setError('Generation verification failed.');
    }
  };

  return (
    <Screen>
      <Section title="Verify Generation" subtitle="If challenged, provide verification proof/code.">
        {error ? <AppText variant="caption" color="$red10">{error}</AppText> : null}
        <FormField label="Verification code" value={code} onChangeText={setCode} placeholder="Verification code" />
        <AppButton tone="primary" onPress={verify}>
          Verify
        </AppButton>
      </Section>
    </Screen>
  );
};

export default OnbVerifyGen;

