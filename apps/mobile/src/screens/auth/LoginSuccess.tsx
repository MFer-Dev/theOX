import React, { useEffect } from 'react';
import { Screen, Section, AppText } from '../../ui';

type Props = {
  onDone: () => void;
};

export default function LoginSuccessScreen({ onDone }: Props) {
  useEffect(() => {
    onDone();
  }, [onDone]);

  return (
    <Screen>
      <Section title="Login success">
        <AppText variant="body">Continuing…</AppText>
      </Section>
    </Screen>
  );
}

