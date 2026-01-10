import React from 'react';
import { Screen, Section, AppText, AppButton } from '../../ui';
import { ErrorState } from '../../ui/recipes/states';

type Props = {
  message?: string;
  onRetry?: () => void;
  onBack?: () => void;
  exhausted?: boolean;
};

export default function GlobalErrorScreen({ message, onRetry, onBack, exhausted }: Props) {
  const body = message ?? (exhausted ? 'We could not complete this after multiple attempts.' : 'Something didn’t load.');
  return (
    <Screen>
      <Section title={exhausted ? 'Could not recover' : 'Error'}>
        <ErrorState body={body} actionLabel={onRetry ? 'Retry' : undefined} onAction={onRetry} />
        {onBack ? (
          <AppButton tone="ghost" onPress={onBack}>
            Back
          </AppButton>
        ) : null}
      </Section>
    </Screen>
  );
}

