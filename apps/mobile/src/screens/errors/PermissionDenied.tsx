import React from 'react';
import { Screen, Section } from '../../ui';
import { BlockedState } from '../../ui/recipes/states';

type Props = {
  message?: string;
  onBack?: () => void;
};

export default function PermissionDeniedScreen({ message, onBack }: Props) {
  return (
    <Screen>
      <Section title="Permission denied">
        <BlockedState title="Permission denied" body={message ?? 'You cannot perform this action.'} />
      </Section>
    </Screen>
  );
}

