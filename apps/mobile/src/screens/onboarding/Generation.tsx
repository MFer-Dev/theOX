import React, { useState } from 'react';
import { AppButton, AppText, FormField, Screen, Section } from '../../ui';
import { apiClient } from '../../api/client';
import { GROUP_SINGULAR } from '../../config/lexicon';

const OnbGeneration = ({ navigation, token }: any) => {
  const [generation, setGeneration] = useState('');
  const [error, setError] = useState<string | null>(null);

  const select = async () => {
    setError(null);
    try {
      await apiClient.setGeneration?.(generation, token);
      navigation.navigate('GenVerify');
    } catch (err) {
      setError('Failed to set generation.');
    }
  };

  return (
    <Screen>
      <Section
        title={`Choose your ${GROUP_SINGULAR}`}
        subtitle={`Your ${GROUP_SINGULAR} is your generation. You mostly see your Trybe; cross-Trybe visibility happens during scheduled events.`}
      >
        {error ? <AppText variant="body" color="$red10">{error}</AppText> : null}
        <FormField
          label={`${GROUP_SINGULAR}`}
          value={generation}
          onChangeText={setGeneration}
          placeholder="e.g., genz"
        />
        <AppButton tone="primary" onPress={select}>
          Continue
        </AppButton>
      </Section>
    </Screen>
  );
};

export default OnbGeneration;

