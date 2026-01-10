import React from 'react';
import { AppButton, AppText, Screen, Section } from '../../ui';

type Props = {
  onLogout: () => void;
};

const AuthLogout = ({ onLogout }: Props) => {
  return (
    <Screen>
      <Section title="Logout" subtitle="End your session on this device.">
        <AppText variant="body">You can always log back in.</AppText>
        <AppButton tone="destructive" onPress={onLogout}>
          Logout
        </AppButton>
      </Section>
    </Screen>
  );
};

export default AuthLogout;

