import React from 'react';
import { Screen, Section, AppButton, AppText } from '../../ui';
import { BackHandler } from 'react-native';

type Props = {
  onRestart?: () => void;
};

export default function SafeExitScreen({ onRestart }: Props) {
  return (
    <Screen>
      <Section title="Safe exit">
        <AppText variant="body">Restart or exit to avoid further issues.</AppText>
        {onRestart ? (
          <AppButton tone="primary" onPress={onRestart}>
            Restart App
          </AppButton>
        ) : null}
        <AppButton tone="ghost" onPress={() => BackHandler.exitApp()}>
          Exit App
        </AppButton>
      </Section>
    </Screen>
  );
}

