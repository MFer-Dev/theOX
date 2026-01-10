import React from 'react';
import { Screen, Section, AppText, AppButton } from '../../ui';

type Props = {
  onDiscard: () => void;
  onCancel: () => void;
};

export default function DiscardDraftScreen({ onDiscard, onCancel }: Props) {
  return (
    <Screen>
      <Section title="Discard draft?">
        <AppText variant="body">This action cannot be undone.</AppText>
        <AppButton tone="destructive" onPress={onDiscard}>
          Discard
        </AppButton>
        <AppButton tone="ghost" onPress={onCancel}>
          Cancel
        </AppButton>
      </Section>
    </Screen>
  );
}

